import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { output } from '@mapseekai/tasklane/host';
import { importGeoPackageInWorker } from './worker';
import { TasklaneTestWorker, flushTasks } from '../../../test/utils/tasklane-worker';
import { encodeWorkerData } from '../mapshaper/binary';
const options = { workerUrl: 'https://example.test/worker.js' };
beforeEach(() => {
  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = {};
  vi.stubGlobal('Worker', TasklaneTestWorker);
});
afterEach(async () => {
  for (const worker of TasklaneTestWorker.instances) worker.terminate();
  await flushTasks();
  vi.unstubAllGlobals();
});
it('rejects pre-aborted work and partial transfer buffers without constructing a Worker', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    importGeoPackageInWorker(new Uint8Array(10), { ...options, signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await expect(
    importGeoPackageInWorker(new Uint8Array(10).subarray(1), { ...options, transferInput: true }),
  ).rejects.toThrow('entire owned ArrayBuffer');
  expect(TasklaneTestWorker.instances).toHaveLength(0);
});
it.each([
  false,
  true,
])('transfers input only with explicit ownership (%s)', async (transferInput) => {
  const controller = new AbortController(),
    bytes = new Uint8Array([1, 2, 3]);
  const work = importGeoPackageInWorker(bytes, {
    ...options,
    transferInput,
    signal: controller.signal,
  });
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await flushTasks();
  expect(TasklaneTestWorker.instances[0].requests[0].payload.bytes).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(bytes.byteLength).toBe(transferInput ? 0 : 3);
  controller.abort();
  await rejected;
  expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it('preserves remote error names and closes the failed import', async () => {
  TasklaneTestWorker.handlers = {
    import: () => {
      throw new RangeError('limit exceeded');
    },
  };
  await expect(importGeoPackageInWorker(new Uint8Array(10), options)).rejects.toMatchObject({
    name: 'RangeError',
    message: 'limit exceeded',
  });
  expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it('allows a large import beyond two minutes while keeping a bounded execution deadline', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let failure: unknown;
  const work = importGeoPackageInWorker(new Uint8Array(1), {
    ...options,
    signal: controller.signal,
  });
  const settled = work.catch((error) => {
    failure = error;
  });
  try {
    await flushTasks();
    await vi.advanceTimersByTimeAsync(120_001);
    expect(failure).toBeUndefined();
    expect(TasklaneTestWorker.instances[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(480_000);
    await settled;
    expect(failure).toMatchObject({ message: 'Task exceeded its physical execution deadline' });
    expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  } finally {
    controller.abort();
    await settled;
    vi.useRealTimers();
  }
});
it('pulls final arcs as data before the done sentinel and returns a complete dataset', async () => {
  let sequence = 0;
  const messages = [
    {
      type: 'header',
      sequence: 0,
      layers: [{ name: 'p', geometry_type: 'polyline', rows: 0 }],
      info: {
        geopackage: {
          tables: [],
          dimensions: 'xy',
          integerEncoding: 'safe-number-or-decimal-string',
        },
      },
    },
    {
      type: 'result',
      sequence: 1,
      arcs: {
        nn: new Uint32Array([2]),
        xx: new Float64Array([0, 1]),
        yy: new Float64Array([0, 1]),
      },
    },
  ];
  TasklaneTestWorker.handlers = {
    import: () => output(null),
    next: () =>
      output(
        sequence === messages.length
          ? { done: true }
          : { done: false, token: String(sequence), outputBytes: 1024 * 1024 },
      ),
    take: () => {
      const bytes = encodeWorkerData(messages[sequence++]);
      return output(bytes, [bytes.buffer]);
    },
  };
  const result = await importGeoPackageInWorker(new Uint8Array(1), options);
  expect(result.layers[0].shapes).toEqual([]);
  expect(result.arcs!.getPointCount?.()).toBe(2);
  expect(TasklaneTestWorker.instances[0].requests.map((r) => r.name)).toEqual([
    'import',
    'next',
    'take',
    'next',
    'take',
    'next',
  ]);
  expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it('cancellation discards an incomplete stream and closes its Session', async () => {
  TasklaneTestWorker.handlers = { import: () => output(null) };
  const controller = new AbortController(),
    work = importGeoPackageInWorker(new Uint8Array(1), { ...options, signal: controller.signal });
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await flushTasks();
  expect(TasklaneTestWorker.instances[0].requests.map((r) => r.name)).toEqual(['import', 'next']);
  controller.abort();
  await rejected;
  expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it('propagates a progress callback failure and physically closes the import', async () => {
  TasklaneTestWorker.handlers = {
    import: async (_payload, ctx) => {
      ctx.progress({ phase: 'scan', rows: 0 });
      await ctx.checkpoint();
      return output(null);
    },
  };
  await expect(
    importGeoPackageInWorker(new Uint8Array(1), {
      ...options,
      onProgress() {
        throw new Error('progress failed');
      },
    }),
  ).rejects.toThrow('progress failed');
  expect(TasklaneTestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
