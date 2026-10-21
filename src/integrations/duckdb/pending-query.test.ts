import { describe, expect, it, vi } from 'vitest';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { runPendingQuery } from './pending-query';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const table = tableFromArrays({ value: [1, 2] });
  const bytes = tableToIPC(table, 'stream');
  const bindings = {
    startPendingQuery: vi.fn(async () => bytes as Uint8Array | null),
    pollPendingQuery: vi.fn(async () => bytes as Uint8Array | null),
    fetchQueryResults: vi.fn(async () => new Uint8Array() as Uint8Array | null),
    cancelPendingQuery: vi.fn(async () => true),
  };
  const connection: Pick<AsyncDuckDBConnection, 'useUnsafe'> = {
    useUnsafe: (callback) => callback(bindings as unknown as AsyncDuckDB, 42),
  };
  const controller = new AbortController();
  return { table, bytes, bindings, connection, controller };
}

describe('cancellable pending queries', () => {
  it('rejects before starting a pre-aborted query', async () => {
    const { bindings, connection, controller } = setup();
    controller.abort();
    await expect(runPendingQuery(connection, 'SELECT 1', controller.signal)).rejects.toBe(
      controller.signal.reason,
    );
    expect(bindings.startPendingQuery).not.toHaveBeenCalled();
    expect(bindings.cancelPendingQuery).not.toHaveBeenCalled();
  });
  it('materializes results and removes the abort listener before the next query', async () => {
    const { bindings, connection, controller, table } = setup();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = await runPendingQuery(connection, 'SELECT 1', controller.signal);
    expect(result.toArray()).toEqual(table.toArray());
    expect(bindings.startPendingQuery).toHaveBeenCalledWith(42, 'SELECT 1', true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(bindings.cancelPendingQuery).not.toHaveBeenCalled();
    await expect(
      runPendingQuery(connection, 'SELECT 2', new AbortController().signal),
    ).resolves.toMatchObject({ numRows: 2 });
  });
  it('stops polling on abort and waits for the in-flight poll and cancellation acknowledgement', async () => {
    const { bindings, connection, controller } = setup();
    const poll = deferred<Uint8Array | null>();
    const cancelled = deferred<boolean>();
    bindings.startPendingQuery.mockResolvedValue(null);
    bindings.pollPendingQuery.mockReturnValue(poll.promise);
    bindings.cancelPendingQuery.mockReturnValue(cancelled.promise);
    let settled = false;
    const work = runPendingQuery(connection, 'long query', controller.signal).finally(() => {
      settled = true;
    });
    const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(bindings.pollPendingQuery).toHaveBeenCalledOnce());
    controller.abort();
    expect(bindings.cancelPendingQuery).toHaveBeenCalledOnce();
    poll.resolve(null);
    await Promise.resolve();
    expect(settled).toBe(false);
    cancelled.resolve(true);
    await failed;
    expect(bindings.pollPendingQuery).toHaveBeenCalledOnce();
    expect(bindings.fetchQueryResults).not.toHaveBeenCalled();
  });
  it('stops result consumption on abort and can run again', async () => {
    const { bindings, connection, controller, bytes } = setup();
    const fetch = deferred<Uint8Array | null>();
    bindings.startPendingQuery.mockResolvedValue(bytes.subarray(0, 8));
    bindings.fetchQueryResults.mockReturnValue(fetch.promise);
    const work = runPendingQuery(connection, 'stream', controller.signal);
    const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(bindings.fetchQueryResults).toHaveBeenCalledOnce());
    controller.abort();
    fetch.resolve(bytes.subarray(8));
    await failed;
    expect(bindings.cancelPendingQuery).toHaveBeenCalledOnce();
    expect(bindings.fetchQueryResults).toHaveBeenCalledOnce();
    bindings.startPendingQuery.mockResolvedValue(bytes);
    await expect(
      runPendingQuery(connection, 'retry', new AbortController().signal),
    ).resolves.toMatchObject({ numRows: 2 });
  });
  it('cleans up failed pending queries and exposes cancellation cleanup errors', async () => {
    const { bindings, connection, controller } = setup();
    bindings.startPendingQuery.mockRejectedValue(new Error('bad SQL'));
    await expect(runPendingQuery(connection, 'bad', controller.signal)).rejects.toThrow('bad SQL');
    expect(bindings.cancelPendingQuery).toHaveBeenCalledOnce();
    bindings.cancelPendingQuery.mockRejectedValue(new Error('cancel failed'));
    await expect(runPendingQuery(connection, 'bad', controller.signal)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: 'bad SQL' }),
        expect.objectContaining({ message: 'cancel failed' }),
      ],
    });
  });
});
