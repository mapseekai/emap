import {
  RasterError,
  validateRasterWindow,
  RASTER_MAX_DECODE_BYTES,
} from '../../domain/raster/policy';
import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterReference,
  RasterSource,
  RasterRenderRequest,
  RasterRenderResult,
  RasterProcessingStats,
  RasterLevelProcessingStats,
} from '../../domain/raster/types';
import { validateRasterRender } from '../../engine/rendering/raster/warp';
import { validateRasterStyle } from '../../engine/rendering/raster/tile';
import type { GeoTIFFOpenOptions } from './reader';
import type {
  GeoTIFFWorkerCommand,
  GeoTIFFWorkerResponse,
  GeoTIFFWorkerOpen,
} from './worker-protocol';
import { RasterWorkerClient } from './worker-client';
import { acquireParallelWorker, rasterWorkerCount } from './worker-capacity';

export interface OpenGeoTIFFOptions extends GeoTIFFOpenOptions {
  /** Self-contained classic Worker asset. All pool replicas use this same URL. */
  readonly workerUrl?: string | URL;
  /** 1–4 independent decoding/rendering workers; default 2 (1 on <=2 logical cores). */
  readonly workerCount?: number;
}
interface Slot {
  client: RasterWorkerClient;
  ready: boolean;
  bytes: number;
  release?: () => void;
  cacheBytes: number;
  cacheEntries: number;
  cachePeakBytes: number;
  cachePeakEntries: number;
  cacheLimitBytes: number;
}
type MutableLevelStats = {
  -readonly [K in keyof Omit<RasterLevelProcessingStats, 'level'>]: Omit<
    RasterLevelProcessingStats,
    'level'
  >[K];
};
interface Job {
  command: GeoTIFFWorkerCommand;
  bytes: number;
  signal?: AbortSignal;
  resolve: (value: GeoTIFFWorkerResponse) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  startedAt?: number;
}

/** Source-owned tile pipeline pool. Independent workers can execute CPU decoding
 * and colorization simultaneously; each worker's I/O budget remains serialized.
 * Shared source metadata/statistics are validated once, then reused by replicas.
 */
