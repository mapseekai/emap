import { planRasterTile } from '../../engine/rendering/raster/tile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openGeoTIFF, openGeoTIFFHandle } from './source';
import { GEOTIFF_WORKER_PROTOCOL_VERSION } from './worker-protocol';
import type { GeoTIFFWorkerRequest, GeoTIFFWorkerResponse } from './worker-protocol';
import type { RasterMetadata } from '../../domain/raster/types';
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
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<GeoTIFFWorkerResponse>) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: GeoTIFFWorkerRequest[] = [];
  terminate = vi.fn();
  constructor(
    readonly url: string | URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: GeoTIFFWorkerRequest) {
    this.messages.push(message);
  }
  reply(message: GeoTIFFWorkerResponse) {
    this.onmessage?.({
      data:
        message.type === 'metadata'
          ? { protocolVersion: GEOTIFF_WORKER_PROTOCOL_VERSION, ...message }
          : message,
    } as MessageEvent<GeoTIFFWorkerResponse>);
  }
}
const file = () => new File([new Uint8Array(8)], 'image.tif', { lastModified: 12 });
async function opened(
  workerCount = 1,
  directoryBytes?: number,
  rasterMetadata: RasterMetadata = metadata,
) {
  const pending = openGeoTIFF(file(), { workerUrl: '/worker.js', workerCount }),
    worker = FakeWorker.instances.at(-1)!;
  worker.reply({ id: 1, type: 'metadata', metadata: rasterMetadata, directoryBytes });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  const configure = worker.messages.at(-1);
  if (configure?.type === 'configure') worker.reply({ id: configure.id, type: 'configured' });
  return { worker, source: await pending };
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Worker-backed external raster sources', () => {
  it('passes a File reference into a classic Worker and returns only external references', async () => {
    const { worker, source } = await opened();
    expect(worker.options.type).toBe('classic');
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
    worker.reply({
      id: 2,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([42])] },
    });
    expect((await result).data[0][0]).toBe(42);
    source.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('forwards the NoData override to the GeoTIFF Worker open command', async () => {
    const pending = openGeoTIFF(file(), { noData: -9999 });
    const worker = FakeWorker.instances[0];
    expect(worker.messages[0]).toMatchObject({ type: 'open', noData: -9999 });
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
  });

  it('preserves structured pyramid failures and terminates failed opens', async () => {
    const pending = openGeoTIFF(file()),
      worker = FakeWorker.instances[0];
    const failure = expect(pending).rejects.toMatchObject({ code: 'PYRAMID_REQUIRED' });
    worker.reply({
      id: 1,
      type: 'error',
      name: 'RasterError',
      code: 'PYRAMID_REQUIRED',
      message: 'Create pyramids first',
    });
    await failure;
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
    controller.abort();
    await failure;
    expect(worker.messages.at(-1)).toEqual({ id: 2, type: 'cancel' });
    worker.reply({
      id: 2,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([99])] },
    });
    const next = source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] });
    const disposed = expect(next).rejects.toMatchObject({ name: 'AbortError' });
    source.dispose();
    source.dispose();
    await disposed;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });
  it('bounds a stuck Worker request and reports asset startup failures', async () => {
    vi.useFakeTimers();
    const pending = openGeoTIFF(file()),
      worker = FakeWorker.instances[0];
    const rejected = expect(pending).rejects.toMatchObject({ code: 'RASTER_WORKER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalled();
    const second = openGeoTIFF(file()),
      failure = expect(second).rejects.toMatchObject({ code: 'RASTER_WORKER_FAILED' });
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
      const id = worker.messages.at(-1)!.id;
      if (i % 2) {
        const failure = expect(read).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await failure;
        // Cancelled callers settle immediately, but a bounded physical slot and
        // watchdog remain until the Worker acknowledges its actual completion.
        expect(vi.getTimerCount()).toBe(1);
        worker.reply({ id, type: 'error', name: 'AbortError', message: 'cancelled' });
      } else {
        worker.reply({
          id,
          type: 'result',
          result: { width: 1, height: 1, data: [new Uint8Array([1])] },
        });
        await read;
      }
      expect(add).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(Reflect.get(source, 'pending').size).toBe(0);
    source.dispose();
  });
  it('settles cancelled callers even when sending the cancellation message fails', async () => {
    const { worker, source } = await opened(),
      controller = new AbortController();
    const read = source.readWindow(
      { level: 0, window: [0, 0, 1, 1], samples: [0] },
      controller.signal,
    );
    const failure = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    vi.spyOn(worker, 'postMessage').mockImplementation(() => {
      throw new Error('closed worker port');
    });
    controller.abort();
    await failure;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(Reflect.get(source, 'pending').size).toBe(0);
  });
});

