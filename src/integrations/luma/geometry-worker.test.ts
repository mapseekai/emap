import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { output } from '@mapseekai/tasklane/host';
import { GeometryWorker } from './geometry-worker';
import { TasklaneTestWorker, flushTasks } from '../../../test/helpers/tasklane-worker';
import type { GeometryPacket } from '../../engine/rendering/luma/geometry-jobs';
const clients: GeometryWorker[] = [];
function client() {
  const value = new GeometryWorker(new URL('http://example.test/worker.js'));
  clients.push(value);
  return value;
}
function packet(): GeometryPacket {
  return {
    kind: 'point',
    coordinates: Float64Array.from([1, 2]),
    offsets: Uint32Array.from([0, 1]),
    features: Uint32Array.from([0, 1]),
  };
}
const geometry = { geometries: [], screenSpace: false };
beforeEach(() => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = {};
  vi.stubGlobal('Worker', TasklaneTestWorker);
});
afterEach(async () => {
  for (const value of clients.splice(0)) value.dispose();
  await flushTasks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('creates lazily, transfers packet ownership and reuses its Session', async () => {
  const value = client();
  expect(TasklaneTestWorker.instances).toHaveLength(0);
  for (let i = 0; i < 2; i++) {
    const input = packet(),
      work = value.build(input, new AbortController().signal);
    await flushTasks();
    const worker = TasklaneTestWorker.instances[0];
    expect(input.coordinates.byteLength).toBe(0);
    expect(worker.requests[i].payload.packet.coordinates).toEqual(Float64Array.from([1, 2]));
    worker.pending[i].resolve(output({ result: geometry, cache: { bytes: 16, entries: 1 } }));
    await work;
  }
  expect(TasklaneTestWorker.instances).toHaveLength(1);
  expect(value.stats.jobs).toBe(2);
  expect(value.stats.inputBytes).toBe(0);
});
it('retains source identities and per-item batch errors', async () => {
  const value = client();
  value.retainSources(new Set(['a']));
  const work = value.buildBatch([packet(), packet()], new AbortController().signal);
  await flushTasks();
  const worker = TasklaneTestWorker.instances[0];
  expect(worker.requests[0].payload.retainSources).toEqual(['a']);
  worker.pending[0].resolve(
    output({
      results: [{ result: geometry }, { error: 'invalid ring' }],
      cache: { bytes: 0, entries: 0 },
    }),
  );
  expect(await work).toEqual([{ result: geometry }, { error: 'invalid ring' }]);
  expect(value.stats.jobs).toBe(1);
  expect(value.stats.batchedJobs).toBe(2);
});
it('hard-cancels a running task and gets a new generation on retry', async () => {
  const value = client(),
    controller = new AbortController();
  const work = value.build(packet(), controller.signal);
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await flushTasks();
  const old = TasklaneTestWorker.instances[0];
  controller.abort();
  await rejected;
  expect(old.terminate).toHaveBeenCalledOnce();
  const next = value.build(packet(), new AbortController().signal);
  await flushTasks();
  old.pending[0].resolve(output({ result: geometry }));
  TasklaneTestWorker.instances.at(-1)!.pending[0].resolve(output({ result: geometry }));
  await next;
  expect(value.stats.jobs).toBe(1);
});
it.each(['single', 'batch'])('rejects late %s delivery after cancellation', async (kind) => {
  const value = client(),
    controller = new AbortController();
  const work =
    kind === 'single'
      ? value.build(packet(), controller.signal)
      : value.buildBatch([packet(), packet()], controller.signal);
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await flushTasks();
  TasklaneTestWorker.instances[0].pending[0].resolve(
    output(
      kind === 'single'
        ? { result: geometry }
        : { results: [{ result: geometry }, { result: geometry }] },
    ),
  );
  controller.abort();
  await rejected;
});
it('rejects oversized batches before transfer and validates result identities', async () => {
  const value = client(),
    input = packet();
  input.coordinates = new Float64Array(300000);
  await expect(value.buildBatch([input, packet()], new AbortController().signal)).rejects.toThrow(
    'batch',
  );
  expect(input.coordinates.byteLength).toBeGreaterThan(0);
  expect(TasklaneTestWorker.instances).toHaveLength(0);
  const work = value.buildBatch([packet(), packet()], new AbortController().signal),
    rejected = expect(work).rejects.toThrow('Invalid geometry');
  await flushTasks();
  TasklaneTestWorker.instances[0].pending[0].resolve(output({ results: [{ result: geometry }] }));
  await rejected;
});
it('reports Worker failure, disposes pending work and refuses subsequent builds', async () => {
  const value = client(),
    work = value.build(packet(), new AbortController().signal),
    rejected = expect(work).rejects.toThrow('decode failure');
  await flushTasks();
  TasklaneTestWorker.instances[0].crash('decode failure');
  await rejected;
  const next = value.build(packet(), new AbortController().signal),
    disposed = expect(next).rejects.toMatchObject({ name: 'AbortError' });
  value.dispose();
  await disposed;
  await expect(value.build(packet(), new AbortController().signal)).rejects.toThrow('disposed');
});
it('releases removed-source caches without requiring another geometry build', async () => {
  const value = client();
  const build = value.build(packet(), new AbortController().signal);
  await flushTasks();
  const worker = TasklaneTestWorker.instances[0];
  worker.pending[0].resolve(output({ result: geometry, cache: { bytes: 64, entries: 1 } }));
  await build;
  value.retainSources(new Set(['remaining']));
  await flushTasks();
  expect(worker.requests[1].payload).toEqual({ retainSources: ['remaining'] });
  worker.pending[1].resolve(output({ cache: { bytes: 0, entries: 0 } }));
  await flushTasks();
  expect(value.triangulation.bytes).toBe(0);
  expect(value.stats.jobs).toBe(1);
});
