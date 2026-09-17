import { RasterError } from '../../domain/raster/policy';
import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterReference,
  RasterSource,
} from '../../domain/raster/types';
import type { GeoTIFFOpenOptions } from './reader';
import type { GeoTIFFWorkerRequest, GeoTIFFWorkerResponse } from './worker-protocol';

export interface OpenGeoTIFFOptions extends GeoTIFFOpenOptions {
  /** URL of the packaged, self-contained classic Worker asset. */
  readonly workerUrl?: string | URL;
}
type Pending = {
  resolve(value: GeoTIFFWorkerResponse): void;
  reject(error: unknown): void;
  cleanup(): void;
};

class WorkerRasterSource implements RasterSource {
  metadata!: RasterMetadata;
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<number, Pending>();
  constructor(private readonly worker: Worker) {
    worker.onmessage = ({ data }: MessageEvent<GeoTIFFWorkerResponse>) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      entry.cleanup();
      if (data.type === 'error') {
        const error = new Error(data.message) as Error & { code?: string };
        error.name = data.name;
        error.code = data.code;
        entry.reject(error);
      } else entry.resolve(data);
    };
    worker.onerror = (event) =>
      this.fail(
        new RasterError(
          'RASTER_WORKER_FAILED',
          event.message || 'Unable to start raster Worker. Check workerUrl and CSP.',
        ),
      );
    worker.onmessageerror = () =>
      this.fail(new RasterError('RASTER_WORKER_FAILED', 'Invalid raster Worker message.'));
  }
  async open(file: File, options: OpenGeoTIFFOptions): Promise<void> {
    const result = await this.call(
      { type: 'open', file, overviewFile: options.overviewFile, crs: options.crs },
      options.signal,
    );
    if (result.type !== 'metadata')
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Expected raster metadata.');
    this.metadata = result.metadata;
  }
  private call(
    message:
      | Omit<Extract<GeoTIFFWorkerRequest, { type: 'open' }>, 'id'>
      | Omit<Extract<GeoTIFFWorkerRequest, { type: 'read' }>, 'id'>,
    signal?: AbortSignal,
  ): Promise<GeoTIFFWorkerResponse> {
    signal?.throwIfAborted();
    if (this.closed)
      return Promise.reject(new RasterError('SOURCE_CLOSED', 'Raster source has been disposed.'));
    if (this.pending.size >= 16)
      return Promise.reject(
        new RasterError('RASTER_QUEUE_BUDGET', 'Too many pending raster reads.'),
      );
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        entry.cleanup();
        try {
          this.worker.postMessage({ id, type: 'cancel' } satisfies GeoTIFFWorkerRequest);
        } catch (error) {
          this.fail(error);
        } finally {
          reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
        }
      };
      const timer = setTimeout(
        () =>
          this.fail(
            new RasterError(
              'RASTER_WORKER_TIMEOUT',
              'Raster Worker exceeded the bounded request timeout.',
            ),
          ),
        60000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage({ ...message, id });
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        reject(error);
      }
    });
  }
  async readWindow(request: RasterReadRequest, signal?: AbortSignal): Promise<RasterReadResult> {
    const result = await this.call({ type: 'read', request }, signal);
    if (result.type !== 'result')
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Expected raster pixel data.');
    return result.result;
  }
  toReference(): RasterReference {
    const { filename, fileSize, lastModified, crs, overviewFile } = this.metadata;
    return {
      kind: 'raster',
      storage: 'external-file',
      format: 'geotiff',
      filename,
      fileSize,
      lastModified,
      crs,
      ...(overviewFile ? { overviewFile } : {}),
    };
  }
  private fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      entry.cleanup();
      entry.reject(error);
    }
    this.pending.clear();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
  }
  dispose(): void {
    this.fail(new DOMException('Raster source disposed', 'AbortError'));
  }
}

/** Keep source bytes in the original File; only bounded pixel windows cross the Worker boundary. */
export async function openGeoTIFF(
  file: File,
  options: OpenGeoTIFFOptions = {},
): Promise<RasterSource> {
  options.signal?.throwIfAborted();
  const url =
    options.workerUrl ?? new URL(/* @vite-ignore */ './emap-geotiff-worker.js', import.meta.url);
  const source = new WorkerRasterSource(new Worker(url, { type: 'classic', name: 'emap-geotiff' }));
  try {
    await source.open(file, options);
    return source;
  } catch (error) {
    source.dispose();
    throw error;
  }
}

/** Restore a host-owned external reference. Permission prompts remain a user-gesture concern. */
export async function openGeoTIFFHandle(
  handle: FileSystemFileHandle,
  options: OpenGeoTIFFOptions & { expected?: RasterReference } = {},
): Promise<RasterSource> {
  options.signal?.throwIfAborted();
  const file = await handle.getFile();
  const expected = options.expected;
  if (
    expected &&
    (file.name !== expected.filename ||
      file.size !== expected.fileSize ||
      file.lastModified !== expected.lastModified)
  ) {
    throw new RasterError(
      'RASTER_FILE_CHANGED',
      '原始栅格已变化；请重新关联文件并重新验证金字塔。',
    );
  }
  if (
    expected?.overviewFile &&
    (!options.overviewFile ||
      options.overviewFile.name !== expected.overviewFile.filename ||
      options.overviewFile.size !== expected.overviewFile.fileSize ||
      options.overviewFile.lastModified !== expected.overviewFile.lastModified)
  ) {
    throw new RasterError(
      'OVERVIEW_FILE_CHANGED',
      '外部金字塔已变化或未关联；请重新选择原始 .ovr 文件。',
    );
  }
  return openGeoTIFF(file, { ...options, crs: options.crs ?? expected?.crs });
}
