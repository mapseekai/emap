import {
  browserWorker,
  type WorkerRuntime,
  type RuntimeScope,
  type WorkerSession,
} from '@mapseekai/tasklane';
import { standaloneRuntime, reportWorkerCleanupFailure, RESOURCE_BYTES } from '../tasklane/runtime';
import { validateRasterTextureRead } from '../../domain/raster/texture';
import {
  RasterError,
  validateRasterWindow,
  RASTER_MAX_DECODE_BYTES,
} from '../../domain/raster/policy';
import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterTextureResult,
  RasterReference,
  RasterSource,
  RasterRenderRequest,
  RasterRenderResult,
  RasterProcessingStats,
  RasterLevelProcessingStats,
  RasterNativeDeflateStatus,
  RasterTaskDiagnostics,
} from '../../domain/raster/types';
import { validateRasterRender } from '../../engine/rendering/raster/warp';
import { validateRasterStyle } from '../../engine/rendering/raster/tile';
import type { GeoTIFFOpenOptions } from './reader';
import { GEOTIFF_READER_BYTES, GEOTIFF_WORKER_PROTOCOL_VERSION } from './worker-protocol';
import type {
  GeoTIFFWorkerCommand,
  GeoTIFFWorkerResponse,
  GeoTIFFWorkerOpen,
} from './worker-protocol';
import { RasterWorkerClient } from './worker-client';
import {
  acquireRasterPrimary,
  acquireRasterReplica,
  acquireRasterBlockCache,
  rasterWorkerCount,
} from './worker-capacity';

const MIB = 1024 ** 2;
const SOURCE_BLOCK_CACHE_BYTES = 8 * MIB;
const TILED_WORKING_SET_BLOCKS = 10;
const TILED_WORKER_CACHE_MAX_BYTES = 16 * MIB;
const STRIPED_WORKING_SET_BLOCKS = 384;
const STRIPED_PRIMARY_CACHE_MIN_BYTES = 32 * MIB;
const STRIPED_PRIMARY_CACHE_MAX_BYTES = 128 * MIB;

function isRowStripedLevel(level: RasterMetadata['levels'][number]): boolean {
  return level.tileWidth >= level.width && level.tileHeight < level.height;
}

function isTiledLevel(level: RasterMetadata['levels'][number]): boolean {
  return (
    !isRowStripedLevel(level) && (level.tileWidth < level.width || level.tileHeight < level.height)
  );
}

function decodedBlockBytes(level: RasterMetadata['levels'][number]): number {
  const bytesPerPixel = level.bits.reduce((sum, bits, band) => {
    const bytes = level.formats[band] === 3 && bits === 16 ? 4 : Math.max(1, Math.ceil(bits / 8));
    return sum + bytes;
  }, 0);
  return level.tileWidth * level.tileHeight * bytesPerPixel;
}

function workerBlockCacheBytes(metadata: RasterMetadata, workers: number): number {
  const baseline = Math.floor(SOURCE_BLOCK_CACHE_BYTES / Math.max(1, workers));
  const largestTiledBlock = metadata.levels
    .filter(isTiledLevel)
    .reduce((largest, level) => Math.max(largest, decodedBlockBytes(level)), 0);
  if (!largestTiledBlock) return baseline;
  const workingSet = Math.ceil((largestTiledBlock * TILED_WORKING_SET_BLOCKS) / MIB) * MIB;
  return Math.min(TILED_WORKER_CACHE_MAX_BYTES, Math.max(baseline, workingSet));
}

function stripedPrimaryCacheBytes(metadata: RasterMetadata, baseline: number): number {
  const largestStripedBlock = metadata.levels
    .filter(isRowStripedLevel)
    .reduce((largest, level) => Math.max(largest, decodedBlockBytes(level)), 0);
  if (!largestStripedBlock) return baseline;
  // A 256px display tile can approach ~1.4 source rows/display-pixel before a 2x tiled
  // overview becomes preferable. 384 strips covers that row working set plus warp padding.
  const workingSet = Math.ceil((largestStripedBlock * STRIPED_WORKING_SET_BLOCKS) / MIB) * MIB;
  return Math.min(
    STRIPED_PRIMARY_CACHE_MAX_BYTES,
    Math.max(STRIPED_PRIMARY_CACHE_MIN_BYTES, baseline, workingSet),
  );
}

