import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeometryWorker } from './geometry-worker';
import type { GeometryPacket } from '../../engine/rendering/luma/geometry-jobs';
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  sent: any[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown, transfer: unknown) {
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
}
function packet(): GeometryPacket {
  return {
    kind: 'point',
    coordinates: Float64Array.from([1, 2]),
    offsets: Uint32Array.from([0, 1]),
    features: Uint32Array.from([0, 1]),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.instances = [];
});
describe('bounded geometry Worker lifecycle', () => {
  it('creates lazily, transfers owned packet buffers, and reuses one Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new GeometryWorker(new URL('http://example.test/worker.js'));
    expect(FakeWorker.instances).toHaveLength(0);
    const input = packet(),
      task = client.build(input, new AbortController().signal),
      worker = FakeWorker.instances[0];
    expect(worker.sent[0].transfer).toEqual([
      input.coordinates.buffer,
      input.offsets.buffer,
      input.features.buffer,
    ]);
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { id: 1, result: { geometries: [], screenSpace: false }, elapsedMs: 4 },
      }),
    );
    await task;
    const second = client.build(packet(), new AbortController().signal);
    expect(FakeWorker.instances).toHaveLength(1);
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { id: 2, result: { geometries: [], screenSpace: false }, elapsedMs: 2 },
      }),
    );
    await second;
    expect(client.stats.jobs).toBe(2);
    expect(client.stats.workerMs).toBe(6);
    expect(client.stats.inputBytes).toBe(0);
    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(client.stats.workers).toBe(0);
  });
  it('terminates computation on abort and ignores late results', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new GeometryWorker(new URL('http://example.test/worker.js')),
      abort = new AbortController();
    const result = client.build(packet(), abort.signal);
    abort.abort();
    await expect(result).rejects.toThrow('cancelled');
    const worker = FakeWorker.instances[0];
    expect(worker.terminated).toBe(true);
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { id: 1, result: { geometries: [], screenSpace: false } },
      }),
    );
    expect(client.stats.jobs).toBe(0);
    client.dispose();
  });
  it('reports decode failure and times out a stuck Worker without leaving listeners or reservations', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const client = new GeometryWorker(new URL('http://example.test/worker.js'));
    const first = client.build(packet(), new AbortController().signal);
    FakeWorker.instances[0].dispatchEvent(new Event('messageerror'));
    await expect(first).rejects.toThrow('decoded');
    const second = client.build(packet(), new AbortController().signal),
      rejection = expect(second).rejects.toThrow('timed out');
    vi.advanceTimersByTime(120000);
    await rejection;
    expect(client.stats.inputBytes).toBe(0);
    expect(client.stats.workers).toBe(0);
    client.dispose();
  });
  it('rejects queued work on disposal and refuses subsequent jobs', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new GeometryWorker(new URL('http://example.test/worker.js'));
    const result = client.build(packet(), new AbortController().signal);
    client.dispose();
    await expect(result).rejects.toThrow('disposed');
    await expect(client.build(packet(), new AbortController().signal)).rejects.toThrow('disposed');
  });
});

it('coalesces bounded packets into one transfer while retaining logical job/error identities', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new GeometryWorker(new URL('http://example.test/worker.js'));
  const inputs = [packet(), packet()],
    task = client.buildBatch(inputs, new AbortController().signal);
  const worker = FakeWorker.instances[0];
  expect(worker.sent[0].message.packets).toEqual(inputs);
  expect(worker.sent[0].transfer).toHaveLength(6);
  worker.dispatchEvent(
    new MessageEvent('message', {
      data: {
        id: 1,
        results: [{ result: { geometries: [], screenSpace: false } }, { error: 'invalid ring' }],
        elapsedMs: 3,
      },
    }),
  );
  expect(await task).toHaveLength(2);
  expect(client.stats.messages).toBe(1);
  expect(client.stats.jobs).toBe(1);
  expect(client.stats.inputBytes).toBe(0);
  expect(worker.terminated).toBe(false);
  client.dispose();
});
it('rejects oversized batches before detaching input or starting a Worker', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new GeometryWorker(new URL('http://example.test/worker.js'));
  const a = packet();
  a.coordinates = new Float64Array(300000);
  await expect(client.buildBatch([a, packet()], new AbortController().signal)).rejects.toThrow(
    'batch',
  );
  await expect(
    client.buildBatch(Array.from({ length: 9 }, packet), new AbortController().signal),
  ).rejects.toThrow('batch');
  expect(a.coordinates.byteLength).toBe(2400000);
  expect(FakeWorker.instances).toHaveLength(0);
  client.dispose();
});

it('cancels a whole native batch, ignores a late reply and rejects a mismatched response', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new GeometryWorker(new URL('http://example.test/worker.js')),
    controller = new AbortController();
  const task = client.buildBatch([packet(), packet()], controller.signal);
  const first = FakeWorker.instances[0];
  controller.abort();
  await expect(task).rejects.toThrow('cancelled');
  first.dispatchEvent(
    new MessageEvent('message', {
      data: { id: 1, results: [{ result: { geometries: [], screenSpace: false } }] },
    }),
  );
  expect(first.terminated).toBe(true);
  expect(client.stats.jobs).toBe(0);
  expect(client.stats.inputBytes).toBe(0);
  const second = client.buildBatch([packet(), packet()], new AbortController().signal);
  FakeWorker.instances[1].dispatchEvent(
    new MessageEvent('message', { data: { id: 2, results: [] } }),
  );
  await expect(second).rejects.toThrow('Invalid');
  expect(FakeWorker.instances[1].terminated).toBe(true);
  client.dispose();
});
