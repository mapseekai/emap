import { describe, expect, it, vi } from 'vitest';
import { createDuckDbSpatialAggregateRunCoordinator } from '../../packages/examples/src/duckdb-spatial-aggregate-run-coordinator';

function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    reject: (reason?: unknown) => reject!(reason),
    resolve: (value: T) => resolve!(value),
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness() {
  let inputGeneration = 0;
  const coordinator = createDuckDbSpatialAggregateRunCoordinator(() => inputGeneration);
  return {
    coordinator,
    invalidateInput() {
      inputGeneration += 1;
      coordinator.invalidateRuns();
    },
  };
}

describe('DuckDB spatial aggregate example run coordinator', () => {
  it('does not execute, register, publish, error, or finish after input changes during runtime acquisition', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const runtime = createDeferred<string>();
    const execute = vi.fn();
    const register = vi.fn();
    const publish = vi.fn();
    const publishError = vi.fn();
    const finish = vi.fn();

    const run = coordinator.run({
      getRuntime: () => runtime.promise,
      execute,
      register,
      publish,
      publishError,
      finish,
    });
    invalidateInput();
    runtime.resolve('runtime');
    await run;

    expect(execute).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(publishError).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it.each(['helper', 'map-op'])('discards stale %s query results without publication', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const query = createDeferred<string>();
    const discardResult = vi.fn();
    const register = vi.fn();
    const publish = vi.fn();

    const run = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: () => query.promise,
      discardResult,
      register,
      publish,
    });
    await flushAsyncWork();
    invalidateInput();
    query.resolve(`${'result'}`);
    await run;

    expect(discardResult).toHaveBeenCalledWith('result');
    expect(register).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('cleans only a stale registration while a newer run publishes its own output', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const oldRegistration = createDeferred<{ source: string; cleanup: () => void }>();
    const oldCleanup = vi.fn();
    const newCleanup = vi.fn();
    const publish = vi.fn();

    const oldRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => 'old-result',
      register: async () => oldRegistration.promise,
      publish,
    });
    await flushAsyncWork();
    invalidateInput();
    const newRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => 'new-result',
      register: async () => ({ source: 'new-source', cleanup: newCleanup }),
      publish,
    });
    await newRun;

    oldRegistration.resolve({ source: 'old-source', cleanup: oldCleanup });
    await oldRun;

    expect(oldCleanup).toHaveBeenCalledOnce();
    expect(newCleanup).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: 'new-result',
        registration: expect.objectContaining({ source: 'new-source' }),
      }),
    );
  });

  it('suppresses stale rejection status and finish while retaining current rejection handling', async () => {
    const { coordinator, invalidateInput } = createHarness();
    const staleQuery = createDeferred<string>();
    const staleError = vi.fn();
    const staleFinish = vi.fn();

    const staleRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: () => staleQuery.promise,
      register: vi.fn(),
      publish: vi.fn(),
      publishError: staleError,
      finish: staleFinish,
    });
    await flushAsyncWork();
    invalidateInput();
    staleQuery.reject(new Error('stale failure'));
    await staleRun;

    expect(staleError).not.toHaveBeenCalled();
    expect(staleFinish).not.toHaveBeenCalled();

    const currentError = vi.fn();
    const currentFinish = vi.fn();
    await coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => {
        throw new Error('current failure');
      },
      register: vi.fn(),
      publish: vi.fn(),
      publishError: currentError,
      finish: currentFinish,
    });

    expect(currentError).toHaveBeenCalledOnce();
    expect(currentFinish).toHaveBeenCalledOnce();
  });

  it('lets only a newer run publish when inputs do not change', async () => {
    const { coordinator } = createHarness();
    const oldQuery = createDeferred<string>();
    const publish = vi.fn();

    const oldRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: () => oldQuery.promise,
      register: vi.fn(),
      publish,
    });
    await flushAsyncWork();
    const newRun = coordinator.run({
      getRuntime: async () => 'runtime',
      execute: async () => 'new-result',
      register: async () => ({ source: 'new-source', cleanup: vi.fn() }),
      publish,
    });
    await newRun;
    oldQuery.resolve('old-result');
    await oldRun;

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'new-result' }));
  });
});