function commandLevel(command: GeoTIFFWorkerCommand): number | null {
  if (command.type === 'read' || command.type === 'texture') return command.request.level;
  if (command.type === 'render') return command.request.read.level;
  if (command.type === 'render-batch') return command.requests[0]?.read.level ?? null;
  return null;
}

function commandWindow(command: GeoTIFFWorkerCommand): RasterReadRequest['window'] | null {
  if (command.type === 'read' || command.type === 'texture') return command.request.window;
  if (command.type === 'render') return command.request.read.window;
  if (command.type === 'render-batch' && command.requests.length)
    return [
      Math.min(...command.requests.map((request) => request.read.window[0])),
      Math.min(...command.requests.map((request) => request.read.window[1])),
      Math.max(...command.requests.map((request) => request.read.window[2])),
      Math.max(...command.requests.map((request) => request.read.window[3])),
    ];
  return null;
}

function commandRenderRequests(command: GeoTIFFWorkerCommand): readonly RasterRenderRequest[] {
  if (command.type === 'render') return [command.request];
  if (command.type === 'render-batch') return command.requests;
  return [];
}

interface SourceBlockFootprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

function sourceBlockFootprint(
  level: RasterMetadata['levels'][number],
  command: GeoTIFFWorkerCommand,
): SourceBlockFootprint | null {
  const window = commandWindow(command);
  if (!window) return null;
  const tileWidth = Math.max(1, level.tileWidth);
  const tileHeight = Math.max(1, level.tileHeight);
  const left = Math.max(0, Math.min(level.width, window[0]));
  const right = Math.max(left, Math.min(level.width, window[2]));
  const top = Math.max(0, Math.min(level.height, window[1]));
  const bottom = Math.max(top, Math.min(level.height, window[3]));
  return {
    minX: Math.floor(Math.min(level.width - 1, left) / tileWidth),
    maxX: Math.floor(Math.max(0, Math.min(level.width - 1, Math.ceil(right) - 1)) / tileWidth),
    minY: Math.floor(Math.min(level.height - 1, top) / tileHeight),
    maxY: Math.floor(Math.max(0, Math.min(level.height - 1, Math.ceil(bottom) - 1)) / tileHeight),
    left,
    right,
    top,
    bottom,
    tileWidth,
    tileHeight,
  };
}

/** Keep whole block columns on one Worker and score boundary requests by pixel overlap. */
function affinitySlotIndex(
  level: RasterMetadata['levels'][number],
  command: GeoTIFFWorkerCommand,
  slots: number,
): number | null {
  if (slots < 1) return null;
  const footprint = sourceBlockFootprint(level, command);
  if (!footprint) return 0;
  const weights = new Array<number>(slots).fill(0);
  // Shift pairs by one column so common 3-column viewports keep both Workers active
  // while cutting affinity boundaries roughly in half versus alternating every column.
  const ownerFor = (blockX: number) => Math.floor((blockX + 1) / 2) % slots;
  for (let y = footprint.minY; y <= footprint.maxY; y++) {
    const blockTop = y * footprint.tileHeight;
    const blockBottom = Math.min(level.height, blockTop + footprint.tileHeight);
    const overlapY = Math.max(
      0,
      Math.min(footprint.bottom, blockBottom) - Math.max(footprint.top, blockTop),
    );
    for (let x = footprint.minX; x <= footprint.maxX; x++) {
      const blockLeft = x * footprint.tileWidth;
      const blockRight = Math.min(level.width, blockLeft + footprint.tileWidth);
      const overlapX = Math.max(
        0,
        Math.min(footprint.right, blockRight) - Math.max(footprint.left, blockLeft),
      );
      weights[ownerFor(x)] += overlapX * overlapY;
    }
  }
  const centerX = Math.max(0, Math.min(level.width - 1, (footprint.left + footprint.right) / 2));
  let owner = ownerFor(Math.floor(centerX / footprint.tileWidth));
  for (let index = 0; index < weights.length; index++)
    if (weights[index] > weights[owner]) owner = index;
  return owner;
}

