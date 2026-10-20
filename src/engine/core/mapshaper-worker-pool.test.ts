import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { output } from '@mapseekai/tasklane/host';
import { MapshaperWorkerPool } from './mapshaper-worker-pool';
import { TasklaneTestWorker, flushTasks } from '../../../test/utils/tasklane-worker';
import { encodeWorkerData, decodeWorkerData } from '../../integrations/mapshaper/binary';

const pools: MapshaperWorkerPool[] = [];
function pool(size = 1, timeout = 120000) {
  const value = new MapshaperWorkerPool({
    workerUrl: 'worker.js',
    WorkerCtor: TasklaneTestWorker as unknown as typeof Worker,
    poolSize: size,
    jobTimeoutMs: timeout,
  });
  pools.push(value);
  return value;
}
beforeEach(() => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = {};
});
afterEach(async () => {
  for (const value of pools.splice(0)) {
    value.destroy();
    await value.closed;
  }
  vi.useRealTimers();
});
const respond = (worker: TasklaneTestWorker, value: unknown) => {
  const bytes = encodeWorkerData(value);
  worker.pending.at(-1)!.resolve(output(bytes, [bytes.buffer]));
};

describe('tasklane Mapshaper ownership', () => {
  it('spawns lazily and serializes work without a hidden worker-side queue', async () => {
    const client = pool();
    expect(TasklaneTestWorker.instances).toHaveLength(0);
    const first = client.run('-clean', { datasets: [] });
    const second = client.run('-dissolve', { datasets: [] });
    await flushTasks();
    const worker = TasklaneTestWorker.instances[0];
    expect(worker.requests).toHaveLength(1);
    respond(worker, { datasets: ['first'] });
    await expect(first).resolves.toEqual({ datasets: ['first'] });
    await flushTasks();
    expect(worker.requests).toHaveLength(2);
    respond(worker, { datasets: ['second'] });
    await expect(second).resolves.toEqual({ datasets: ['second'] });
    expect(TasklaneTestWorker.instances).toHaveLength(1);
  });
  it('binary-encodes 50000 shapes without losing fields or caller-owned buffers', async () => {
    const client = pool();
    const packed = {
      datasets: [
        {
          layers: [
            {
              shapes: Array.from({ length: 50000 }, (_, i) => [[i, i + 1]]),
              fields: [{ name: 'id', type: 'number' }],
            },
          ],
        },
      ],
      bytes: new Uint8Array([1, 2, 3]),
    };
    const work = client.run([{ name: 'clean', options: {} }], packed, { 'data.csv': 'id\n1' });
    await flushTasks();
    const worker = TasklaneTestWorker.instances[0];
    const request = worker.requests[0].payload;
    expect(await decodeWorkerData(request.bytes)).toEqual(packed);
    expect(request.commands).toEqual([{ name: 'clean', options: {} }]);
    expect(request.inputFiles).toEqual({ 'data.csv': 'id\n1' });
    expect(packed.bytes.byteLength).toBe(3);
    respond(worker, packed);
    await expect(work).resolves.toEqual(packed);
  });
  it('cancelAll rejects running and queued tasks and permits a fresh generation', async () => {
    const client = pool();
    const a = client.run('-clean', { datasets: [] }),
      b = client.run('-clean', { datasets: [] });
    const failures = Promise.all([
      expect(a).rejects.toMatchObject({ name: 'AbortError' }),
      expect(b).rejects.toMatchObject({ name: 'AbortError' }),
    ]);
    await flushTasks();
    const old = TasklaneTestWorker.instances[0];
    client.cancelAll();
    await failures;
    expect(old.terminate).toHaveBeenCalledOnce();
    const fresh = client.run('-clean', { datasets: [] });
    await flushTasks();
    respond(old, { datasets: ['stale'] });
    respond(TasklaneTestWorker.instances.at(-1)!, { datasets: ['fresh'] });
    await expect(fresh).resolves.toEqual({ datasets: ['fresh'] });
  });
  it('does not prepare queued inputs until budgets are available', async () => {
    const client = pool(),
      first = client.run('-clean', { datasets: [] });
    const prepare = vi.fn(async () => ({ datasets: [] }));
    const second = client.dispatchPreparedWithId(client.reserveId(), '-clean', prepare);
    await flushTasks();
    expect(prepare).not.toHaveBeenCalled();
    respond(TasklaneTestWorker.instances[0], { datasets: [] });
    await first;
    await flushTasks();
    expect(prepare).toHaveBeenCalledOnce();
    respond(TasklaneTestWorker.instances.at(-1)!, { datasets: [] });
    await second;
  });
  it('preserves remote errors and recovers after a crash', async () => {
    const client = pool(),
      first = client.run('-bad', { datasets: [] });
    const failed = expect(first).rejects.toThrow('bad command');
    await flushTasks();
    TasklaneTestWorker.instances[0].pending[0].reject(new Error('bad command'));
    await failed;
    const next = client.run('-clean', { datasets: [] }),
      failure = expect(next).rejects.toThrow('crashed');
    await flushTasks();
    TasklaneTestWorker.instances[0].crash('crashed');
    await failure;
    const third = client.run('-clean', { datasets: [] });
    await flushTasks();
    respond(TasklaneTestWorker.instances.at(-1)!, { datasets: [] });
    await third;
  });
  it('bounds stuck execution and rejects use after destruction', async () => {
    const client = pool(1, 10),
      work = client.run('-clean', { datasets: [] });
    await expect(work).rejects.toThrow(/deadline|timeout|timed out/i);
    await flushTasks();
    expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const id = client.reserveId();
    client.destroy();
    client.destroy();
    await client.closed;
    await expect(client.dispatchWithId(id, '-clean', { datasets: [] })).rejects.toThrow(
      'destroyed',
    );
    expect(client.reserveId()).toBeGreaterThan(id);
  });
  it('honors explicit transfer ownership and validates timeout options', async () => {
    for (const timeout of [0, -1, 1.5, Infinity, 2_147_483_648])
      expect(() => pool(1, timeout)).toThrow('jobTimeoutMs');
    const client = pool(),
      bytes = new Uint8Array([1, 2]);
    const work = client.dispatchWithId(
      client.reserveId(),
      '-clean',
      { datasets: [], bytes },
      undefined,
      [bytes.buffer],
    );
    await flushTasks();
    expect(bytes.byteLength).toBe(0);
    respond(TasklaneTestWorker.instances[0], { datasets: [] });
    await work;
  });
});

it('preserves requested physical parallelism across independent Mapshaper jobs', async () => {
  const client = pool(2),
    first = client.run('-clean', { datasets: [] }),
    second = client.run('-clean', { datasets: [] });
  await flushTasks();
  expect(TasklaneTestWorker.instances).toHaveLength(2);
  respond(TasklaneTestWorker.instances[1], { datasets: ['second'] });
  await expect(second).resolves.toEqual({ datasets: ['second'] });
  respond(TasklaneTestWorker.instances[0], { datasets: ['first'] });
  await expect(first).resolves.toEqual({ datasets: ['first'] });
});
