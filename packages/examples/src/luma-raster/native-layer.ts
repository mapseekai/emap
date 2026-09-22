import {
  planNativeHalo,
  planPackedRasterBatch,
} from '../../../../src/engine/rendering/raster/native-halo';
import type {
  RasterSource,
  RasterStyle,
  RasterReadResult,
  RasterWindow,
  RasterTextureResult,
} from '../../../../src/domain/raster/types';
import type { AffineTransform } from '../../../../src/domain/geo/transform';
import {
  planNativeRasterTiles,
  type NativeRasterTile,
} from '../../../../src/engine/rendering/raster/native-tiles';
import {
  planNativeRasterBatch,
  type NativeRasterBatch,
} from '../../../../src/engine/rendering/raster/native-batches';
import {
  clipCoverage,
  replaceCoverage,
  type RasterPatch,
} from '../../../../src/engine/rendering/raster/coverage';
import {
  NumericRasterRenderer,
  type NumericRasterTexture,
} from '../../../../src/integrations/luma/raster-renderer';

interface ReadJob {
  readonly batch: NativeRasterBatch;
  readonly controller: AbortController;
}
interface UploadBatch {
  readonly batch: NativeRasterBatch;
  readonly result: RasterReadResult | RasterTextureResult;
  readonly coreOnly: boolean;
  next: number;
}

/** Bounded source reads and progressive, disjoint coverage. A data texture has a
 * stable source identity independent of the current viewport and display style. */
export class NativeRasterLayer {
  private cache = new Map<string, NumericRasterTexture>();
  private active = new Set<ReadJob>();
  private wanted: NativeRasterTile[] = [];
  private wantedKeys = new Set<string>();
  private readWanted: readonly NativeRasterTile[] = [];
  private dependencies: ReadonlyMap<string, readonly string[]> = new Map();
  private copiedHalos = new Map<string, Set<string>>();
  private coreMode = false;
  private get packedMode() {
    return this.pipeline !== 'legacy' && Boolean(this.source.readTexture);
  }
  private patches: RasterPatch[] = [];
  private published = new Set<string>();
  private failures = new Set<string>();
  private uploads: UploadBatch[] = [];
  private signature = '';
  private scheduled = 0;
  private paused = false;
  private disposed = false;
  private failed = false;
  private viewStarted = 0;
  private first = false;
  private settled = false;
  private bounds: RasterWindow = [0, 0, 0, 0];
  readonly stats = {
    coreMode: false,
    haloReadTiles: 0,
    cacheBudgetBytes: 32 * 1024 ** 2,
    reads: 0,
    requestedTiles: 0,
    batchedTiles: 0,
    readWallSumMs: 0,
    fileReadBytes: 0,
    fileReadOps: 0,
    fileReadMs: 0,
    blockLoadMs: 0,
    nativeDeflateMs: 0,
    nativeDeflateBlocks: 0,
    blockCacheHits: 0,
    blockCacheMisses: 0,
    blockCacheEvictions: 0,
    deinterleaveMs: 0,
    workerMs: 0,
    completed: 0,
    aborted: 0,
    discarded: 0,
    evictions: 0,
    level: -1,
    wanted: 0,
    pending: 0,
    visible: 0,
    firstTileMs: 0,
    settledMs: 0,
    planningMs: 0,
    activeJobs: 0,
    queuedBytes: 0,
    peakQueuedBytes: 0,
    coveragePatches: 0,
    refinementUpdates: 0,
    uploadBatchMaxMs: 0,
  };
  constructor(
    readonly source: RasterSource,
    readonly gpu: NumericRasterRenderer,
    private invalidate: () => void,
    private report: (e: Error) => void,
    private pipeline: 'core' | 'packed' | 'legacy' = 'core',
  ) {}