export interface OpenGeoTIFFOptions extends GeoTIFFOpenOptions {
  /** Tiled-reader routing. Cache-aware uses idle replicas and their bounded resident footprint.
   * Row-striped levels always stay on the primary. Default: spatial. */
  readonly workerScheduling?: 'spatial' | 'cache-aware';
  /** Borrowed runtime containing a geotiff pool. Its configured asset URL takes precedence. */
  readonly workerRuntime?: WorkerRuntime;
  /** Self-contained classic Worker asset. All pool replicas use this same URL. */
  readonly workerUrl?: string | URL;
  /** 1–4 independent decoding/rendering workers; default 2 (1 on <=2 logical cores). */
  readonly workerCount?: number;
  /** Optional aggregate decoded-block cache ceiling across this source's Workers (8–256 MiB).
   * Omit to preserve storage-aware sizing. Not a total browser-memory limit. */
  readonly blockCacheBytes?: number;
}
interface Slot {
  // Direct calls use this Session. Group calls are tracked on the primary client;
  // response.sessionId identifies the physical reader for cache gauges.
  client: RasterWorkerClient;
  ready: boolean;
  session: WorkerSession;
  cacheBytes: number;
  cacheEntries: number;
  cachePeakBytes: number;
  cachePeakEntries: number;
  cacheLimitBytes: number;
}
/** Gauges apply to raw numeric reads too; a source read is not a rendered display tile. */
function recordSlotCacheMemory(slot: Slot, d?: RasterTaskDiagnostics): void {
  if (!d) return;
  slot.cacheBytes = d.blockCacheBytes;
  slot.cacheEntries = d.blockCacheEntries;
  slot.cachePeakBytes = Math.max(slot.cachePeakBytes, d.blockCachePeakBytes);
  slot.cachePeakEntries = Math.max(slot.cachePeakEntries, d.blockCachePeakEntries);
  slot.cacheLimitBytes = d.blockCacheLimitBytes;
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
  private readonly retiringSlots = new Set<Slot>();
  private queue: Job[] = [];
  private readonly pending = new Set<Job>();
  private readonly lifetime = new AbortController();
  private closed = false;
  private cleanupResources?: () => Promise<void>;
  private closing?: Promise<void>;
  private reservedBytes = 0;
  private coldGroups = 0;
  private acceptedTasks = 0;
  private dispatchedTasks = 0;
  private decodeBudgetBlocks = 0;
  private largestJobBytes = 0;
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
  private nativeDeflateBlocks = 0;
  private nativeDeflateFallbacks = 0;
  private nativeDeflateMs = 0;
  private fastLzwBlocks = 0;
  private fastLzwFallbacks = 0;
  private fastLzwMs = 0;
  private deinterleaveMs = 0;
  private directRgb8Tiles = 0;
  private nativeDeflateAvailable = false;
  private nativeDeflateEligible = false;
  private nativeDeflateDisabledReason: RasterNativeDeflateStatus['disabledReason'] = null;
  private readonly nativeDeflateCompressionCodes = new Set<number>();
  private blockLoadMs = 0;
  private assembleMs = 0;
  private colorizeMs = 0;
  private transferMs = 0;
  private queuedMeshBytes = 0;
  private target = 1;
  private startingReplica = false;
  private openCommand?: GeoTIFFWorkerOpen;
  private readonly runtime: WorkerRuntime;
  private readonly scope: RuntimeScope;
  constructor(
    url: string | URL,
    private readonly requested: number,
    private readonly borrowed?: WorkerRuntime,
    private readonly scheduling: 'spatial' | 'cache-aware' = 'spatial',
  ) {
    let serial = 0;
    this.runtime =
      borrowed ??
      standaloneRuntime(
        'geotiff',
        () => browserWorker(url, { type: 'classic', name: `emap-geotiff-${serial++}` })(),
        requested,
        RESOURCE_BYTES.geotiff,
      );
    this.scope = this.runtime.createScope('raster-source');
  }
  async open(file: File, options: OpenGeoTIFFOptions): Promise<void> {
    const initialCacheBytes = Math.floor(SOURCE_BLOCK_CACHE_BYTES / this.requested),
      cacheLease = acquireRasterBlockCache(this.scope, this.runtime, initialCacheBytes);
    this.openCommand = {
      type: 'open',
      file,
      overviewFile: options.overviewFile,
      crs: options.crs,
      noData: options.noData,
      cacheBytes: initialCacheBytes,
      pageLimit: Math.floor(16 / this.requested),
    };
    const session = await acquireRasterPrimary(this.scope, this.runtime, options.signal);
    options.signal?.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    const primary = this.createSlot(session, initialCacheBytes);
    const result = await primary.client.call(this.openCommand, options.signal);
    if (result.type === 'metadata' && result.protocolVersion !== GEOTIFF_WORKER_PROTOCOL_VERSION)
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
    const desiredWorkerCacheBytes = workerBlockCacheBytes(this.metadata, this.target),
      desiredPrimaryCacheBytes = stripedPrimaryCacheBytes(this.metadata, desiredWorkerCacheBytes),
      desiredTotalCacheBytes =
        desiredPrimaryCacheBytes + desiredWorkerCacheBytes * Math.max(0, this.target - 1),
      grantedCacheBytes = cacheLease.resize(
        Math.min(desiredTotalCacheBytes, options.blockCacheBytes ?? desiredTotalCacheBytes),
      ),
      replicaCacheBytes =
        this.target > 1
          ? Math.min(desiredWorkerCacheBytes, Math.floor(grantedCacheBytes / this.target))
          : 0,
      primaryCacheBytes = Math.min(
        desiredPrimaryCacheBytes,
        grantedCacheBytes - replicaCacheBytes * Math.max(0, this.target - 1),
      );
    this.openCommand = { ...this.openCommand, cacheBytes: replicaCacheBytes };
    if (primaryCacheBytes !== initialCacheBytes) {
      const configured = await primary.client.call(
        { type: 'configure', cacheBytes: primaryCacheBytes },
        options.signal,
      );
      if (configured.type !== 'configured')
        throw new RasterError(
          'RASTER_WORKER_PROTOCOL',
          'Expected raster cache configuration acknowledgement.',
        );
    }
    primary.cacheLimitBytes = primaryCacheBytes;
    primary.ready = true;
    // Warm the second metadata-only replica during the host's initial view settle.
    // This starts no pixel reads and never runs before mandatory pyramid validation.
    if (this.target > 1) this.startReplica();
    this.lifetime.signal.throwIfAborted();
  }
  private createSlot(session: WorkerSession, cacheLimitBytes = 0): Slot {
    const slot: Slot = {
      client: undefined as unknown as RasterWorkerClient,
      ready: false,
      session,
      cacheBytes: 0,
      cacheEntries: 0,
      cachePeakBytes: 0,
      cachePeakEntries: 0,
      cacheLimitBytes,
    };
    slot.client = new RasterWorkerClient(
      session,
      () => this.pump(),
      (error) => this.fail(error),
      () => {
        this.peakWorkers = Math.max(
          this.peakWorkers,
          this.slots.reduce((sum, value) => sum + (value.ready ? value.client.runningCount : 0), 0),
        );
      },
    );
    this.slots.push(slot);
    return slot;
  }
  private recordNativeDeflateStatus(status?: RasterNativeDeflateStatus): void {
    if (!status) return;
    for (const compression of status.compressionCodes)
      this.nativeDeflateCompressionCodes.add(compression);
    this.nativeDeflateAvailable ||= status.available;
    this.nativeDeflateEligible ||= status.eligible;
    if (this.nativeDeflateEligible) this.nativeDeflateDisabledReason = null;
    else if (status.disabledReason) this.nativeDeflateDisabledReason = status.disabledReason;
  }
  private pruneReplicas(): void {
    for (let i = this.slots.length - 1; i > 0; i--) {
      const slot = this.slots[i];
      if (!slot.session.reclaimed) continue;
      this.slots.splice(i, 1);
      slot.ready = false;
      this.retiringSlots.add(slot);
      slot.client.dispose();
      void slot.client.settled
        .then(() => {
          this.retiringSlots.delete(slot);
        })
        .catch(reportWorkerCleanupFailure);
    }
  }
  private startReplica(): boolean {
    this.pruneReplicas();
    if (this.startingReplica || this.slots.length >= this.target || !this.openCommand) return false;
    this.startingReplica = true;
    const command = {
      ...this.openCommand,
      statistics: this.metadata.statistics,
      maxMetadataBytes: Math.floor((32 * 1024 ** 2) / this.target),
    };
    void (async () => {
      let ready = false;
      try {
        const session = await acquireRasterReplica(this.scope, this.lifetime.signal, this.runtime);
        if (!session || this.closed || session.reclaimed) return;
        const slot = this.createSlot(session, command.cacheBytes ?? 0);
        const result = await slot.client.call(command, this.lifetime.signal);
        if (this.closed || session.reclaimed) return;
        if (
          result.type !== 'metadata' ||
          result.protocolVersion !== GEOTIFF_WORKER_PROTOCOL_VERSION ||
          result.metadata.crs !== this.metadata.crs ||
          JSON.stringify(result.metadata.levels) !== JSON.stringify(this.metadata.levels) ||
          JSON.stringify(result.metadata.bounds) !== JSON.stringify(this.metadata.bounds)
        )
          throw new RasterError(
            'RASTER_FILE_CHANGED',
            'Raster metadata changed while opening a parallel reader.',
          );
        slot.ready = true;
        ready = true;
      } catch (error) {
        if (!this.closed) this.fail(error);
      } finally {
        this.startingReplica = false;
        if (ready) this.pump();
      }
    })();
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
        nativeDeflateBlocks: 0,
        nativeDeflateFallbacks: 0,
        nativeDeflateMs: 0,
        fastLzwBlocks: 0,
        fastLzwFallbacks: 0,
        fastLzwMs: 0,
        deinterleaveMs: 0,
        directRgb8Tiles: 0,
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
    if (
      this.queue.length + this.slots.reduce((sum, slot) => sum + slot.client.pendingCount, 0) >=
      16
    )
      return Promise.reject(
        new RasterError('RASTER_QUEUE_BUDGET', 'Too many pending raster requests.'),
      );
    return new Promise((resolve, reject) => {
      const renderRequests = commandRenderRequests(command);
      const meshBytes = renderRequests.reduce(
        (sum, request) => sum + request.warp.points.byteLength,
        0,
      );
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const job: Job = { command, bytes, signal, resolve, reject, cleanup };
      this.acceptedTasks++;
      this.largestJobBytes = Math.max(this.largestJobBytes, bytes);
      const abort = () => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1);
        this.queuedMeshBytes -= meshBytes;
        this.pending.delete(job);
        const level = commandLevel(command);
        if (level !== null && renderRequests.length)
          this.levelStats(level).cancelled += renderRequests.length;
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
  private slotForJob(job: Job): Slot | undefined {
    const levelId = commandLevel(job.command);
    const level =
      levelId === null ? undefined : this.metadata.levels.find((item) => item.id === levelId);
    if (!level) return this.slots.find((slot) => slot.ready && !slot.client.busy);
    if (isRowStripedLevel(level)) {
      const primary = this.slots[0];
      return primary?.ready && !primary.client.busy ? primary : undefined;
    }
    if (isTiledLevel(level) && this.scheduling === 'cache-aware') {
      // Re-evaluate cold overflow after current decodes populate the cache.
      // This also lets newly opened replicas join the first batch. Warm waits
      // do not consume these permits or block cold work on an idle reader.
      if (this.coldGroups >= this.slots.filter((slot) => slot.ready).length) return undefined;
      return this.slots[0]?.ready ? this.slots[0] : undefined;
    }
    if (!isTiledLevel(level)) return this.slots.find((slot) => slot.ready && !slot.client.busy);
    const ownerIndex = affinitySlotIndex(level, job.command, this.slots.length);
    const owner = ownerIndex === null ? undefined : this.slots[ownerIndex];
    return owner?.ready && !owner.client.busy ? owner : undefined;
  }
  private pump(): void {
    if (this.closed || !this.metadata) return;
    this.pruneReplicas();
    while (this.queue.length) {
      if (this.slots.length < this.target) this.startReplica();
      let index = -1;
      let slot: Slot | undefined;
      for (let candidate = 0; candidate < this.queue.length; candidate++) {
        const job = this.queue[candidate];
        if (this.reservedBytes + job.bytes > RASTER_MAX_DECODE_BYTES) {
          this.decodeBudgetBlocks++;
          continue;
        }
        const preferred = this.slotForJob(job);
        if (!preferred) continue;
        index = candidate;
        slot = preferred;
        break;
      }
      if (index < 0 || !slot) return;
      const [job] = this.queue.splice(index, 1);
      job.cleanup();
      const renderRequests = commandRenderRequests(job.command);
      this.queuedMeshBytes -= renderRequests.reduce(
        (sum, request) => sum + request.warp.points.byteLength,
        0,
      );
      this.reservedBytes += job.bytes;
      this.dispatchedTasks++;
      const transfer: Transferable[] = renderRequests.map(
        (request) => request.warp.points.buffer as ArrayBuffer,
      );
      job.startedAt = performance.now();
      const renderLevel = commandLevel(job.command);
      if (renderLevel !== null && renderRequests.length)
        this.levelStats(renderLevel).submitted += renderRequests.length;
      const level = this.metadata.levels.find((item) => item.id === renderLevel);
      const grouped = this.scheduling === 'cache-aware' && level && isTiledLevel(level);
      const keys: string[] = [];
      const footprint = grouped ? sourceBlockFootprint(level, job.command) : null;
      if (footprint) {
        for (let y = footprint.minY; y <= footprint.maxY && keys.length < 128; y++)
          for (let x = footprint.minX; x <= footprint.maxX && keys.length < 128; x++)
            keys.push(`${level!.id}:${x}:${y}`);
      }
      let members = this.slots.filter((member) => member.ready && member.session.state === 'bound');
      let best = 0;
      if (grouped && keys.length) {
        const resources =
          this.runtime.diagnostics().pools.find((pool) => pool.name === 'geotiff')?.resources ?? [];
        const scores = members.map((member) => {
          const resident = new Set(
            resources
              .filter((resource) => resource.session === member.session.id)
              .flatMap((resource) => resource.keys),
          );
          return keys.reduce((hits, key) => hits + Number(resident.has(key)), 0);
        });
        best = Math.max(0, ...scores);
        // Native groups prefer any idle reader. Restrict warm requests to the
        // best resident set to avoid decoding again on an idle, cold replica.
        if (best) members = members.filter((_, index) => scores[index] === best);
      }
      const cold = grouped && !best;
      if (cold) this.coldGroups++;
      const result = slot.client.call(job.command, job.signal, transfer, {
        cacheCapacityBytes: () => {
          const diagnostics = this.runtime.diagnostics();
          return diagnostics.memoryPressure === 'normal'
            ? Math.max(
                0,
                (diagnostics.pools.find((pool) => pool.name === 'geotiff')?.cacheBytesPerWorker ??
                  0) - GEOTIFF_READER_BYTES,
              )
            : 0;
        },
        ...(grouped
          ? {
              group: () => this.scope.sessionGroup(members.map((member) => member.session)),
              keys,
            }
          : {}),
        settled: () => {
          this.reservedBytes -= job.bytes;
          if (cold) this.coldGroups--;
        },
      });
      void result.then(
        (response) => {
          const executedSlot = response.sessionId
            ? this.slots.find((member) => member.session.id === response.sessionId)
            : slot;
          this.pending.delete(job);
          if (
            response.type === 'rendered' ||
            response.type === 'rendered-batch' ||
            response.type === 'result' ||
            response.type === 'texture'
          )
            this.recordNativeDeflateStatus(response.nativeDeflateStatus);
          if (executedSlot && (response.type === 'result' || response.type === 'texture'))
            recordSlotCacheMemory(executedSlot, response.result.diagnostics);
          if (response.type === 'rendered' || response.type === 'rendered-batch') {
            const rendered = response.type === 'rendered' ? [response.result] : response.results;
            this.renderedTiles += rendered.length;
            const level = commandLevel(job.command);
            const levelStats = level === null ? null : this.levelStats(level);
            if (levelStats) {
              this.lastLevel = level;
              levelStats.completed += rendered.length;
            }
            const d = rendered[0]?.diagnostics;
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
                levelStats.nativeDeflateBlocks += d.nativeDeflateBlocks;
                levelStats.nativeDeflateFallbacks += d.nativeDeflateFallbacks;
                levelStats.nativeDeflateMs += d.nativeDeflateMs;
                levelStats.fastLzwBlocks += d.fastLzwBlocks;
                levelStats.fastLzwFallbacks += d.fastLzwFallbacks;
                levelStats.fastLzwMs += d.fastLzwMs;
                levelStats.deinterleaveMs += d.deinterleaveMs;
                levelStats.directRgb8Tiles += d.directRgb8Tiles;
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
              if (executedSlot) recordSlotCacheMemory(executedSlot, d);
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
              this.nativeDeflateBlocks += d.nativeDeflateBlocks;
              this.nativeDeflateFallbacks += d.nativeDeflateFallbacks;
              this.nativeDeflateMs += d.nativeDeflateMs;
              this.fastLzwBlocks += d.fastLzwBlocks;
              this.fastLzwFallbacks += d.fastLzwFallbacks;
              this.fastLzwMs += d.fastLzwMs;
              this.deinterleaveMs += d.deinterleaveMs;
              this.directRgb8Tiles += d.directRgb8Tiles;
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
          const renderRequests = commandRenderRequests(job.command);
          const level = commandLevel(job.command);
          if (
            level !== null &&
            renderRequests.length &&
            error instanceof DOMException &&
            error.name === 'AbortError'
          )
            this.levelStats(level).cancelled += renderRequests.length;
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
  async readTexture(
    request: RasterReadRequest,
    signal?: AbortSignal,
  ): Promise<RasterTextureResult> {
    const level = this.metadata.levels.find((l) => l.id === request.level);
    if (!level) throw new RasterError('INVALID_LEVEL', 'Unknown texture level.');
    const bytes = validateRasterTextureRead(level, request);
    if (bytes > RASTER_MAX_DECODE_BYTES)
      throw new RasterError(
        'RASTER_READ_BUDGET',
        'Packed texture decode reservation exceeds budget.',
      );
    const snapshot = {
      ...request,
      window: [...request.window] as [number, number, number, number],
      samples: [...request.samples],
    };
    const response = await this.submit({ type: 'texture', request: snapshot }, bytes, signal);
    if (response.type !== 'texture')
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Expected packed original raster samples.');
    return response.result;
  }

  async renderTile(
    request: RasterRenderRequest,
    signal?: AbortSignal,
  ): Promise<RasterRenderResult> {
    return (await this.renderTiles([request], signal))[0];
  }

  async renderTiles(
    requests: readonly RasterRenderRequest[],
    signal?: AbortSignal,
  ): Promise<readonly RasterRenderResult[]> {
    signal?.throwIfAborted();
    if (!requests.length || requests.length > 16)
      throw new RasterError(
        'INVALID_RASTER_BATCH',
        'Raster render batches must contain 1–16 tiles.',
      );
    if (this.closed) throw new RasterError('SOURCE_CLOSED', 'Raster source has been disposed.');
    const reservations = requests.map((request) => {
      validateRasterStyle(this.metadata, request.style);
      return validateRasterRender(this.metadata, request);
    });
    const first = requests[0].read;
    if (
      requests.some(
        (request) =>
          request.read.level !== first.level ||
          request.read.samples.length !== first.samples.length ||
          request.read.samples.some((sample, index) => sample !== first.samples[index]),
      )
    )
      throw new RasterError(
        'INVALID_RASTER_BATCH',
        'Batched raster tiles must use one level and sample set.',
      );
    const extraOutputs = requests
      .slice(1)
      .reduce((sum, request) => sum + request.width * request.height * 4, 0);
    const bytes = Math.max(...reservations) + extraOutputs;
    if (bytes > RASTER_MAX_DECODE_BYTES)
      throw new RasterError('RASTER_READ_BUDGET', 'Batched raster output exceeds 64MiB.');
    const meshBytes = requests.reduce((sum, request) => sum + request.warp.points.byteLength, 0);
    if (this.queuedMeshBytes + meshBytes > 32 * 1024 ** 2)
      throw new RasterError('RASTER_QUEUE_BUDGET', 'Queued warp meshes exceed 32MiB.');
    const messages = requests.map((request) => ({
      ...request,
      read: {
        ...request.read,
        window: [...request.read.window] as [number, number, number, number],
        samples: [...request.read.samples],
      },
      style: {
        ...request.style,
        ...(request.style.bands ? { bands: [...request.style.bands] } : {}),
        ...(request.style.ranges
          ? { ranges: request.style.ranges.map((range) => [range[0], range[1]] as const) }
          : {}),
      },
      warp: { ...request.warp, points: request.warp.points.slice() },
    }));
    const command =
      messages.length === 1
        ? ({ type: 'render', request: messages[0] } as const)
        : ({ type: 'render-batch', requests: messages } as const);
    const response = await this.submit(command, bytes, signal);
    const results =
      response.type === 'rendered'
        ? [response.result]
        : response.type === 'rendered-batch'
          ? response.results
          : null;
    if (
      !results ||
      results.length !== requests.length ||
      results.some(
        (result, index) =>
          result.width !== requests[index].width ||
          result.height !== requests[index].height ||
          result.rgba.byteLength !== requests[index].width * requests[index].height * 4,
      )
    )
      throw new RasterError('RASTER_WORKER_PROTOCOL', 'Invalid rendered raster batch.');
    return results;
  }
  getProcessingStats(): RasterProcessingStats {
    const slots = this.slots.filter((slot) => !slot.session.reclaimed);
    return {
      workers: slots.length,
      busyWorkers: slots.reduce(
        (sum, slot) => sum + (slot.ready ? slot.client.runningCount : 0),
        0,
      ),
      peakWorkers: this.peakWorkers,
      queuedTasks:
        this.queue.length + slots.reduce((sum, slot) => sum + slot.client.queuedCount, 0),
      reservedBytes: this.reservedBytes,
      acceptedTasks: this.acceptedTasks,
      dispatchedTasks: this.dispatchedTasks,
      decodeBudgetBlocks: this.decodeBudgetBlocks,
      largestJobBytes: this.largestJobBytes,
      decodeBudgetBytes: RASTER_MAX_DECODE_BYTES,
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
      blockCacheBytes: slots.reduce((sum, slot) => sum + slot.cacheBytes, 0),
      blockCachePeakBytes: slots.reduce((sum, slot) => sum + slot.cachePeakBytes, 0),
      blockCacheEntries: slots.reduce((sum, slot) => sum + slot.cacheEntries, 0),
      blockCachePeakEntries: slots.reduce((sum, slot) => sum + slot.cachePeakEntries, 0),
      blockCacheLimitBytes: slots.reduce((sum, slot) => sum + slot.cacheLimitBytes, 0),
      blockCacheOversizeSkips: this.blockCacheOversizeSkips,
      // Block identity diagnostics are temporarily disabled to avoid retaining
      // per-block keys and cloning them across Worker boundaries.
      physicalBlockRequests: 0,
      uniquePhysicalBlocks: 0,
      blockLoads: 0,
      uniqueLoadedBlocks: 0,
      duplicateBlockLoads: 0,
      crossWorkerDuplicateLoads: 0,
      blockDiagnosticsTruncated: false,
      workerBlockStats: [],
      nativeDeflateBlocks: this.nativeDeflateBlocks,
      nativeDeflateFallbacks: this.nativeDeflateFallbacks,
      nativeDeflateMs: this.nativeDeflateMs,
      nativeDeflateStatus: {
        compressionCodes: [...this.nativeDeflateCompressionCodes].sort((a, b) => a - b),
        available: this.nativeDeflateAvailable,
        eligible: this.nativeDeflateEligible,
        disabledReason: this.nativeDeflateEligible ? null : this.nativeDeflateDisabledReason,
      },
      fastLzwBlocks: this.fastLzwBlocks,
      fastLzwFallbacks: this.fastLzwFallbacks,
      fastLzwMs: this.fastLzwMs,
      deinterleaveMs: this.deinterleaveMs,
      directRgb8Tiles: this.directRgb8Tiles,
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
  private lastSettlement: Promise<void> = Promise.resolve();
  private closeResources(): Promise<void> {
    if (this.closing) return this.closing;
    if (!this.cleanupResources) return Promise.resolve();
    this.closing = this.cleanupResources().finally(() => {
      this.closing = undefined;
    });
    this.lastSettlement = this.closing;
    return this.closing;
  }
  get settled(): Promise<void> {
    return this.closing ?? this.lastSettlement;
  }
  private fail(error: unknown): void {
    if (this.closed) {
      void this.closeResources().catch(reportWorkerCleanupFailure);
      return;
    }
    this.closed = true;
    this.lifetime.abort(error);
    const slots = [...new Set([...this.slots.splice(0), ...this.retiringSlots])];
    for (const slot of slots) slot.client.dispose(error);
    for (const job of this.queue) {
      job.cleanup();
      job.reject(error);
    }
    this.queue = [];
    this.pending.clear();
    this.reservedBytes = 0;
    this.coldGroups = 0;
    this.queuedMeshBytes = 0;
    this.cleanupResources = async () => {
      for (const slot of slots) slot.client.dispose(error);
      await Promise.all([
        this.scope.dispose(),
        ...slots.map((slot) => slot.client.settled),
        this.borrowed ? undefined : this.runtime.dispose(),
      ]);
      this.retiringSlots.clear();
      this.cleanupResources = undefined;
    };
    void this.closeResources().catch(reportWorkerCleanupFailure);
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
  if (
    options.blockCacheBytes !== undefined &&
    (!Number.isSafeInteger(options.blockCacheBytes) ||
      options.blockCacheBytes < 8 * MIB ||
      options.blockCacheBytes > 256 * MIB)
  )
    throw new RasterError('INVALID_RASTER_BUDGET', 'Source block-cache budget must be 8–256 MiB.');
  const count = rasterWorkerCount(options.workerCount);
  const url =
    options.workerUrl ?? new URL(/* @vite-ignore */ './emap-geotiff-worker.js', import.meta.url);
  const source = new WorkerRasterSource(
    url,
    count,
    options.workerRuntime,
    options.workerScheduling,
  );
  try {
    await source.open(file, options);
    return source;
  } catch (error) {
    source.dispose();
    await source.settled.catch(reportWorkerCleanupFailure);
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