describe('parallel raster pipeline pool', () => {
  const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
  const answer = (worker: FakeWorker, value: number) =>
    worker.reply({
      id: worker.messages.at(-1)!.id,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([value])] },
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
      expect(FakeWorker.instances).toHaveLength(2);
      const replica = FakeWorker.instances[1];
      expect(replica.messages[0]).toMatchObject({
        type: 'open',
        file: expect.any(File),
        cacheBytes: 4 * 1024 ** 2,
        pageLimit: 8,
      });
      replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      expect(worker.messages.filter((message) => message.type === 'read')).toHaveLength(1);
      expect(replica.messages.at(-1)).toMatchObject({
        id: 2,
        type: 'read',
        request: { window: [512, 0, 513, 1] },
      });
      expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 2, queuedTasks: 1 });

      answer(replica, 30);
      worker.reply({
        id: 2,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([10])] },
      });
      expect((await first).data[0][0]).toBe(10);
      expect((await thirdOtherBlock).data[0][0]).toBe(30);
      await Promise.resolve();
      expect(worker.messages.at(-1)).toMatchObject({
        id: 3,
        type: 'read',
        request: { window: [1, 0, 2, 1] },
      });
      expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(1);
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
    }
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
      const replica = FakeWorker.instances[1];
      replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      const block1 = source.readWindow({ level: 0, window: [600, 0, 700, 1], samples: [0] });
      const block2 = source.readWindow({ level: 0, window: [1100, 0, 1200, 1], samples: [0] });
      expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(1);
      answer(replica, 10);
      await block1;
      await Promise.resolve();
      expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(2);
      answer(replica, 20);
      await block2;
    } finally {
      source.dispose();
    }
  });
  it('reports exact duplicate and cross-Worker physical block loads', async () => {
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
      const replica = FakeWorker.instances[1];
      replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      const left = source.readWindow({ level: 0, window: [400, 0, 600, 1], samples: [0] }),
        right = source.readWindow({ level: 0, window: [500, 0, 700, 1], samples: [0] });
      expect(source.getProcessingStats?.().busyWorkers).toBe(2);
      const keys = ['0:0:0:0', '0:1:0:0'];
      worker.reply({
        id: worker.messages.at(-1)!.id,
        type: 'result',
        result: { width: 200, height: 1, data: [new Uint8Array(200)] },
        blockAccess: { requested: keys, loaded: keys },
      });
      replica.reply({
        id: replica.messages.at(-1)!.id,
        type: 'result',
        result: { width: 200, height: 1, data: [new Uint8Array(200)] },
        blockAccess: { requested: keys, loaded: keys },
      });
      await Promise.all([left, right]);
      expect(source.getProcessingStats?.()).toMatchObject({
        physicalBlockRequests: 4,
        uniquePhysicalBlocks: 2,
        blockLoads: 4,
        uniqueLoadedBlocks: 2,
        duplicateBlockLoads: 2,
        crossWorkerDuplicateLoads: 2,
        blockDiagnosticsTruncated: false,
        workerBlockStats: [
          {
            worker: 0,
            requests: 2,
            uniqueBlocks: 2,
            loads: 2,
            uniqueLoadedBlocks: 2,
            duplicateLoads: 0,
          },
          {
            worker: 1,
            requests: 2,
            uniqueBlocks: 2,
            loads: 2,
            uniqueLoadedBlocks: 2,
            duplicateLoads: 0,
          },
        ],
      });
    } finally {
      source.dispose();
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
    const primary = FakeWorker.instances[0];
    primary.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: 8 * 1024 ** 2,
    });
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    const replica = FakeWorker.instances[1];
    expect(replica.messages[0]).toMatchObject({
      type: 'open',
      cacheBytes: 8 * 1024 ** 2,
      pageLimit: 8,
    });
    replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    source.dispose();
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
    const primary = FakeWorker.instances[0];
    primary.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: 16 * 1024 ** 2,
    });
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    const replica = FakeWorker.instances[1];
    expect(replica.messages[0]).toMatchObject({ type: 'open', cacheBytes: 16 * 1024 ** 2 });
    replica.reply({ id: 1, type: 'metadata', metadata: tiledMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    source.dispose();
  });
  it.each([
    [20_000, 44],
    [54_798, 121],
    [100_000, 128],
  ] as const)(
    'sizes a %i-pixel row-striped primary cache from its decoded working set',
    async (width, expectedMiB) => {
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
      const primary = FakeWorker.instances[0];
      primary.reply({ id: 1, type: 'metadata', metadata: stripedMetadata, directoryBytes: 1000 });
      await Promise.resolve();
      expect(primary.messages.at(-1)).toMatchObject({
        id: 2,
        type: 'configure',
        cacheBytes: expectedMiB * 1024 ** 2,
      });
      primary.reply({ id: 2, type: 'configured' });
      const source = await opening;
      source.dispose();
    },
  );
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
    const primary = FakeWorker.instances[0];
    primary.reply({ id: 1, type: 'metadata', metadata: stripedMetadata, directoryBytes: 1000 });
    await Promise.resolve();
    expect(primary.messages.at(-1)).toMatchObject({
      id: 2,
      type: 'configure',
      cacheBytes: 32 * 1024 ** 2,
    });
    primary.reply({ id: 2, type: 'configured' });
    const source = await opening;
    const replica = FakeWorker.instances[1];
    replica.reply({ id: 1, type: 'metadata', metadata: stripedMetadata, directoryBytes: 1000 });
    await Promise.resolve();

    const stripedRequest = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    const first = source.readWindow(stripedRequest);
    const second = source.readWindow(stripedRequest);
    expect(primary.messages.filter((message) => message.type === 'read')).toHaveLength(1);
    expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(0);
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
    primary.reply({
      id: 3,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([10])] },
    });
    expect((await first).data[0][0]).toBe(10);
    await Promise.resolve();
    expect(primary.messages.at(-1)).toMatchObject({ id: 4, type: 'read' });
    expect(replica.messages.filter((message) => message.type === 'read')).toHaveLength(0);
    primary.reply({
      id: 4,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([20])] },
    });
    expect((await second).data[0][0]).toBe(20);
    source.dispose();
  });
  it('returns RGBA directly for rendering without dispatching a raw window to the main thread', async () => {
    const { source, worker } = await opened();
    const plan = planRasterTile(metadata, metadata.bounds, (x, y) => [x, y], {}, 8)!;
    const task = { read: plan.request, warp: plan.warp, width: 8, height: 8, style: {} };
    const pending = source.renderTile!(task);
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'render',
      request: { width: 8, height: 8 },
    });
    expect(plan.warp.points.byteLength).toBeGreaterThan(0);
    worker.reply({
      id: 2,
      type: 'rendered',
      result: { width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) },
    });
    expect((await pending).rgba.byteLength).toBe(256);
    expect(source.getProcessingStats?.().renderedTiles).toBe(1);
    source.dispose();
  });
  it('does not reuse a cancelled busy slot before the Worker replies', async () => {
    const { source, worker } = await opened(),
      controller = new AbortController();
    const a = source.readWindow(request, controller.signal),
      failure = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await failure;
    const b = source.readWindow(request);
    expect(worker.messages.at(-1)?.type).toBe('cancel');
    expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
    worker.reply({ id: 2, type: 'error', name: 'AbortError', message: 'cancelled' });
    expect(worker.messages.at(-1)).toMatchObject({ id: 3, type: 'read' });
    worker.reply({
      id: 3,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([1])] },
    });
    await b;
    source.dispose();
  });
  it('bounds extra workers across sources and returns leases after disposal', async () => {
    const readers = [];
    try {
      for (let i = 0; i < 6; i++) {
        const { source } = await opened(2, 1000);
        readers.push(source);
        void source.readWindow(request).catch(() => {});
        void source.readWindow(request).catch(() => {});
      }
      expect(FakeWorker.instances).toHaveLength(10); // six primaries + four extra slots
    } finally {
      readers.forEach((source) => source.dispose());
    }
    const { source } = await opened(2, 1000);
    void source.readWindow(request).catch(() => {});
    void source.readWindow(request).catch(() => {});
    expect(FakeWorker.instances).toHaveLength(12);
    source.dispose();
  });
  it('reduces metadata replication rather than multiplying the 32MiB metadata budget', async () => {
    const { source, worker } = await opened(4, 20 * 1024 ** 2);
    const a = source.readWindow(request),
      b = source.readWindow(request);
    expect(FakeWorker.instances).toHaveLength(1);
    answer(worker, 1);
    await a;
    worker.reply({
      id: worker.messages.at(-1)!.id,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([2])] },
    });
    await b;
    source.dispose();
  });
  it('validates parallelism before starting workers', async () => {
    for (const workerCount of [0, 5, NaN, 1.5])
      await expect(openGeoTIFF(file(), { workerCount })).rejects.toMatchObject({
        code: 'INVALID_RASTER_WORKERS',
      });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

describe('parallel pool failure and reservation bounds', () => {
  it('serializes memory-heavy tasks under an aggregate 64MiB decode budget', async () => {
    const meta = {
      ...metadata,
      levels: [
        { ...metadata.levels[0], width: 8192, height: 8192, tileWidth: 4096, tileHeight: 4096 },
      ],
    };
    const opened = openGeoTIFF(file(), { workerCount: 2 });
    const first = FakeWorker.instances[0];
    first.reply({ id: 1, type: 'metadata', metadata: meta, directoryBytes: 1000 });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const configure = first.messages.at(-1);
    if (configure?.type === 'configure') first.reply({ id: configure.id, type: 'configured' });
    const source = await opened;
    const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    try {
      const a = source.readWindow(request),
        b = source.readWindow(request);
      const second = FakeWorker.instances[1];
      second.reply({ id: 1, type: 'metadata', metadata: meta, directoryBytes: 1000 });
      await Promise.resolve();
      expect(source.getProcessingStats?.()).toMatchObject({ busyWorkers: 1, queuedTasks: 1 });
      expect(source.getProcessingStats!().reservedBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
      first.reply({
        id: first.messages.at(-1)!.id,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([1])] },
      });
      await a;
      expect(source.getProcessingStats!().reservedBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
      first.reply({
        id: first.messages.at(-1)!.id,
        type: 'result',
        result: { width: 1, height: 1, data: [new Uint8Array([2])] },
      });
      await b;
    } finally {
      source.dispose();
    }
  });
  it('drops a queued cancellation without dispatching stale CPU work', async () => {
    const { source, worker } = await opened();
    const request = { level: 0, window: [0, 0, 1, 1] as const, samples: [0] };
    const first = source.readWindow(request),
      controller = new AbortController();
    const second = source.readWindow(request, controller.signal),
      failure = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await failure;
    expect(source.getProcessingStats!().queuedTasks).toBe(0);
    expect(worker.messages.filter((m) => m.type === 'read')).toHaveLength(1);
    worker.reply({
      id: 2,
      type: 'result',
      result: { width: 1, height: 1, data: [new Uint8Array([1])] },
    });
    await first;
    source.dispose();
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
    FakeWorker.instances[1].onerror?.({ message: 'simulated worker crash' });
    await Promise.all(failures);
    expect(source.getProcessingStats?.()).toMatchObject({
      workers: 0,
      queuedTasks: 0,
      reservedBytes: 0,
    });
    expect(FakeWorker.instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
    source.dispose();
  });
  it('reports a stale distributed Worker rather than issuing unsupported render commands', async () => {
    const pending = openGeoTIFF(file()),
      failure = expect(pending).rejects.toMatchObject({ code: 'RASTER_WORKER_VERSION' });
    FakeWorker.instances[0].reply({ id: 1, type: 'metadata', metadata, protocolVersion: 1 });
    await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('rejects opening if constructing the initial replica fails and releases its slot', async () => {
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
    const failure = expect(pending).rejects.toThrow('worker quota exhausted');
    FakeWorker.instances[0].reply({ id: 1, type: 'metadata', metadata, directoryBytes: 1000 });
    await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
