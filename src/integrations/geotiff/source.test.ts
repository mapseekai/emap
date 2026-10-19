import { TasklaneTestWorker, flushTasks } from '../../../test/helpers/tasklane-worker';
import { output } from '@mapseekai/tasklane/host';
import { createEmapWorkerRuntime } from '../tasklane/runtime';
import { planRasterTile } from '../../engine/rendering/raster/tile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openGeoTIFF, openGeoTIFFHandle, type OpenGeoTIFFOptions } from './source';
import { GEOTIFF_WORKER_PROTOCOL_VERSION } from './worker-protocol';
import type { GeoTIFFWorkerRequest, GeoTIFFWorkerResponse } from './worker-protocol';
import type { RasterTaskDiagnostics, RasterMetadata } from '../../domain/raster/types';
const metadata: RasterMetadata = {
  filename: 'image.tif',
  fileSize: 8,
  lastModified: 12,
  crs: 'EPSG:4326',
  bounds: [0, 0, 1, 1],
  origin: [0, 1],
  resolution: [1, -1],
  noData: null,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 1,
      height: 1,
      tileWidth: 1,
      tileHeight: 1,
      samples: 1,
      bits: [8],
      formats: [1],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
class FakeWorker extends TasklaneTestWorker {
  static override instances: FakeWorker[] = [];
  onmessage = null;
  onerror = (event: { message: string }) => this.crash(event.message);
  onmessageerror = () => this.dispatchEvent(new Event('messageerror'));
  constructor(url: string | URL, options: WorkerOptions) {
    super(url, options);
    FakeWorker.instances.push(this);
  }
  get messages(): GeoTIFFWorkerRequest[] {
    return this.requests.flatMap(({ payload, context }, index) => [
      { ...payload, id: index + 1 },
      ...(context.signal.aborted ? [{ id: index + 1, type: 'cancel' }] : []),
    ]);
  }
  reply(message: GeoTIFFWorkerResponse) {
    const pending = this.pending[message.id - 1];
    if (!pending) throw new Error(`Missing raster request ${message.id}`);
    if (message.type === 'error') {
      const error = new Error(message.message);
      Object.assign(error, { name: message.name, code: message.code });
      pending.reject(error);
    } else
      pending.resolve(
        output(
          message.type === 'metadata'
            ? { protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION, ...message }
            : { ...message, sessionId: this.requests[message.id - 1].context.sessionId },
        ),
      );
  }
}
const file = () => new File([new Uint8Array(8)], 'image.tif', { lastModified: 12 });
async function opened(
  workerCount = 1,
  directoryBytes?: number,
  rasterMetadata: RasterMetadata = metadata,
  options: OpenGeoTIFFOptions = {},
) {
  const pending = openGeoTIFF(file(), { workerUrl: '/worker.js', workerCount, ...options }),
    worker = (await flushTasks(), FakeWorker.instances.at(-1)!);
  await flushTasks();
  worker.reply({ id: 1, type: 'metadata', metadata: rasterMetadata, directoryBytes });
  await flushTasks();
  await flushTasks();
  const configure = worker.messages.at(-1);
  if (configure?.type === 'configure') worker.reply({ id: configure.id, type: 'configured' });
  return { worker, source: await pending };
}
beforeEach(() => {
  FakeWorker.instances = [];
  TasklaneTestWorker.handlers = {};
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(async () => {
  for (const worker of FakeWorker.instances) worker.terminate();
  await flushTasks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Worker-backed external raster sources', () => {
  it('caps aggregate source cache across primary and replica without changing default policy', async () => {
    const level = {
      ...metadata.levels[0],
      width: 54798,
      height: 56561,
      tileWidth: 54798,
      tileHeight: 1,
      samples: 3,
      bits: [16, 16, 16],
      formats: [1, 1, 1],
    };
    const striped = {
      ...metadata,
      levels: [
        level,
        { ...level, id: 1, width: 1000, height: 1000, tileWidth: 128, tileHeight: 128 },
      ],
    };
    const { source, worker } = await opened(2, 1000, striped, { blockCacheBytes: 32 * 1024 ** 2 });
    try {
      await flushTasks();
      const configure = worker.messages.find((m) => m.type === 'configure');
      expect(configure).toMatchObject({ cacheBytes: 28 * 1024 ** 2 });
      await flushTasks();
      const replica = FakeWorker.instances.at(-1)!;
      await flushTasks();
      expect(replica.messages[0]).toMatchObject({ cacheBytes: 4 * 1024 ** 2 });
      expect(source.getProcessingStats!().blockCacheLimitBytes).toBe(32 * 1024 ** 2);
    } finally {
      source.dispose();
      await flushTasks();
    }
  });
  it.each([
    0,
    -1,
    7 * 1024 ** 2,
    257 * 1024 ** 2,
    NaN,
    Infinity,
    8 * 1024 ** 2 + 0.5,
  ])('rejects invalid explicit cache budget %s before creating a Worker', async (blockCacheBytes) => {
    await expect(openGeoTIFF(file(), { workerUrl: '/worker.js', blockCacheBytes })).rejects.toThrow(
      /cache|budget/i,
    );
    await flushTasks();
    expect(FakeWorker.instances).toHaveLength(0);
  });
  it('reports raw numeric read cache memory without counting the read as a rendered tile', async () => {
    const { source, worker } = await opened();
    try {
      const pending = source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] });
      await flushTasks();
      const request = worker.messages.at(-1)!;
      const diagnostics = {
        blockCacheBytes: 1024,
        blockCacheEntries: 2,
        blockCachePeakBytes: 2048,
        blockCachePeakEntries: 3,
        blockCacheLimitBytes: 8 * 1024 ** 2,
      } as RasterTaskDiagnostics;
      await flushTasks();
      worker.reply({
        id: request.id,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array(1)], diagnostics },
      });
      await pending;
      expect(source.getProcessingStats!()).toMatchObject({
        blockCacheBytes: 1024,
        blockCacheEntries: 2,
        blockCachePeakBytes: 2048,
        blockCachePeakEntries: 3,
        renderedTiles: 0,
      });
    } finally {
      source.dispose();
      await flushTasks();
    }
  });
  it('transfers packed integer results and reports their cache gauges without pretending to render', async () => {
    const { source, worker } = await opened(1, 1000, {
      ...metadata,
      levels: [
        { ...metadata.levels[0], samples: 3, bits: [8, 8, 8], formats: [1, 1, 1], photometric: 2 },
      ],
    });
    try {
      const pending = source.readTexture!({ level: 0, window: [0, 0, 1, 1], samples: [0, 1, 2] });
      await flushTasks();
      const request = worker.messages.at(-1)!;
      expect(request.type).toBe('texture');
      await flushTasks();
      worker.reply({
        id: request.id,
        type: 'texture',
        result: {
          width: 1,
          height: 1,
          bits: 8,
          data: new Uint8Array([3, 7, 19, 0]),
          diagnostics: {
            blockCacheBytes: 2048,
            blockCacheEntries: 1,
            blockCachePeakBytes: 2048,
            blockCachePeakEntries: 1,
            blockCacheLimitBytes: 8 * 1024 ** 2,
          } as RasterTaskDiagnostics,
        },
      });
      const result = await pending;
      expect(Array.from(result.data)).toEqual([3, 7, 19, 0]);
      expect(source.getProcessingStats!()).toMatchObject({
        blockCacheBytes: 2048,
        renderedTiles: 0,
      });
    } finally {
      source.dispose();
      await flushTasks();
    }
  });
  it('passes a File reference into a classic Worker and returns only external references', async () => {
    const { worker, source } = await opened();
    expect(worker.options?.type).toBe('classic');
    await flushTasks();
    expect(worker.messages[0]).toMatchObject({ type: 'open', file: expect.any(File) });
    expect(source.toReference()).toEqual({
      kind: 'raster',
      storage: 'external-file',
      format: 'geotiff',
      filename: 'image.tif',
      fileSize: 8,
      lastModified: 12,
      crs: 'EPSG:4326',
    });
    const result = source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] });
    await flushTasks();
    worker.reply({
      id: 2,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([42])] },
    });
    expect((await result).data[0][0]).toBe(42);
    source.dispose();
    await flushTasks();
    await flushTasks();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('forwards the NoData override to the GeoTIFF Worker open command', async () => {
    const pending = openGeoTIFF(file(), { noData: -9999 });
    const worker = (await flushTasks(), FakeWorker.instances[0]);
    await flushTasks();
    expect(worker.messages[0]).toMatchObject({ type: 'open', noData: -9999 });
    await flushTasks();
    worker.reply({
      id: 1,
      type: 'metadata',
      protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION,
      metadata: { ...metadata, noData: -9999 },
      directoryBytes: 1024,
    });
    const source = await pending;
    expect(source.metadata.noData).toBe(-9999);
    source.dispose();
    await flushTasks();
  });

  it('preserves structured pyramid failures and terminates failed opens', async () => {
    const pending = openGeoTIFF(file()),
      worker = (await flushTasks(), FakeWorker.instances[0]);
    const failure = expect(pending).rejects.toMatchObject({ code: 'PYRAMID_REQUIRED' });
    await flushTasks();
    worker.reply({
      id: 1,
      type: 'error',
      name: 'RasterError',
      code: 'PYRAMID_REQUIRED',
      message: 'Create pyramids first',
    });
    await failure;
    await flushTasks();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('cancels pending reads, ignores late replies and disposes all waiters', async () => {
    const { worker, source } = await opened(),
      controller = new AbortController();
    const pending = source.readWindow(
      { level: 0, window: [0, 0, 1, 1], samples: [0] },
      controller.signal,
    );
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flushTasks();
    controller.abort();
    await failure;
    await flushTasks();
    expect(worker.messages.at(-1)).toEqual({ id: 2, type: 'cancel' });
    await flushTasks();
    worker.reply({
      id: 2,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([99])] },
    });
    const next = source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] });
    const disposed = expect(next).rejects.toMatchObject({ name: 'AbortError' });
    source.dispose();
    await flushTasks();
    source.dispose();
    await flushTasks();
    await disposed;
    await flushTasks();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });
  it('bounds a stuck Worker request and reports asset startup failures', async () => {
    vi.useFakeTimers();
    const pending = openGeoTIFF(file()),
      worker = (await flushTasks(), FakeWorker.instances[0]);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'RASTER_WORKER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    await flushTasks();
    expect(worker.terminate).toHaveBeenCalled();
    const second = openGeoTIFF(file()),
      failure = expect(second).rejects.toMatchObject({ code: 'RASTER_WORKER_FAILED' });
    await flushTasks();
    FakeWorker.instances[1].onerror?.({ message: 'Invalid MIME' });
    await failure;
  });
  it('requires relinking changed original or overview files before starting a Worker', async () => {
    const handle = { getFile: vi.fn(async () => file()) } as unknown as FileSystemFileHandle;
    const expected = {
      kind: 'raster' as const,
      storage: 'external-file' as const,
      format: 'geotiff' as const,
      filename: 'image.tif',
      fileSize: 9,
      lastModified: 12,
      crs: 'EPSG:4326',
    };
    await expect(openGeoTIFFHandle(handle, { expected })).rejects.toMatchObject({
      code: 'RASTER_FILE_CHANGED',
    });
    await expect(
      openGeoTIFFHandle(handle, {
        expected: {
          ...expected,
          fileSize: 8,
          overviewFile: { filename: 'image.tif.ovr', fileSize: 100, lastModified: 12 },
        },
      }),
    ).rejects.toMatchObject({ code: 'OVERVIEW_FILE_CHANGED' });
    await flushTasks();
    expect(FakeWorker.instances).toHaveLength(0);
  });
  it('cleans every timer and signal listener across completed and cancelled reads', async () => {
    vi.useFakeTimers();
    const { worker, source } = await opened();
    for (let i = 0; i < 80; i++) {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener'),
        remove = vi.spyOn(controller.signal, 'removeEventListener');
      const read = source.readWindow(
        { level: 0, window: [0, 0, 1, 1], samples: [0] },
        controller.signal,
      );
      await flushTasks();
      const id = worker.messages.at(-1)!.id;
      if (i % 2) {
        const failure = expect(read).rejects.toMatchObject({ name: 'AbortError' });
        await flushTasks();
        controller.abort();
        await failure;
        // Cancelled callers settle immediately, but a bounded physical slot and
        // watchdog remain until the Worker acknowledges its actual completion.
        await flushTasks();
        expect(vi.getTimerCount()).toBe(1);
        await flushTasks();
        worker.reply({ id, type: 'error', name: 'AbortError', message: 'cancelled' });
      } else {
        await flushTasks();
        worker.reply({
          id,
          type: 'result',
          result: { width: 1, height: 1, data: [new Uint8Array([1])] },
        });
        await read;
      }
      await flushTasks();
      expect(remove.mock.calls.length).toBe(add.mock.calls.length);
      await flushTasks();
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(Reflect.get(source, 'pending').size).toBe(0);
    source.dispose();
    await flushTasks();
  });
  it('settles cancelled callers even when sending the cancellation message fails', async () => {
    const { worker, source } = await opened(),
      controller = new AbortController();
    const read = source.readWindow(
      { level: 0, window: [0, 0, 1, 1], samples: [0] },
      controller.signal,
    );
    const failure = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await flushTasks();
    vi.spyOn(worker, 'postMessage').mockImplementation(() => {
      throw new Error('closed worker port');
    });
    await flushTasks();
    controller.abort();
    await failure;
    await flushTasks();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(Reflect.get(source, 'pending').size).toBe(0);
  });
});