  update(view: AffineTransform, width: number, height: number, dpr: number): void {
    const signature = [view.mx, view.my, view.bx, view.by, width, height, dpr].join(':');
    if (this.disposed || signature === this.signature) return;
    const started = performance.now(),
      plan = planNativeRasterTiles(this.source.metadata, view, width, height, dpr);
    const nextBytes = plan.tiles.reduce(
      (sum, t) =>
        sum + ((t.window[2] - t.window[0]) * (t.window[3] - t.window[1]) * 4 * t.level.bits[0]) / 8,
      0,
    );
    if (nextBytes > 128 * 1024 ** 2)
      throw new Error('可见 UInt16 工作集超过 128 MiB；请缩小视口，不会自动降低精度。');
    this.signature = signature;
    this.viewStarted = performance.now();
    this.first = false;
    this.settled = false;
    this.stats.firstTileMs = 0;
    this.stats.settledMs = 0;
    this.published.clear();
    const a = view.unproject(0, height),
      b = view.unproject(width, 0);
    this.bounds = [a[0], a[1], b[0], b[1]];
    this.patches = clipCoverage(this.patches, this.bounds);
    this.stats.planningMs += performance.now() - started;
    this.wanted = plan.tiles;
    const level = plan.tiles[0]?.level;
    this.coreMode = Boolean(
      this.packedMode &&
        this.pipeline === 'core' &&
        level &&
        level.tileWidth < level.width &&
        Math.max(512, Math.min(1024, level.tileWidth)) % level.tileWidth === 0 &&
        Math.max(512, Math.min(1024, level.tileHeight)) % level.tileHeight === 0,
    );
    const halo = this.coreMode
      ? planNativeHalo(this.source.metadata, plan.tiles, view, width, height)
      : null;
    this.readWanted = halo?.reads ?? plan.tiles;
    this.dependencies = halo?.dependencies ?? new Map();
    const readBytes = this.readWanted.reduce(
      (n, t) =>
        n + ((t.window[2] - t.window[0]) * (t.window[3] - t.window[1]) * 4 * t.level.bits[0]) / 8,
      0,
    );
    if (readBytes > 128 * 1024 ** 2) throw new Error('原始源块及采样边缘超过 128 MiB 工作集预算。');
    this.wantedKeys = new Set(this.readWanted.map((t) => t.key));
    this.stats.coreMode = this.coreMode;
    this.stats.haloReadTiles = this.readWanted.length - plan.tiles.length;
    this.uploads = this.uploads.filter((u) =>
      u.batch.tiles.slice(u.next).some((t) => this.wantedKeys.has(t.key)),
    );
    this.queueStats();
    this.stats.level = plan.level;
    this.stats.wanted = plan.tiles.length;
    for (const job of this.active)
      if (!job.batch.tiles.some((t) => this.wantedKeys.has(t.key))) job.controller.abort();
    this.failures.clear();
    this.publish();
    this.schedule();
  }
  setInteracting(value: boolean): void {
    if (this.failed) return;
    this.paused = value;
    if (!value) this.schedule();
  }
  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0;
      if (this.paused) return; // Neither large packing loops nor uploads compete with gestures.
      this.flush();
      this.pump();
    });
  }
  private queueStats(): void {
    this.stats.queuedBytes = this.uploads.reduce(
      (sum, u) =>
        sum +
        ('bits' in u.result
          ? u.result.data.byteLength
          : u.result.data.reduce((n, a) => n + a.byteLength, 0)),
      0,
    );
    this.stats.peakQueuedBytes = Math.max(this.stats.peakQueuedBytes, this.stats.queuedBytes);
    this.stats.activeJobs = this.active.size;
  }
  private flush(): void {
    const started = performance.now();
    while (this.uploads.length && performance.now() - started < 6 && !this.paused) {
      const item = this.uploads[0],
        tile = item.batch.tiles[item.next++];
      if (!this.wantedKeys.has(tile.key) || this.cache.has(tile.key)) this.stats.discarded++;
      else {
        try {
          const incoming =
            ((tile.window[2] - tile.window[0]) *
              (tile.window[3] - tile.window[1]) *
              4 *
              tile.level.bits[0]) /
            8;
          if (this.gpu.stats.liveTextureBytes + incoming > 256 * 1024 ** 2) {
            this.trim();
            if (this.gpu.stats.liveTextureBytes + incoming > 256 * 1024 ** 2)
              throw new Error('UInt16 当前与过渡纹理达到 256 MiB 安全预算。');
          }
          // Upload subwindows straight from the shared batch; no cropped plane copies.
          const entry =
            'bits' in item.result
              ? this.gpu.uploadPrepared(tile, item.result, item.batch.request.window, item.coreOnly)
              : this.gpu.upload(tile, item.result, item.batch.request.window);
          this.cache.set(tile.key, entry);
          this.stats.completed++;
        } catch (e) {
          this.failures.add(tile.key);
          this.fail(e);
        }
      }
      if (item.next === item.batch.tiles.length) this.uploads.shift();
    }
    this.stats.uploadBatchMaxMs = Math.max(
      this.stats.uploadBatchMaxMs,
      performance.now() - started,
    );
    this.queueStats();
    this.publish();
    this.trim();
    this.invalidate();
    if (this.uploads.length && !this.paused) this.schedule();
  }
  private pump(): void {
    // At most two 8-MiB batch reads plus two completed batches. Even slow uploads
    // cannot accumulate an unbounded queue of transferred original samples.
    if (this.paused || this.disposed || this.uploads.length >= 2) return;
    while (this.active.size < 2) {
      const reserved = new Set<string>();
      for (const job of this.active) for (const tile of job.batch.tiles) reserved.add(tile.key);
      for (const item of this.uploads) for (const tile of item.batch.tiles) reserved.add(tile.key);
      const needed = this.neededKeys();
      const candidates = this.readWanted.filter(
        (t) =>
          needed.has(t.key) &&
          !this.cache.has(t.key) &&
          !reserved.has(t.key) &&
          !this.failures.has(t.key),
      );
      let packed = this.packedMode;
      let batch = packed
        ? planPackedRasterBatch(candidates, this.coreMode)
        : planNativeRasterBatch(candidates);
      // A nonaligned large physical tile may exceed the specialized 8-MiB
      // upload contract even though the ordinary bounded reader can handle it.
      // Keep that compatibility path instead of leaving an unserviceable queue.
      if (!batch && candidates.length && packed) {
        packed = false;
        batch = planNativeRasterBatch(candidates.slice(0, 1));
      }
      if (!batch) break;
      const job: ReadJob = { batch, controller: new AbortController() };
      this.active.add(job);
      this.stats.reads++;
      this.stats.requestedTiles += batch.tiles.length;
      if (batch.tiles.length > 1) this.stats.batchedTiles += batch.tiles.length;
      const start = performance.now();
      const coreOnly = this.coreMode && packed;
      const read = packed
        ? this.source.readTexture!(batch.request, job.controller.signal)
        : this.source.readWindow(batch.request, job.controller.signal);
      void read
        .then((result) => {
          if (
            this.disposed ||
            this.failed ||
            job.controller.signal.aborted ||
            !batch.tiles.some((t) => this.wantedKeys.has(t.key))
          ) {
            this.stats.discarded += batch.tiles.length;
            return;
          }
          const d = result.diagnostics;
          if (d)
            for (const key of [
              'fileReadBytes',
              'fileReadOps',
              'fileReadMs',
              'blockLoadMs',
              'nativeDeflateMs',
              'nativeDeflateBlocks',
              'blockCacheHits',
              'blockCacheMisses',
              'blockCacheEvictions',
              'deinterleaveMs',
              'workerMs',
            ] as const)
              this.stats[key] += d[key];
          this.uploads.push({ batch, result, coreOnly, next: 0 });
          this.queueStats();
        })
        .catch((e) => {
          if (job.controller.signal.aborted) {
            this.stats.aborted++;
            return;
          }
          if (!this.disposed) {
            for (const tile of batch.tiles)
              if (this.wantedKeys.has(tile.key)) this.failures.add(tile.key);
            this.fail(e);
          }
        })
        .finally(() => {
          this.stats.readWallSumMs += performance.now() - start;
          this.active.delete(job);
          if (!this.disposed) {
            this.queueStats();
            this.publish();
            this.schedule();
            this.pump();
          }
        });
    }
    this.queueStats();
  }
  private neededKeys(): Set<string> {
    const keys = new Set(this.wanted.map((t) => t.key));
    for (const tile of this.wanted)
      for (const key of this.dependencies.get(tile.key) ?? [])
        if (!this.copiedHalos.get(tile.key)?.has(key)) keys.add(key);
    return keys;
  }
  private isReady(entry: NumericRasterTexture): boolean {
    return (
      !entry.coreOnly ||
      (this.dependencies.get(entry.tile.key) ?? []).every((k) =>
        this.copiedHalos.get(entry.tile.key)?.has(k),
      )
    );
  }
  private publish(): void {
    if (this.disposed || this.failed) return;
    try {
      for (const tile of this.wanted) {
        const target = this.cache.get(tile.key);
        if (!target?.coreOnly) continue;
        const copied = this.copiedHalos.get(tile.key) ?? new Set<string>();
        const neighbors = (this.dependencies.get(tile.key) ?? [])
          .filter((k) => !copied.has(k))
          .map((k) => this.cache.get(k))
          .filter((e): e is NumericRasterTexture => Boolean(e));
        if (neighbors.length) {
          this.gpu.fillHalo(target, neighbors);
          for (const neighbor of neighbors) copied.add(neighbor.tile.key);
          this.copiedHalos.set(tile.key, copied);
        }
      }
    } catch (error) {
      this.fail(error);
      return;
    }
    const ready = this.wanted
      .map((t) => this.cache.get(t.key))
      .filter((e): e is NumericRasterTexture => Boolean(e) && this.isReady(e!));
    this.stats.pending = this.wanted.length - ready.length;
    if (!this.first && ready.length) {
      this.first = true;
      this.stats.firstTileMs = performance.now() - this.viewStarted;
    }
    for (const entry of ready) {
      if (!this.published.has(entry.tile.key)) {
        this.patches = replaceCoverage(this.patches, entry.tile.key, entry.tile.bounds);
        this.published.add(entry.tile.key);
        this.stats.refinementUpdates++;
      }
      this.cache.delete(entry.tile.key);
      this.cache.set(entry.tile.key, entry);
    }
    this.patches = clipCoverage(this.patches, this.bounds);
    if (ready.length === this.wanted.length && !this.settled) {
      this.stats.settledMs = performance.now() - this.viewStarted;
      this.settled = true;
    }
    this.stats.visible = new Set(this.patches.map((p) => p.key)).size;
    this.stats.coveragePatches = this.patches.length;
  }
  private fail(error: unknown): void {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.paused = true;
    for (const job of this.active) job.controller.abort();
    this.uploads = [];
    this.queueStats();
    this.report(error instanceof Error ? error : new Error(String(error)));
  }
  private trim(): void {
    const protectedKeys = new Set([...this.neededKeys(), ...this.patches.map((p) => p.key)]);
    for (const [key, e] of this.cache) {
      if (this.gpu.stats.liveTextureBytes <= this.stats.cacheBudgetBytes) break;
      if (protectedKeys.has(key)) continue;
      this.cache.delete(key);
      this.copiedHalos.delete(key);
      this.gpu.release(e);
      this.stats.evictions++;
    }
    if (this.gpu.stats.liveTextureBytes > 256 * 1024 ** 2)
      this.fail(new Error('可见原始纹理超过 256 MiB，请缩小视口；不会自动降低精度。'));
  }
  draw(
    view: AffineTransform,
    width: number,
    height: number,
    dpr: number,
    style: RasterStyle,
  ): void {
    const coverage = new Map<string, RasterWindow[]>();
    for (const patch of this.patches) {
      const regions = coverage.get(patch.key) ?? [];
      regions.push(patch.bounds);
      coverage.set(patch.key, regions);
    }
    const entries = [...coverage.keys()]
      .map((k) => this.cache.get(k))
      .filter((e): e is NumericRasterTexture => Boolean(e));
    this.gpu.draw(entries, view, width, height, dpr, this.source.metadata, style, coverage);
  }
  get ready() {
    return (
      !this.disposed &&
      !this.failed &&
      !this.stats.pending &&
      !this.uploads.length &&
      !this.active.size &&
      !this.failures.size
    );
  }
  get entries() {
    return this.wanted
      .map((t) => this.cache.get(t.key))
      .filter((e): e is NumericRasterTexture => Boolean(e) && this.isReady(e!));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.scheduled);
    this.scheduled = 0;
    for (const job of this.active) job.controller.abort();
    this.active.clear();
    this.uploads = [];
    this.wanted = [];
    this.readWanted = [];
    this.wantedKeys.clear();
    this.dependencies = new Map();
    this.copiedHalos.clear();
    this.patches = [];
    for (const e of this.cache.values()) this.gpu.release(e);
    this.cache.clear();
    this.source.dispose();
    this.gpu.dispose();
    this.stats.pending = 0;
    this.queueStats();
  }
}