class WorkerRasterSource implements RasterSource {
  metadata!: RasterMetadata;
  private readonly slots: Slot[] = [];
  private queue: Job[] = [];
  private readonly pending = new Set<Job>();
  private readonly lifetime = new AbortController();
  private closed = false;
  private reservedBytes = 0;
  private peakWorkers = 0;
  private renderedTiles = 0;
  private lastLevel: number | null = null;
  private readonly levelActivity = new Map<number, MutableLevelStats>();
  private workerMs = 0;
  private fileReadMs = 0;
  private fileReadBytes = 0;
  private fileReadOps = 0;
  private pageCacheHits = 0;
  private pageCacheMisses = 0;
  private blockCacheHits = 0;
  private blockCacheMisses = 0;
  private blockCacheEvictions = 0;
  private blockCacheEvictedBytes = 0;
  private blockCacheAdmittedBytes = 0;
  private blockCachePeakBytes = 0;
  private blockCachePeakEntries = 0;
  private blockCacheLimitBytes = 0;
  private blockCacheOversizeSkips = 0;
  private blockLoadMs = 0;
  private assembleMs = 0;
  private colorizeMs = 0;
  private transferMs = 0;
  private queuedMeshBytes = 0;
  private target = 1;
  private openCommand?: GeoTIFFWorkerOpen;
  constructor(
    private readonly url: string | URL,
    private readonly requested: number,
  ) {}
  async open(file: File, options: OpenGeoTIFFOptions): Promise<void> {
    this.openCommand = {
      type: 'open',
      file,
      overviewFile: options.overviewFile,
      crs: options.crs,
      cacheBytes: Math.floor((8 * 1024 ** 2) / this.requested),
      pageLimit: Math.floor(16 / this.requested),
    };
    const primary = this.createSlot();
    const result = await primary.client.call(this.openCommand, options.signal);
    if (result.type === 'metadata' && result.protocolVersion !== 2)
      throw new RasterError(
        'RASTER_WORKER_VERSION',
        'GeoTIFF Worker asset is outdated. Deploy emap-geotiff-worker.js from the same build and reload.',
      );
    if (result.type !== 'metadata')
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Expected raster metadata.');
    this.lifetime.signal.throwIfAborted();
    this.metadata = result.metadata;
    // Keep duplicated directory arrays within the original 32MiB per-source envelope.
    const cost = result.directoryBytes ?? 32 * 1024 ** 2;
    this.target = Math.min(
      this.requested,
      Math.max(1, Math.floor((32 * 1024 ** 2) / Math.max(1, cost))),
    );
    primary.ready = true;
    // Warm the second metadata-only replica during the host's initial view settle.
    // This starts no pixel reads and never runs before mandatory pyramid validation.
    if (this.target > 1) this.startReplica();
    this.lifetime.signal.throwIfAborted();
  }
  private createSlot(release?: () => void): Slot {
    let worker: Worker;
    try {
      worker = new Worker(this.url, { type: 'classic', name: `emap-geotiff-${this.slots.length}` });
    } catch (error) {
      release?.();
      throw error;
    }
    const slot: Slot = {
      client: undefined as unknown as RasterWorkerClient,
      ready: false,
      bytes: 0,
      release,
      cacheBytes: 0,
      cacheEntries: 0,
      cachePeakBytes: 0,
      cachePeakEntries: 0,
      cacheLimitBytes: 0,
    };
    slot.client = new RasterWorkerClient(
      worker,
      () => {
        this.reservedBytes -= slot.bytes;
        slot.bytes = 0;
        this.pump();
      },
      (error) => this.fail(error),
    );
    this.slots.push(slot);
    return slot;
  }
  private startReplica(): boolean {
    if (this.slots.length >= this.target || !this.openCommand) return false;
    const release = acquireParallelWorker();
    if (!release) return false;
    let slot: Slot;
    try {
      slot = this.createSlot(release);
    } catch (error) {
      this.fail(error);
      return false;
    }
    const command = {
      ...this.openCommand,
      statistics: this.metadata.statistics,
      maxMetadataBytes: Math.floor((32 * 1024 ** 2) / this.target),
    };
    void slot.client
      .call(command, this.lifetime.signal)
      .then((result) => {
        if (this.closed) return;
        if (
          result.type !== 'metadata' ||
          result.protocolVersion !== 2 ||
          result.metadata.crs !== this.metadata.crs ||
          JSON.stringify(result.metadata.levels) !== JSON.stringify(this.metadata.levels) ||
          JSON.stringify(result.metadata.bounds) !== JSON.stringify(this.metadata.bounds)
        )
          throw new RasterError(
            'RASTER_FILE_CHANGED',
            'Raster metadata changed while opening a parallel reader.',
          );
        slot.ready = true;
        this.pump();
      })
      .catch((error) => this.fail(error));
    return true;
  }
  private levelStats(level: number): MutableLevelStats {
    let stats = this.levelActivity.get(level);
    if (!stats) {
      stats = {
        submitted: 0,
        completed: 0,
        cancelled: 0,
        workerMs: 0,
        fileReadMs: 0,
        fileReadBytes: 0,
        fileReadOps: 0,
        pageCacheHits: 0,
        pageCacheMisses: 0,
        blockCacheHits: 0,
        blockCacheMisses: 0,
        blockCacheEvictions: 0,
        blockCacheEvictedBytes: 0,
        blockCacheAdmittedBytes: 0,
        blockLoadMs: 0,
        assembleMs: 0,
        colorizeMs: 0,
      };
      this.levelActivity.set(level, stats);
    }
    return stats;
  }
  private submit(
    command: GeoTIFFWorkerCommand,
    bytes: number,
    signal?: AbortSignal,
  ): Promise<GeoTIFFWorkerResponse> {
    signal?.throwIfAborted();
    if (this.closed)
      return Promise.reject(new RasterError('SOURCE_CLOSED', 'Raster source has been disposed.'));
    if (this.queue.length + this.slots.filter((slot) => slot.client.busy).length >= 16)
      return Promise.reject(
        new RasterError('RASTER_QUEUE_BUDGET', 'Too many pending raster requests.'),
      );
    return new Promise((resolve, reject) => {
      const meshBytes = command.type === 'render' ? command.request.warp.points.byteLength : 0;
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const job: Job = { command, bytes, signal, resolve, reject, cleanup };
      const abort = () => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1);
        this.queuedMeshBytes -= meshBytes;
        this.pending.delete(job);
        if (command.type === 'render') this.levelStats(command.request.read.level).cancelled++;
        cleanup();
        reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
        this.pump();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.add(job);
      this.queuedMeshBytes += meshBytes;
      this.queue.push(job);
      this.pump();
    });
  }
  private pump(): void {
    if (this.closed || !this.metadata) return;
    while (this.queue.length) {
      const slot = this.slots.find((value) => value.ready && !value.client.busy);
      if (!slot) {
        this.startReplica();
        return;
      }
      const job = this.queue[0];
      if (this.reservedBytes + job.bytes > RASTER_MAX_DECODE_BYTES) return;
      this.queue.shift();
      job.cleanup();
      if (job.command.type === 'render')
        this.queuedMeshBytes -= job.command.request.warp.points.byteLength;
      slot.bytes = job.bytes;
      this.reservedBytes += job.bytes;
      const transfer: Transferable[] =
        job.command.type === 'render'
          ? [job.command.request.warp.points.buffer as ArrayBuffer]
          : [];
      job.startedAt = performance.now();
      if (job.command.type === 'render')
        this.levelStats(job.command.request.read.level).submitted++;
      const result = slot.client.call(job.command, job.signal, transfer);
      this.peakWorkers = Math.max(
        this.peakWorkers,
        this.slots.filter((value) => value.ready && value.client.busy).length,
      );
      void result.then(
        (response) => {
          this.pending.delete(job);
          if (response.type === 'rendered') {
            this.renderedTiles++;
            const levelStats =
              job.command.type === 'render'
                ? this.levelStats(job.command.request.read.level)
                : null;
            if (job.command.type === 'render') {
              this.lastLevel = job.command.request.read.level;
              levelStats!.completed++;
            }
            const d = response.result.diagnostics;
            if (d) {
              if (levelStats) {
                levelStats.workerMs += d.workerMs;
                levelStats.fileReadMs += d.fileReadMs;
                levelStats.fileReadBytes += d.fileReadBytes;
                levelStats.fileReadOps += d.fileReadOps;
                levelStats.pageCacheHits += d.pageCacheHits;
                levelStats.pageCacheMisses += d.pageCacheMisses;
                levelStats.blockCacheHits += d.blockCacheHits;
                levelStats.blockCacheMisses += d.blockCacheMisses;
                levelStats.blockCacheEvictions += d.blockCacheEvictions;
                levelStats.blockCacheEvictedBytes += d.blockCacheEvictedBytes;
                levelStats.blockCacheAdmittedBytes += d.blockCacheAdmittedBytes;
                levelStats.blockLoadMs += d.blockLoadMs;
                levelStats.assembleMs += d.assembleMs;
                levelStats.colorizeMs += d.colorizeMs;
              }
              this.workerMs += d.workerMs;
              this.fileReadMs += d.fileReadMs;
              this.fileReadBytes += d.fileReadBytes;
              this.fileReadOps += d.fileReadOps;
              this.pageCacheHits += d.pageCacheHits;
              this.pageCacheMisses += d.pageCacheMisses;
              this.blockCacheHits += d.blockCacheHits;
              this.blockCacheMisses += d.blockCacheMisses;
              slot.cacheBytes = d.blockCacheBytes;
              slot.cacheEntries = d.blockCacheEntries;
              slot.cachePeakBytes = Math.max(slot.cachePeakBytes, d.blockCachePeakBytes);
              slot.cachePeakEntries = Math.max(slot.cachePeakEntries, d.blockCachePeakEntries);
              slot.cacheLimitBytes = d.blockCacheLimitBytes;
              this.blockCacheEvictions += d.blockCacheEvictions;
              this.blockCacheEvictedBytes += d.blockCacheEvictedBytes;
              this.blockCacheAdmittedBytes += d.blockCacheAdmittedBytes;
              this.blockCachePeakBytes = Math.max(this.blockCachePeakBytes, d.blockCachePeakBytes);
              this.blockCachePeakEntries = Math.max(
                this.blockCachePeakEntries,
                d.blockCachePeakEntries,
              );
              this.blockCacheLimitBytes = Math.max(
                this.blockCacheLimitBytes,
                d.blockCacheLimitBytes,
              );
              this.blockCacheOversizeSkips += d.blockCacheOversizeSkips;
              this.blockLoadMs += d.blockLoadMs;
              this.assembleMs += d.assembleMs;
              this.colorizeMs += d.colorizeMs;
              this.transferMs += Math.max(
                0,
                performance.now() - (job.startedAt ?? performance.now()) - d.workerMs,
              );
            }
          }
          job.resolve(response);
        },
        (error) => {
          this.pending.delete(job);
          if (
            job.command.type === 'render' &&
            error instanceof DOMException &&
            error.name === 'AbortError'
          )
            this.levelStats(job.command.request.read.level).cancelled++;
          job.reject(error);
        },
      );
    }
  }
  async readWindow(request: RasterReadRequest, signal?: AbortSignal): Promise<RasterReadResult> {
    const level = this.metadata.levels.find((value) => value.id === request.level);
    if (!level) throw new RasterError('INVALID_LEVEL', 'Unknown raster level.');
    const bytes = validateRasterWindow(level, request.window, request.samples);
    const snapshot = {
      ...request,
      window: [...request.window] as [number, number, number, number],
      samples: [...request.samples],
    };
    const response = await this.submit({ type: 'read', request: snapshot }, bytes, signal);
    if (response.type !== 'result')
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Expected original raster samples.');
    return response.result;
  }
  async renderTile(
    request: RasterRenderRequest,
    signal?: AbortSignal,
  ): Promise<RasterRenderResult> {
    validateRasterStyle(this.metadata, request.style);
    const bytes = validateRasterRender(this.metadata, request);
    signal?.throwIfAborted();
    if (this.closed) throw new RasterError('SOURCE_CLOSED', 'Raster source has been disposed.');
    if (this.queuedMeshBytes + request.warp.points.byteLength > 32 * 1024 ** 2)
      throw new RasterError('RASTER_QUEUE_BUDGET', 'Queued warp meshes exceed 32MiB.');
    // Caller keeps ownership of its reusable mesh; transfer only an independent copy.
    const style = {
      ...request.style,
      ...(request.style.bands ? { bands: [...request.style.bands] } : {}),
      ...(request.style.ranges
        ? { ranges: request.style.ranges.map((r) => [r[0], r[1]] as const) }
        : {}),
    };
    const message = {
      ...request,
      read: {
        ...request.read,
        window: [...request.read.window] as [number, number, number, number],
        samples: [...request.read.samples],
      },
      style,
      warp: { ...request.warp, points: request.warp.points.slice() },
    };
    const response = await this.submit({ type: 'render', request: message }, bytes, signal);
    if (
      response.type !== 'rendered' ||
      response.result.width !== request.width ||
      response.result.height !== request.height ||
      response.result.rgba.byteLength !== request.width * request.height * 4
    )
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Invalid rendered raster tile.');
    return response.result;
  }
  getProcessingStats(): RasterProcessingStats {
    return {
      workers: this.slots.length,
      busyWorkers: this.slots.filter((slot) => slot.ready && slot.client.busy).length,
      peakWorkers: this.peakWorkers,
      queuedTasks: this.queue.length,
      reservedBytes: this.reservedBytes,
      renderedTiles: this.renderedTiles,
      lastLevel: this.lastLevel,
      levelActivity: [...this.levelActivity.entries()]
        .sort(([a], [b]) => a - b)
        .map(([level, stats]) => ({ level, ...stats })),
      workerMs: this.workerMs,
      fileReadMs: this.fileReadMs,
      fileReadBytes: this.fileReadBytes,
      fileReadOps: this.fileReadOps,
      pageCacheHits: this.pageCacheHits,
      pageCacheMisses: this.pageCacheMisses,
      blockCacheHits: this.blockCacheHits,
      blockCacheMisses: this.blockCacheMisses,
      blockCacheEvictions: this.blockCacheEvictions,
      blockCacheEvictedBytes: this.blockCacheEvictedBytes,
      blockCacheAdmittedBytes: this.blockCacheAdmittedBytes,
      blockCacheBytes: this.slots.reduce((sum, slot) => sum + slot.cacheBytes, 0),
      blockCachePeakBytes: this.slots.reduce((sum, slot) => sum + slot.cachePeakBytes, 0),
      blockCacheEntries: this.slots.reduce((sum, slot) => sum + slot.cacheEntries, 0),
      blockCachePeakEntries: this.slots.reduce((sum, slot) => sum + slot.cachePeakEntries, 0),
      blockCacheLimitBytes: this.slots.reduce((sum, slot) => sum + slot.cacheLimitBytes, 0),
      blockCacheOversizeSkips: this.blockCacheOversizeSkips,
      blockLoadMs: this.blockLoadMs,
      assembleMs: this.assembleMs,
      colorizeMs: this.colorizeMs,
      transferMs: this.transferMs,
    };
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
    this.lifetime.abort(error);
    for (const slot of this.slots) {
      slot.client.dispose(error);
      slot.release?.();
    }
    this.slots.length = 0;
    for (const job of this.queue) {
      job.cleanup();
      job.reject(error);
    }
    this.queue = [];
    this.pending.clear();
    this.reservedBytes = 0;
    this.queuedMeshBytes = 0;
    this.openCommand = undefined;
  }
  dispose(): void {
    this.fail(new DOMException('Raster source disposed', 'AbortError'));
  }
}

/** True parallel tile workers; original files are referenced, never copied into browser storage. */
export async function openGeoTIFF(
  file: File,
  options: OpenGeoTIFFOptions = {},
): Promise<RasterSource> {
  options.signal?.throwIfAborted();
  const count = rasterWorkerCount(options.workerCount);
  const url =
    options.workerUrl ?? new URL(/* @vite-ignore */ './emap-geotiff-worker.js', import.meta.url);
  const source = new WorkerRasterSource(url, count);
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
