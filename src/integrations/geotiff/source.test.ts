import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openGeoTIFF, openGeoTIFFHandle } from './source';
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
    this.onmessage?.({ data: message } as MessageEvent<GeoTIFFWorkerResponse>);
  }
}
const file = () => new File([new Uint8Array(8)], 'image.tif', { lastModified: 12 });
async function opened() {
  const pending = openGeoTIFF(file(), { workerUrl: '/worker.js' }),
    worker = FakeWorker.instances.at(-1)!;
  worker.reply({ id: 1, type: 'metadata', metadata });
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
      } else {
        worker.reply({
          id,
          type: 'result',
          result: { width: 1, height: 1, data: [new Uint8Array([1])] },
        });
        await read;
      }
      expect(add).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
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