describe('parallel raster pipeline pool', () => {
  const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
  const answer = async (worker: FakeWorker, value: number) =>
    worker.reply({
      id: worker.messages.at(-1)!.id,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([value])] },
    });
  it('reuses reported residency and dispatches cold work while a warm reader is busy', async () => {
    const tiled: RasterMetadata = {
      ...metadata,
      levels: [
        { ...metadata.levels[0], width: 2048, height: 512, tileWidth: 512, tileHeight: 512 },
      ],
    };
    const { source, worker } = await opened(2, 1000, tiled, { workerScheduling: 'cache-aware' });
    await flushTasks();
    const replica = FakeWorker.instances[1];
    replica.reply({ id: 1, type: 'metadata', metadata: tiled, directoryBytes: 1000 });
    await flushTasks();
    const first = source.readWindow(request);
    await flushTasks();
    const report = (target: FakeWorker, key: string) => {
      const ctx = target.requests.at(-1)!.context;
      ctx.cache
        .setResource('test-reader', {}, 1, () => {})
        .report({ keys: [key], usedBytes: 1, hits: 0, misses: 1, evictions: 0 });
    };
    report(worker, '0:0:0');
    await answer(worker, 10);
    await first;
    await flushTasks();
    const other = { level: 0, window: [512, 0, 513, 1] as const, samples: [0] };
    const second = source.readWindow(other);
    await flushTasks();
    report(replica, '0:1:0');
    await answer(replica, 20);
    await second;
    await flushTasks();
    // The primary is older, but the most recently used replica owns the requested block.
    const warm = source.readWindow(other);
    await flushTasks();
    expect(replica.messages.at(-1)).toMatchObject({ id: 3, type: 'read' });
    const cold = { ...other, window: [1024, 0, 1025, 1] as const };
    const overflow = source.readWindow(cold);
    await flushTasks();
    expect(worker.messages.at(-1)).toMatchObject({ id: 3, type: 'read', request: cold });
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 2, queuedTasks: 0 });
    await answer(replica, 21);
    await answer(worker, 22);
    expect((await warm).data[0][0]).toBe(21);
    expect((await overflow).data[0][0]).toBe(22);
    await flushTasks();
    const warmA = source.readWindow(other),
      warmB = source.readWindow(other);
    await flushTasks();
    expect(worker.messages.at(-1)).toMatchObject({ id: 3 });
    expect(replica.messages.at(-1)).toMatchObject({ id: 4, type: 'read' });
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
    // A second warm request must not consume the other physical reader's capacity.
    const thirdCold = source.readWindow(cold);
    await flushTasks();
    expect(worker.messages.at(-1)).toMatchObject({ id: 4, type: 'read', request: cold });
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 2, queuedTasks: 1 });
    await answer(replica, 23);
    await warmA;
    await flushTasks();
    expect(replica.messages.at(-1)).toMatchObject({ id: 5, type: 'read' });
    await answer(replica, 24);
    await warmB;
    await answer(worker, 25);
    expect((await thirdCold).data[0][0]).toBe(25);
    await flushTasks();
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 0, reservedBytes: 0 });
    source.dispose();
    await source.settled;
  });
  it('counts native waiting and execution per source when a shared runtime is saturated', async () => {
    const runtime = createEmapWorkerRuntime({
      sizes: { geotiff: 2 },
      limits: { maxActiveTasks: 1 },
    });
    const { source: first, worker: workerA } = await opened(1, 1000, metadata, {
      workerRuntime: runtime,
    });
    const { source: second, worker: workerB } = await opened(1, 1000, metadata, {
      workerRuntime: runtime,
    });
    try {
      const readA = first.readWindow(request),
        readB = second.readWindow(request);
      void Promise.allSettled([readA, readB]);
      await flushTasks();
      expect(first.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 0 });
      expect(second.getProcessingStats?.()).toMatchObject({
        busyWorkers: 0,
        peakWorkers: 0,
        queuedTasks: 1,
      });
      expect(workerB.messages.filter((m) => m.type === 'read')).toHaveLength(0);
      // Pressure may change after enqueue but before native admission. The
      // queued job must receive the current limit, not restore an old budget.
      expect(workerA.messages.at(-1)).toMatchObject({ cacheCapacityBytes: 128 * 1024 ** 2 });
      const diagnostics = runtime.diagnostics.bind(runtime);
      const pressure = vi.spyOn(runtime, 'diagnostics').mockImplementation(() => ({
        ...diagnostics(),
        memoryPressure: 'critical',
      }));
      await answer(workerA, 10);
      await readA;
      await flushTasks();
      expect(first.getProcessingStats?.()).toMatchObject({ busyWorkers: 0, queuedTasks: 0 });
      expect(second.getProcessingStats?.()).toMatchObject({
        busyWorkers: 1,
        peakWorkers: 1,
        queuedTasks: 0,
      });
      expect(workerB.messages.at(-1)).toMatchObject({ cacheCapacityBytes: 0 });
      pressure.mockRestore();
      await answer(workerB, 20);
      await readB;
      await flushTasks();
      first.dispose();
      second.dispose();
      await Promise.all([first.settled, second.settled]);
      expect(runtime.stats).toMatchObject({ workers: 0, leases: 0, resourceLeases: 0 });
      expect(runtime.stats.reserved.residentBytes).toBe(0);
    } finally {
      first.dispose();
      second.dispose();
      await Promise.all([first.settled, second.settled]);
      await runtime.dispose();
    }
  });
  it('lets a warming replica join the first cache-aware batch', async () => {
    const tiled = {
      ...metadata,
      levels: [
        { ...metadata.levels[0], width: 2048, height: 512, tileWidth: 512, tileHeight: 512 },
      ],
    };
    const { source, worker } = await opened(2, 1000, tiled, { workerScheduling: 'cache-aware' });
    const a = source.readWindow(request),
      b = source.readWindow({ ...request, window: [512, 0, 513, 1] });
    const reads = Promise.allSettled([a, b]);
    try {
      await flushTasks();
      const replica = FakeWorker.instances[1];
      replica.reply({ id: 1, type: 'metadata', metadata: tiled, directoryBytes: 1000 });
      await flushTasks();
      expect(replica.messages.at(-1)).toMatchObject({ type: 'read' });
      expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 2, queuedTasks: 0 });
      await answer(worker, 10);
      await answer(replica, 20);
      expect((await a).data[0][0]).toBe(10);
      expect((await b).data[0][0]).toBe(20);
    } finally {
      source.dispose();
      await source.settled;
      await reads;
    }
  });
  it('refreshes residency before submitting cold overflow', async () => {
    const tiled = {
      ...metadata,
      levels: [
        { ...metadata.levels[0], width: 2048, height: 512, tileWidth: 512, tileHeight: 512 },
      ],
    };
    const { source, worker } = await opened(2, 1000, tiled, { workerScheduling: 'cache-aware' });
    await flushTasks();
    const replica = FakeWorker.instances[1];
    replica.reply({ id: 1, type: 'metadata', metadata: tiled, directoryBytes: 1000 });
    await flushTasks();
    const a = source.readWindow(request),
      b = source.readWindow({ ...request, window: [512, 0, 513, 1] }),
      repeat = source.readWindow(request);
    const settled = Promise.allSettled([a, b, repeat]);
    try {
      await flushTasks();
      expect(source.getProcessingStats?.()).toMatchObject({
        dispatchedTasks: 2,
        busyWorkers: 2,
        queuedTasks: 1,
      });
      worker.requests
        .at(-1)!
        .context.cache.setResource('test-reader', {}, 1, () => {})
        .report({ keys: ['0:0:0'], usedBytes: 1, hits: 0, misses: 1, evictions: 0 });
      await answer(worker, 7);
      await a;
      await flushTasks();
      expect(worker.messages.at(-1)).toMatchObject({ id: 3, type: 'read', request });
      await answer(replica, 8);
      await b;
      await answer(worker, 7);
      expect((await repeat).data[0][0]).toBe(7);
    } finally {
      source.dispose();
      await source.settled;
      await settled;
    }
  });
  it('bounds grouped requests through native queuing and physical cancellation', async () => {
    const tiled = {
      ...metadata,
      levels: [
        { ...metadata.levels[0], width: 2048, height: 512, tileWidth: 512, tileHeight: 512 },
      ],
    };
    const { source, worker } = await opened(2, 1000, tiled, { workerScheduling: 'cache-aware' });
    await flushTasks();
    const replica = FakeWorker.instances[1];
    replica.reply({ id: 1, type: 'metadata', metadata: tiled, directoryBytes: 1000 });
    await flushTasks();
    const seed = source.readWindow(request);
    await flushTasks();
    worker.requests
      .at(-1)!
      .context.cache.setResource('test-reader', {}, 1, () => {})
      .report({ keys: ['0:0:0'], usedBytes: 1, hits: 0, misses: 1, evictions: 0 });
    await answer(worker, 7);
    await seed;
    await flushTasks();
    const controllers = Array.from({ length: 16 }, () => new AbortController());
    const reads = Promise.allSettled(controllers.map((c) => source.readWindow(request, c.signal)));
    try {
      await flushTasks();
      expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 15 });
      await expect(source.readWindow(request)).rejects.toMatchObject({
        code: 'RASTER_QUEUE_BUDGET',
      });
      const reserved = source.getProcessingStats!().reservedBytes;
      controllers[1].abort();
      await flushTasks();
      const afterQueuedCancel = source.getProcessingStats!().reservedBytes;
      expect(afterQueuedCancel).toBeLessThan(reserved);
      controllers[0].abort();
      await flushTasks();
      expect(source.getProcessingStats?.()).toMatchObject({
        busyWorkers: 1,
        queuedTasks: 14,
        reservedBytes: afterQueuedCancel,
      });
      const cold = source.readWindow({ ...request, window: [512, 0, 513, 1] });
      void cold.catch(() => {});
      await flushTasks();
      expect(replica.messages.at(-1)).toMatchObject({ type: 'read' });
      await expect(source.readWindow(request)).rejects.toMatchObject({
        code: 'RASTER_QUEUE_BUDGET',
      });
      await answer(replica, 9);
      expect((await cold).data[0][0]).toBe(9);
      worker.reply({
        id: worker.requests.length,
        type: 'error',
        name: 'AbortError',
        message: 'cancelled',
      });
      await flushTasks();
      expect(source.getProcessingStats?.().reservedBytes).toBeLessThan(afterQueuedCancel);
    } finally {
      source.dispose();
      await source.settled;
      await reads;
    }
    expect(source.getProcessingStats?.()).toMatchObject({
      busyWorkers: 0,
      queuedTasks: 0,
      reservedBytes: 0,
    });
  });
  it('keeps source-block affinity without head-of-line blocking other workers', async () => {
    const tiledMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width: 2048,
          height: 512,
          tileWidth: 512,
          tileHeight: 512,
        },
      ],
    };
    const { source, worker } = await opened(2, 1000, tiledMetadata);
    try {
      const sameBlock = { level: 0, window: [1, 0, 2, 1] as const, samples: [0] };
      const otherBlock = { level: 0, window: [512, 0, 513, 1] as const, samples: [0] };
      const first = source.readWindow(request),
        secondSameBlock = source.readWindow(sameBlock),
        thirdOtherBlock = source.readWindow(otherBlock);
      await flushTasks();
      expect(FakeWorker.instances).toHaveLength(2);
      await flushTasks();
      const replica = FakeWorker.instances[1];
      await flushTasks();
      expect(replica.messages[0]).toMatchObject({
        type: 'open',
        file: expect.any(File),
        cacheBytes: 4 * 1024 ** 2,
        pageLimit: 8,
      });
      await flushTasks();
      replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      await flushTasks();
      expect(worker.messages.filter((message) => message.type === 'read')).toHaveLength(1);
      await flushTasks();
      expect(replica.messages.at(-1)).toMatchObject({
        id: 2,
        type: 'read',
        request: { window: [512, 0, 513, 1] },
      });
      expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 2, queuedTasks: 1 });

      await answer(replica, 30);
      await flushTasks();
      worker.reply({
        id: 2,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([10])] },
      });
      expect((await first).data[0][0]).toBe(10);
      expect((await thirdOtherBlock).data[0][0]).toBe(30);
      await Promise.resolve();
      await flushTasks();
      expect(worker.messages.at(-1)).toMatchObject({
        id: 3,
        type: 'read',
        request: { window: [1, 0, 2, 1] },
      });
      await flushTasks();
      expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(1);
      await flushTasks();
      worker.reply({
        id: 3,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([20])] },
      });
      expect((await secondSameBlock).data[0][0]).toBe(20);
      expect(source.getProcessingStats?.()).toMatchObject({
        peakWorkers: 2,
        busyWorkers: 0,
        reservedBytes: 0,
      });
    } finally {
      source.dispose();
      await flushTasks();
    }
    await flushTasks();
    expect(FakeWorker.instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
  });
  it('keeps adjacent block pairs on the same Worker while preserving spatial sharding', async () => {
    const tiledMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width: 2048,
          height: 512,
          tileWidth: 512,
          tileHeight: 512,
        },
      ],
    };
    const { source } = await opened(2, 1000, tiledMetadata);
    try {
      await flushTasks();
      const replica = FakeWorker.instances[1];
      await flushTasks();
      replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      const block1 = source.readWindow({ level: 0, window: [600, 0, 700, 1], samples: [0] });
      const block2 = source.readWindow({ level: 0, window: [1100, 0, 1200, 1], samples: [0] });
      await flushTasks();
      expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(1);
      await answer(replica, 10);
      await block1;
      await Promise.resolve();
      await flushTasks();
      expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(2);
      await answer(replica, 20);
      await block2;
    } finally {
      source.dispose();
      await flushTasks();
    }
  });
  it('keeps block identity diagnostics disabled without affecting parallel reads', async () => {
    const tiledMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width: 1024,
          height: 512,
          tileWidth: 512,
          tileHeight: 512,
        },
      ],
    };
    const { source, worker } = await opened(2, 1000, tiledMetadata);
    try {
      await flushTasks();
      const replica = FakeWorker.instances[1];
      await flushTasks();
      replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      const left = source.readWindow({ level: 0, window: [400, 0, 600, 1], samples: [0] }),
        right = source.readWindow({ level: 0, window: [500, 0, 700, 1], samples: [0] });
      await flushTasks();
      expect(source.getProcessingStats?.().busyWorkers).toBe(2);
      await flushTasks();
      worker.reply({
        id: worker.messages.at(-1)!.id,
        type: 'result',
        result: { width: 200, height: 1, data: [new Uint8Array(200)] },
      });
      await flushTasks();
      replica.reply({
        id: replica.messages.at(-1)!.id,
        type: 'result',
        result: { width: 200, height: 1, data: [new Uint8Array(200)] },
      });
      await Promise.all([left, right]);
      expect(source.getProcessingStats?.()).toMatchObject({
        physicalBlockRequests: 0,
        uniquePhysicalBlocks: 0,
        blockLoads: 0,
        uniqueLoadedBlocks: 0,
        duplicateBlockLoads: 0,
        crossWorkerDuplicateLoads: 0,
        blockDiagnosticsTruncated: false,
        workerBlockStats: [],
      });
    } finally {
      source.dispose();
      await flushTasks();
    }
  });
  it('sizes tiled Worker caches for a bounded decoded-block working set', async () => {
    const tiledMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width: 4096,
          height: 4096,
          tileWidth: 512,
          tileHeight: 512,
          samples: 3,
          bits: [8, 8, 8],
          formats: [1, 1, 1],
          photometric: 2,
        },
      ],
    };
    const opening = openGeoTIFF(file(), { workerUrl: '/worker.js', workerCount: 2 });
    await flushTasks();
    const primary = FakeWorker.instances[0];
    await flushTasks();
    primary.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    await flushTasks();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: 8 * 1024 ** 2,
    });
    await flushTasks();
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    await flushTasks();
    const replica = FakeWorker.instances[1];
    await flushTasks();
    expect(replica.messages[0]).toMatchObject({
      type: 'open',
      cacheBytes: 8 * 1024 ** 2,
      pageLimit: 8,
    });
    await flushTasks();
    replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    source.dispose();
    await flushTasks();
  });
  it('caps a tiled Worker decoded-block cache at 16MiB', async () => {
    const tiledMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width: 8192,
          height: 8192,
          tileWidth: 1024,
          tileHeight: 1024,
          samples: 3,
          bits: [8, 8, 8],
          formats: [1, 1, 1],
          photometric: 2,
        },
      ],
    };
    const opening = openGeoTIFF(file(), { workerUrl: '/worker.js', workerCount: 2 });
    await flushTasks();
    const primary = FakeWorker.instances[0];
    await flushTasks();
    primary.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    await flushTasks();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: 16 * 1024 ** 2,
    });
    await flushTasks();
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    await flushTasks();
    const replica = FakeWorker.instances[1];
    await flushTasks();
    expect(replica.messages[0]).toMatchObject({ type: 'open', cacheBytes: 16 * 1024 ** 2 });
    await flushTasks();
    replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    source.dispose();
    await flushTasks();
  });
  it.each([
    [20_000, 44],
    [54_798, 121],
    [100_000, 128],
  ] as const)('sizes a %i-pixel row-striped primary cache from its decoded working set', async (width, expectedMiB) => {
    const stripedMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width,
          height: 4096,
          tileWidth: width,
          tileHeight: 1,
          samples: 3,
          bits: [16, 16, 16],
          formats: [1, 1, 1],
        },
      ],
    };
    const opening = openGeoTIFF(file(), { workerUrl: '/worker.js', workerCount: 1 });
    await flushTasks();
    const primary = FakeWorker.instances[0];
    await flushTasks();
    primary.reply({ id: 1, type: 'metadata', metadata: stripedMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    await flushTasks();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: expectedMiB * 1024 ** 2,
    });
    await flushTasks();
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    source.dispose();
    await flushTasks();
  });
  it('pins row-striped levels to an enlarged primary Worker cache', async () => {
    const stripedMetadata: RasterMetadata = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          width: 1024,
          height: 1024,
          tileWidth: 1024,
          tileHeight: 1,
        },
      ],
    };
    const opening = openGeoTIFF(file(), { workerUrl: '/worker.js', workerCount: 2 });
    await flushTasks();
    const primary = FakeWorker.instances[0];
    await flushTasks();
    primary.reply({ id: 1, type: 'metadata', metadata: stripedMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    await flushTasks();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: 32 * 1024 ** 2,
    });
    await flushTasks();
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    await flushTasks();
    const replica = FakeWorker.instances[1];
    await flushTasks();
    replica.reply({ id: 1, type: 'metadata', metadata: stripedMetadata, directoryBytes: 1000 });
    await Promise.resolve();

    const stripedRequest = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    const first = source.readWindow(stripedRequest);
    const second = source.readWindow(stripedRequest);
    await flushTasks();
    expect(primary.messages.filter((message) => message.type === 'read')).toHaveLength(1);
    await flushTasks();
    expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(0);
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
    await flushTasks();
    primary.reply({
      id: 3,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([10])] },
    });
    expect((await first).data[0][0]).toBe(10);
    await Promise.resolve();
    await flushTasks();
    expect(primary.messages.at(-1)).toMatchObject({ id: 4, type: 'read' });
    await flushTasks();
    expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(0);
    await flushTasks();
    primary.reply({
      id: 4,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([20])] },
    });
    expect((await second).data[0][0]).toBe(20);
    source.dispose();
    await flushTasks();
  });
  it('returns RGBA directly for rendering without dispatching a raw window to the main thread', async () => {
    const { source, worker } = await opened();
    const plan = planRasterTile(metadata, metadata.bounds, (x, y) => [x, y], {}, 8)!;
    const task = { read: plan.request, warp: plan.warp, width: 8, height: 8, style: {} };
    const pending = source.renderTile!(task);
    await flushTasks();
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'render',
      request: { width: 8, height: 8 },
    });
    expect(plan.warp.points.byteLength).toBeGreaterThan(0);
    await flushTasks();
    worker.reply({
      id: 2,
      type: 'rendered',
      result: { width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) },
    });
    expect((await pending).rgba.byteLength).toBe(256);
    expect(source.getProcessingStats?.().renderedTiles).toBe(1);
    source.dispose();
    await flushTasks();
  });
  it('dispatches sibling display tiles as one Worker render batch', async () => {
    const { source, worker } = await opened();
    const plan = planRasterTile(metadata, metadata.bounds, (x, y) => [x, y], {}, 8)!;
    const task = { read: plan.request, warp: plan.warp, width: 8, height: 8, style: {} };
    const pending = source.renderTiles!([task, task]);
    await flushTasks();
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'render-batch',
      requests: [
        { width: 8, height: 8 },
        { width: 8, height: 8 },
      ],
    });
    await flushTasks();
    worker.reply({
      id: 2,
      type: 'rendered-batch',
      results: [
        { width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) },
        { width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) },
      ],
    });
    expect(await pending).toHaveLength(2);
    expect(source.getProcessingStats?.()).toMatchObject({ renderedTiles: 2 });
    expect(source.getProcessingStats?.().levelActivity?.[0]).toMatchObject({
      submitted: 2,
      completed: 2,
    });
    source.dispose();
    await flushTasks();
  });
  it('does not reuse a cancelled busy slot before the Worker replies', async () => {
    const { source, worker } = await opened(),
      controller = new AbortController();
    const a = source.readWindow(request, controller.signal),
      failure = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await flushTasks();
    controller.abort();
    await failure;
    const b = source.readWindow(request);
    await flushTasks();
    expect(worker.messages.at(-1)?.type).toBe('cancel');
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
    await flushTasks();
    worker.reply({ id: 2, type: 'error', name: 'AbortError', message: 'cancelled' });
    await flushTasks();
    expect(worker.messages.at(-1)).toMatchObject({ id: 3, type: 'read' });
    await flushTasks();
    worker.reply({
      id: 3,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([1])] },
    });
    await b;
    source.dispose();
    await flushTasks();
  });
  it('bounds replicas within each independently owned runtime and releases them on disposal', async () => {
    const readers = [];
    try {
      for (let i = 0; i < 6; i++) {
        const { source } = await opened(2, 1000);
        readers.push(source);
        void source.readWindow(request).catch(() => {});
        void source.readWindow(request).catch(() => {});
      }
      await flushTasks();
      expect(FakeWorker.instances).toHaveLength(12); // Each owned runtime admits two readers.
    } finally {
      readers.forEach((source) => source.dispose());
    }
    const { source } = await opened(2, 1000);
    void source.readWindow(request).catch(() => {});
    void source.readWindow(request).catch(() => {});
    await flushTasks();
    expect(FakeWorker.instances).toHaveLength(14);
    source.dispose();
    await flushTasks();
  });
  it('reduces metadata replication rather than multiplying the 32MiB metadata budget', async () => {
    const { source, worker } = await opened(4, 20 * 1024 ** 2);
    const a = source.readWindow(request),
      b = source.readWindow(request);
    await flushTasks();
    expect(FakeWorker.instances).toHaveLength(1);
    await answer(worker, 1);
    await a;
    await flushTasks();
    worker.reply({
      id: worker.messages.at(-1)!.id,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([2])] },
    });
    await b;
    source.dispose();
    await flushTasks();
  });
  it('validates parallelism before starting workers', async () => {
    for (const workerCount of [0, 5, NaN, 1.5])
      await expect(openGeoTIFF(file(), { workerCount })).rejects.toMatchObject({
        code: 'INVALID_RASTER_WORKERS',
      });
    await flushTasks();
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

describe('parallel pool failure and reservation bounds', () => {
  it.each([
    'spatial',
    'cache-aware',
  ] as const)('serializes memory-heavy %s tasks under an aggregate 64MiB decode budget', async (workerScheduling) => {
    const meta = {
      ...metadata,
      levels: [
        { ...metadata.levels[0], width: 8192, height: 8192, tileWidth: 4096, tileHeight: 4096 },
      ],
    };
    const opened = openGeoTIFF(file(), { workerCount: 2, workerScheduling });
    await flushTasks();
    const first = FakeWorker.instances[0];
    await flushTasks();
    first.reply({ id: 1, type: 'metadata', metadata: meta, directoryBytes: 1000 });
    await flushTasks();
    await flushTasks();
    const configure = first.messages.at(-1);
    if (configure?.type === 'configure') first.reply({ id: configure.id, type: 'configured' });
    const source = await opened;
    const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    try {
      const a = source.readWindow(request),
        b = source.readWindow(request);
      await flushTasks();
      const second = FakeWorker.instances[1];
      await flushTasks();
      second.reply({ id: 1, type: 'metadata', metadata: meta, directoryBytes: 1000 });
      await Promise.resolve();
      expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
      expect(source.getProcessingStats!().reservedBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
      await flushTasks();
      first.reply({
        id: first.messages.at(-1)!.id,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([1])] },
      });
      await a;
      expect(source.getProcessingStats!().reservedBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
      await flushTasks();
      const next = second.messages.at(-1)?.type === 'read' ? second : first;
      next.reply({
        id: next.messages.at(-1)!.id,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([2])] },
      });
      await b;
    } finally {
      source.dispose();
      await flushTasks();
    }
  });
  it('drops a queued cancellation without dispatching stale CPU work', async () => {
    const { source, worker } = await opened();
    const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    const first = source.readWindow(request),
      controller = new AbortController();
    const second = source.readWindow(request, controller.signal),
      failure = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await flushTasks();
    controller.abort();
    await failure;
    expect(source.getProcessingStats!().queuedTasks).toBe(0);
    await flushTasks();
    expect(worker.messages.filter((m) => m.type === 'read')).toHaveLength(1);
    await flushTasks();
    worker.reply({
      id: 2,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([1])] },
    });
    await first;
    source.dispose();
    await flushTasks();
  });
  it('terminates all replicas and queued callbacks on a worker crash', async () => {
    const { source } = await opened(2, 1000);
    const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    const a = source.readWindow(request),
      b = source.readWindow(request),
      c = source.readWindow(request);
    const failures = [a, b, c].map((p) =>
      expect(p).rejects.toMatchObject({ code: 'RASTER_WORKER_FAILED' }),
    );
    await flushTasks();
    FakeWorker.instances[1].onerror?.({ message: 'simulated worker crash' });
    await Promise.all(failures);
    expect(source.getProcessingStats?.()).toMatchObject({
      workers: 0,
      queuedTasks: 0,
      reservedBytes: 0,
    });
    await flushTasks();
    expect(FakeWorker.instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
    source.dispose();
    await flushTasks();
  });
  it('reports a stale distributed Worker rather than issuing unsupported render commands', async () => {
    const pending = openGeoTIFF(file()),
      failure = expect(pending).rejects.toMatchObject({ code: 'RASTER_WORKER_VERSION' });
    await flushTasks();
    FakeWorker.instances[0].reply({ id: 1, type: 'metadata', metadata, protocolVersion: 1 });
    await failure;
    await flushTasks();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('closes the source if asynchronous replica startup fails and releases its slot', async () => {
    let count = 0;
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: string | URL, options: WorkerOptions) {
          if (++count === 2) throw new Error('worker quota exhausted');
          super(url, options);
        }
      },
    );
    const pending = openGeoTIFF(file(), { workerCount: 2 });
    await flushTasks();
    FakeWorker.instances[0].reply({ id: 1, type: 'metadata', metadata, directoryBytes: 1000 });
    const source = await pending;
    await flushTasks();
    await expect(
      source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] }),
    ).rejects.toMatchObject({ code: 'SOURCE_CLOSED' });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
