import { settleDisposals } from '../../../shared/settle-disposals';
import { RasterPresentationQueue } from './presentation';
import { awaitWithSignal } from '../../../shared/await-with-signal';
import { Bounds } from '../../../domain/geo/bounds';
import { CanvasPainter } from '../canvas-painter';
import {
  clipCoverage,
  fillCoverage,
  replaceCoverage,
  intersectCoverage,
  type RasterPatch,
} from './coverage';
import { AffineTransform } from '../../../domain/geo/transform';
import { RasterError } from '../../../domain/raster/policy';
import type {
  RasterSource,
  RasterStyle,
  RasterWindow,
  RasterProcessingStats,
} from '../../../domain/raster/types';
import type {
  RasterContract,
  RasterCacheStats,
  RasterLayerInfo,
  RasterLayerReference,
  RasterPlanningDiagnostics,
} from '../../../runtime/services/contracts/raster';
import type { RenderFrame, RenderPass } from '../../../runtime/services/contracts/render-pass';
import {
  rasterCoordinateTransform,
  transformRasterBounds,
  type RasterCoordinateTransform,
} from './projector';
import {
  RASTER_TILE_SIZE,
  planRasterTile,
  selectRasterLevel,
  colorizeRasterTile,
  validateRasterStyle,
  rasterBands,
} from './tile';

export interface RasterRenderOptions {
  readonly cacheBytes?: number;
  readonly concurrency?: number;
  /** Delay after the last view movement; active pointer/camera gestures always hold decoding. */
  readonly settleDelay?: number;
  /** Group ready tiles for at most this many ms; complete batches flush immediately. */
  readonly presentationInterval?: number;
}
interface Layer {
  id: string;
  source: RasterSource;
  style: RasterStyle;
  visible: boolean;
  revision: number;
}
interface Tile {
  key: string;
  layer: string;
  revision: number;
  crs: string;
  bounds: RasterWindow;
  image: HTMLCanvasElement | ImageData | null;
  bytes: number;
  span: number;
  fallback?: boolean;
}
interface Task {
  key: string;
  layer: Layer;
  revision: number;
  crs: string;
  bounds: RasterWindow;
  toSource: RasterCoordinateTransform;
  span: number;
  selectedLevel: number;
  rowStriped: boolean;
  gridRow: number;
  sourceRow: number;
}
interface TileBatch {
  readonly keys: ReadonlySet<string>;
  readonly ready: Set<string>;
  readonly crs: string;
  readonly revision: number;
}
interface Presentation {
  readonly crs: string;
  readonly bounds: RasterWindow;
  patches: RasterPatch[];
}
interface Dependencies {
  registerLayerPass?(id: string, pass: RenderPass): () => void;
  getCRS(): string;
  requestRender(): void;
  reportError(id: string, error: unknown): void;
}
function cloneStyle(style: RasterStyle): RasterStyle {
  return {
    ...style,
    ...(style.bands ? { bands: [...style.bands] } : {}),
    ...(style.ranges ? { ranges: style.ranges.map((r) => [r[0], r[1]] as const) } : {}),
  };
}
function intersects(a: RasterWindow, b: RasterWindow): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** Bounded raster scheduling; display is drawn on the existing vector map canvas. */
export class RasterRenderService implements RasterContract {
  private readonly layers = new Map<string, Layer>();
  private readonly cache = new Map<string, Tile>();
  private readonly active = new Map<string, AbortController>();
  private readonly failures = new Set<string>();
  private readonly displayed = new Map<string, Presentation>();
  private readonly pendingBatches = new Map<string, TileBatch>();
  private readonly gestures = new Set<string>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMovement = 0;
  private readonly settleDelay: number;
  private committedFrames = 0;
  private presentedTiles = 0;
  private snapshotSequence = 0;
  private readonly currentTasks = new Map<string, Task>();
  private readRequests = 0;
  private planningMs = 0;
  private planningPasses = 0;
  private plannedTiles = 0;
  private taskQueued = 0;
  private loadTileStarted = 0;
  private planSucceeded = 0;
  private planEmpty = 0;
  private loadTileFailed = 0;
  private pumpBlockedGestures = 0;
  private pumpBlockedSettleTimer = 0;
  private readonly taskErrors: Array<{
    stage: 'planRasterTile' | 'loadTile';
    name: string;
    code: string | null;
    message: string;
    selectedLevel: number;
    blockSize: readonly [number, number] | null;
  }> = [];
  private readonly plannedLevels = new Map<number, number>();
  private planningDiagnostics: RasterPlanningDiagnostics | null = null;
  private canvasUploadMs = 0;
  private rawPixels = false;
  private pixelPrepareMs = 0;
  private pixelPreparedTiles = 0;
  private pixelPreclassifiedTiles = 0;
  private pixelAlphaFallbackTiles = 0;
  private canvasPreparedTiles = 0;
  private queue: Task[] = [];
  private wanted = new Set<string>();
  private bytes = 0;
  private version = 0;
  private epoch = 0;
  private scheduled = 0;
  private signature = '';
  private disposed = false;
  private readonly cacheLimit: number;
  private readonly concurrency: number;
  private readonly presentation: RasterPresentationQueue;
  private readonly layerPasses = new Map<string, () => void>();
  constructor(
    private readonly deps: Dependencies,
    options: RasterRenderOptions = {},
  ) {
    this.cacheLimit = options.cacheBytes ?? 64 * 1024 ** 2;
    this.concurrency = options.concurrency ?? 2;
    this.settleDelay = options.settleDelay ?? 150;
    if (!Number.isFinite(this.settleDelay) || this.settleDelay < 0 || this.settleDelay > 2000)
      throw new RasterError('INVALID_RASTER_BUDGET', 'Settle delay must be 0–2000ms.');
    if (
      !Number.isSafeInteger(this.cacheLimit) ||
      this.cacheLimit < 8 * 1024 ** 2 ||
      this.cacheLimit > 256 * 1024 ** 2
    )
      throw new RasterError('INVALID_RASTER_BUDGET', 'Cache budget must be 8–256MiB.');
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 4)
      throw new RasterError('INVALID_RASTER_BUDGET', 'Concurrency must be 1–4.');
    const interval = options.presentationInterval ?? 60;
    if (!Number.isFinite(interval) || interval < 0 || interval > 250)
      throw new RasterError('INVALID_RASTER_BUDGET', 'Presentation interval must be 0–250ms.');
    this.presentation = new RasterPresentationQueue(interval, (keys) => {
      if (this.disposed || this.gestures.size || this.settleTimer !== null) return;
      for (const key of keys) this.publishTileNow(key);
      this.trimCache();
      this.deps.requestRender();
    });
  }
  readonly render = (frame: RenderFrame, layerId?: string): void => {
    if (this.disposed || !this.layers.size || frame.width <= 0 || frame.height <= 0) return;
    this.rawPixels = typeof frame.painter.drawRasterPixels === 'function';
    const crs = this.deps.getCRS(),
      t = frame.transform;
    if (![t.mx, t.my, t.bx, t.by].every(Number.isFinite) || !t.mx || !t.my) return;
    const a = t.unproject(0, frame.height),
      b = t.unproject(frame.width, 0);
    const view: RasterWindow = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
    const paintLayers =
      layerId === undefined
        ? this.deps.registerLayerPass
          ? []
          : this.layers.values()
        : [this.layers.get(layerId)].filter((layer): layer is Layer => Boolean(layer));
    for (const layer of paintLayers) {
      if (!layer.visible) continue;
      const displayed = this.displayed.get(layer.id);
      if (!displayed || displayed.crs !== crs) continue;
      for (const patch of displayed.patches) {
        const tile = this.cache.get(patch.key);
        if (!tile?.image || !intersects(patch.bounds, view)) continue;
        if ('data' in tile.image && frame.painter.drawRasterPixels) {
          frame.painter.drawRasterPixels(
            tile.image,
            tile.bounds,
            layer.style.opacity ?? 1,
            layer.style.resampling === 'bilinear',
            patch.bounds,
            true,
          );
        } else {
          // A host may supply a different painter later. Convert once and replace
          // the CPU cache owner, rather than keeping both RGBA and Canvas copies.
          if ('data' in tile.image)
            tile.image = this.uploadRasterTile(
              tile.image.data,
              tile.image.width,
              tile.image.height,
            );
          frame.painter.drawRasterImage(
            tile.image,
            tile.bounds,
            layer.style.opacity ?? 1,
            layer.style.resampling === 'bilinear',
            patch.bounds,
            true,
          );
        }
      }
    }
    if (layerId !== undefined) return;
    if (this.gestures.size || this.settleTimer !== null) return;
    const signature = [
      t.mx,
      t.my,
      t.bx,
      t.by,
      frame.width,
      frame.height,
      frame.pixelRatio,
      crs,
      this.version,
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.cancelPending();
    const epoch = this.epoch;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0;
      void this.refresh(frame, view, crs, epoch).catch((error) => {
        if (!this.disposed && epoch === this.epoch) this.deps.reportError('', error);
      });
    });
  };
  private async refresh(
    frame: RenderFrame,
    view: RasterWindow,
    crs: string,
    epoch: number,
  ): Promise<void> {
    const planningStarted = performance.now();
    this.taskErrors.length = 0;
    const visible = [...this.layers.values()].filter((layer) => layer.visible);
    // Reserve at least half the byte budget for previous views while panning.
    const perLayer = Math.max(
      1,
      Math.floor(this.cacheLimit / (RASTER_TILE_SIZE ** 2 * 4) / 2 / Math.max(1, visible.length)),
    );
    const tasks: Task[] = [];
    const planningLayers: RasterPlanningDiagnostics['layers'][number][] = [];
    const plannedBounds = new Map<string, RasterWindow>();

    for (const layer of visible) {
      try {
        const [toSource, fromSource] = await Promise.all([
          rasterCoordinateTransform(crs, layer.source.metadata.crs),
          rasterCoordinateTransform(layer.source.metadata.crs, crs),
        ]);
        if (this.disposed || epoch !== this.epoch) return;
        const extent = transformRasterBounds(layer.source.metadata.bounds, fromSource);
        if (!intersects(view, extent)) continue;
        const clipped: RasterWindow = [
          Math.max(view[0], extent[0]),
          Math.max(view[1], extent[1]),
          Math.min(view[2], extent[2]),
          Math.min(view[3], extent[3]),
        ];
        plannedBounds.set(layer.id, clipped);
        const resolution = 1 / Math.abs(frame.transform.mx) / Math.min(2, frame.pixelRatio);
        let pixelSize = 2 ** (Math.floor(Math.log2(resolution) * 2) / 2);
        let span = pixelSize * RASTER_TILE_SIZE;
        const count = () =>
          (Math.ceil((clipped[2] - extent[0]) / span) -
            Math.floor((clipped[0] - extent[0]) / span)) *
          (Math.ceil((clipped[3] - extent[1]) / span) -
            Math.floor((clipped[1] - extent[1]) / span));
        let coarsen = 0;
        while (count() > perLayer && coarsen++ < 64) {
          pixelSize *= 2;
          span = pixelSize * RASTER_TILE_SIZE;
        }
        if (!Number.isFinite(span) || span <= 0) continue;
        const gridX = Math.max(
          0,
          Math.ceil((clipped[2] - extent[0]) / span) - Math.floor((clipped[0] - extent[0]) / span),
        );
        const gridY = Math.max(
          0,
          Math.ceil((clipped[3] - extent[1]) / span) - Math.floor((clipped[1] - extent[1]) / span),
        );
        const effectivePixelRatio = Math.min(2, frame.pixelRatio);
        const idealX = Math.max(
          1,
          Math.ceil((frame.width * effectivePixelRatio) / RASTER_TILE_SIZE),
        );
        const idealY = Math.max(
          1,
          Math.ceil((frame.height * effectivePixelRatio) / RASTER_TILE_SIZE),
        );
        const layerTasks: Task[] = [];
        for (
          let y = Math.floor((clipped[1] - extent[1]) / span);
          y < Math.ceil((clipped[3] - extent[1]) / span);
          y++
        )
          for (
            let x = Math.floor((clipped[0] - extent[0]) / span);
            x < Math.ceil((clipped[2] - extent[0]) / span);
            x++
          ) {
            const key = JSON.stringify([layer.id, layer.revision, crs, span, x, y]);
            const bounds: RasterWindow = [
              extent[0] + x * span,
              extent[1] + y * span,
              extent[0] + (x + 1) * span,
              extent[1] + (y + 1) * span,
            ];
            const selection = selectRasterLevel(layer.source.metadata, bounds, toSource);
            const worldCenter: [number, number] = [
              (bounds[0] + bounds[2]) / 2,
              (bounds[1] + bounds[3]) / 2,
            ];
            const sourceCenter = toSource(worldCenter[0], worldCenter[1]);
            const sourceRow =
              sourceCenter &&
              Number.isFinite(sourceCenter[1]) &&
              layer.source.metadata.resolution[1]
                ? (sourceCenter[1] - layer.source.metadata.origin[1]) /
                  layer.source.metadata.resolution[1]
                : Number.POSITIVE_INFINITY;
            const task: Task = {
              key,
              layer,
              revision: layer.revision,
              crs,
              bounds,
              toSource,
              span,
              selectedLevel: selection.level.id,
              rowStriped:
                selection.level.tileWidth >= selection.level.width &&
                selection.level.tileHeight < selection.level.height,
              gridRow: y,
              sourceRow,
            };
            tasks.push(task);
            layerTasks.push(task);
          }
        const base = layer.source.metadata.levels[0];
        const selections = new Map<
          number,
          {
            level: (typeof layer.source.metadata.levels)[number];
            tiles: number;
            min: number;
            max: number;
          }
        >();
        for (const task of layerTasks) {
          const selection = selectRasterLevel(layer.source.metadata, task.bounds, task.toSource);
          const current = selections.get(selection.level.id);
          if (current) {
            current.tiles++;
            current.min = Math.min(current.min, selection.sourcePixelsPerDisplayPixel);
            current.max = Math.max(current.max, selection.sourcePixelsPerDisplayPixel);
          } else
            selections.set(selection.level.id, {
              level: selection.level,
              tiles: 1,
              min: selection.sourcePixelsPerDisplayPixel,
              max: selection.sourcePixelsPerDisplayPixel,
            });
        }
        const selectedLevels = [...selections.values()]
          .sort((a, b) => a.level.id - b.level.id)
          .map(({ level, tiles, min, max }) => ({
            level: level.id,
            tiles,
            size: [level.width, level.height] as const,
            blockSize: [level.tileWidth, level.tileHeight] as const,
            reduction: Math.max(base.width / level.width, base.height / level.height),
            source: level.source ?? ('unknown' as const),
            sourcePixelsPerDisplayPixel: [min, max] as const,
          }));
        const uniform = selectedLevels.length === 1 ? selectedLevels[0] : null;
        const sourcePixels = selectedLevels.length
          ? ([
              Math.min(...selectedLevels.map((item) => item.sourcePixelsPerDisplayPixel[0])),
              Math.max(...selectedLevels.map((item) => item.sourcePixelsPerDisplayPixel[1])),
            ] as const)
          : null;
        planningLayers.push({
          id: layer.id,
          grid: [gridX, gridY],
          tiles: gridX * gridY,
          idealViewportTiles: idealX * idealY,
          amplification: (gridX * gridY) / (idealX * idealY),
          pixelSize,
          span,
          targetResolution: resolution,
          sourceResolution: layer.source.metadata.resolution,
          sourcePixelsPerDisplayPixel: sourcePixels,
          selectedLevel: uniform?.level ?? null,
          selectedLevelSize: uniform?.size ?? null,
          selectedLevelReduction: uniform?.reduction ?? null,
          selectedLevelSource: uniform?.source ?? null,
          selectedLevels,
        });
      } catch (error) {
        if (epoch === this.epoch && !this.disposed) this.deps.reportError(layer.id, error);
      }
    }
    if (this.disposed || epoch !== this.epoch) return;
    this.wanted = new Set(tasks.map((task) => task.key));
    this.currentTasks.clear();
    for (const task of tasks) this.currentTasks.set(task.key, task);
    this.pendingBatches.clear();
    for (const layer of visible) {
      const keys = new Set(tasks.filter((task) => task.layer === layer).map((task) => task.key));
      const bounds = plannedBounds.get(layer.id);
      if (keys.size && bounds) {
        this.preparePresentation(layer, bounds, crs, frame, perLayer);
        this.pendingBatches.set(layer.id, {
          keys,
          ready: new Set(),
          crs,
          revision: layer.revision,
        });
      } else this.displayed.delete(layer.id);
    }
    for (const [key, controller] of this.active)
      if (!this.wanted.has(key))
        controller.abort(new DOMException('View superseded', 'AbortError'));
    for (const key of this.failures) if (!this.wanted.has(key)) this.failures.delete(key);
    for (const task of tasks) {
      const cached = this.cache.get(task.key);
      if (cached) {
        this.cache.delete(task.key);
        this.cache.set(task.key, cached);
      }
    }
    const cx = (view[0] + view[2]) / 2,
      cy = (view[1] + view[3]) / 2;
    const distance = (task: Task) =>
      Math.hypot(
        (task.bounds[0] + task.bounds[2]) / 2 - cx,
        (task.bounds[1] + task.bounds[3]) / 2 - cy,
      );
    const stripRowDistance = (task: Task) => Math.abs((task.bounds[1] + task.bounds[3]) / 2 - cy);
    const priority = (task: Task) => (task.rowStriped ? stripRowDistance(task) : distance(task));
    this.queue = tasks
      .filter((task) => !this.cache.has(task.key) && !this.failures.has(task.key))
      .sort((a, b) => {
        if (
          a.rowStriped &&
          b.rowStriped &&
          a.layer === b.layer &&
          a.selectedLevel === b.selectedLevel
        ) {
          const sourceOrdered = a.sourceRow - b.sourceRow;
          if (Number.isFinite(sourceOrdered) && sourceOrdered) return sourceOrdered;
          if (a.gridRow !== b.gridRow) return a.gridRow - b.gridRow;
        }
        const ordered = priority(a) - priority(b);
        if (ordered) return ordered;
        return distance(a) - distance(b);
      });
    this.taskQueued += this.queue.length;
    for (const task of tasks) if (this.cache.has(task.key)) this.publishTile(task.key);
    this.deps.requestRender();
    this.trimCache();
    this.planningPasses++;
    this.plannedTiles += tasks.length;
    this.planningDiagnostics = {
      viewportCss: [frame.width, frame.height],
      pixelRatio: frame.pixelRatio,
      effectivePixelRatio: Math.min(2, frame.pixelRatio),
      viewportDevice: [
        Math.ceil(frame.width * Math.min(2, frame.pixelRatio)),
        Math.ceil(frame.height * Math.min(2, frame.pixelRatio)),
      ],
      layerCount: visible.length,
      tileBudgetPerLayer: perLayer,
      displayTileSize: RASTER_TILE_SIZE,
      layers: planningLayers,
    };
    this.planningMs += performance.now() - planningStarted;
    this.pump();
  }
  private takeRowBatch(first: Task): Task[] {
    if (!first.rowStriped || !first.layer.source.renderTiles) return [first];
    const batch = [first];
    for (let index = 0; index < this.queue.length && batch.length < 16; ) {
      const candidate = this.queue[index];
      if (
        candidate.rowStriped &&
        candidate.layer === first.layer &&
        candidate.revision === first.revision &&
        candidate.crs === first.crs &&
        candidate.selectedLevel === first.selectedLevel &&
        candidate.gridRow === first.gridRow &&
        this.wanted.has(candidate.key) &&
        !this.cache.has(candidate.key) &&
        !this.active.has(candidate.key)
      ) {
        batch.push(candidate);
        this.queue.splice(index, 1);
      } else index++;
    }
    return batch;
  }

  private recordTaskError(task: Task, stage: 'planRasterTile' | 'loadTile', error: unknown): void {
    if (this.taskErrors.length >= 5) return;
    const value = error as { name?: unknown; code?: unknown; message?: unknown };
    const level = task.layer.source.metadata.levels.find((item) => item.id === task.selectedLevel);
    this.taskErrors.push({
      stage,
      name: typeof value?.name === 'string' ? value.name : 'Error',
      code: typeof value?.code === 'string' ? value.code : null,
      message: typeof value?.message === 'string' ? value.message : String(error),
      selectedLevel: task.selectedLevel,
      blockSize: level ? [level.tileWidth, level.tileHeight] : null,
    });
  }

  private pump(): void {
    if (this.disposed) return;
    if (this.gestures.size) {
      this.pumpBlockedGestures++;
      return;
    }
    if (this.settleTimer !== null) {
      this.pumpBlockedSettleTimer++;
      return;
    }
    while (this.active.size < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!;
      if (this.active.has(task.key) || this.cache.has(task.key) || !this.wanted.has(task.key))
        continue;
      const tasks = this.takeRowBatch(task);
      const controller = new AbortController();
      for (const item of tasks) this.active.set(item.key, controller);
      const work =
        tasks.length > 1
          ? this.loadTileBatch(tasks, controller.signal)
          : this.loadTile(task, controller.signal);
      void work
        .catch((error) => {
          if (this.disposed || controller.signal.aborted) return;
          let reported = false;
          for (const item of tasks) {
            if (!this.wanted.has(item.key) || this.cache.has(item.key)) continue;
            this.loadTileFailed++;
            this.recordTaskError(item, 'loadTile', error);
            this.failures.add(item.key);
            this.completeBatch(item.layer.id);
            if (!reported) {
              this.deps.reportError(item.layer.id, error);
              reported = true;
            }
          }
          this.presentation.flush();
        })
        .finally(() => {
          for (const item of tasks) {
            this.active.delete(item.key);
            if (
              !this.disposed &&
              controller.signal.aborted &&
              this.wanted.has(item.key) &&
              !this.cache.has(item.key) &&
              !this.failures.has(item.key) &&
              this.layers.get(item.layer.id)?.revision === item.revision &&
              !this.queue.some((queued) => queued.key === item.key)
            )
              this.queue.push(this.currentTasks.get(item.key) ?? item);
          }
          this.pump();
        });
    }
  }
  private prepareRasterImage(
    rgba: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
    canonicalBinaryAlpha = false,
  ): NonNullable<Tile['image']> {
    if (!this.rawPixels) return this.uploadRasterTile(rgba, width, height);
    const started = performance.now();
    // Provider buffers may be recycled and can be views of larger allocations.
    // Keep one exact owned CPU snapshot instead of a Canvas backing store; this
    // bounded copy is intentional, not a zero-copy ownership assumption.
    // Canvas quantizes premultiplied partial alpha. Keep its established path
    // for continuous-alpha tiles rather than silently changing edge colors.
    if (!canonicalBinaryAlpha) {
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] !== 0 && rgba[i] !== 255) {
          this.pixelAlphaFallbackTiles++;
          return this.uploadRasterTile(rgba, width, height);
        }
      }
    }
    const data = rgba.slice();
    // Built-in colorizers classify their output where it is produced. Generic
    // sources keep the checked path; no unverified metadata-based alpha inference.
    if (canonicalBinaryAlpha) this.pixelPreclassifiedTiles++;
    else
      for (let i = 3; i < data.length; i += 4)
        if (!data[i]) data[i - 3] = data[i - 2] = data[i - 1] = 0;
    const image = new ImageData(data, width, height);
    this.pixelPreparedTiles++;
    this.pixelPrepareMs += performance.now() - started;
    return image;
  }
  private uploadRasterTile(
    rgba: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const uploadStarted = performance.now();
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const context = image.getContext('2d');
    if (!context)
      throw new RasterError('RASTER_CANVAS_UNAVAILABLE', 'Cannot create raster tile context.');
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    this.canvasUploadMs += performance.now() - uploadStarted;
    this.canvasPreparedTiles++;
    return image;
  }

  private commitLoadedTile(task: Task, image: Tile['image'], signal: AbortSignal): void {
    if (
      this.disposed ||
      signal.aborted ||
      !this.wanted.has(task.key) ||
      this.layers.get(task.layer.id)?.revision !== task.revision
    ) {
      if (image && !('data' in image)) image.width = image.height = 0;
      return;
    }
    const tile: Tile = {
      key: task.key,
      layer: task.layer.id,
      revision: task.revision,
      crs: task.crs,
      bounds: task.bounds,
      image,
      bytes: image ? image.width * image.height * 4 : 0,
      span: task.span,
    };
    this.cache.set(task.key, tile);
    this.bytes += tile.bytes;
    this.publishTile(task.key);
    this.trimCache();
  }

  private async loadTileBatch(tasks: readonly Task[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const { source, style } = tasks[0].layer;
    if (!source.renderTiles)
      throw new RasterError('RASTER_BATCH_UNAVAILABLE', 'Raster batch rendering is unavailable.');
    const planned: Array<{ task: Task; plan: NonNullable<ReturnType<typeof planRasterTile>> }> = [];
    for (const task of tasks) {
      this.loadTileStarted++;
      let plan: ReturnType<typeof planRasterTile>;
      try {
        plan = planRasterTile(source.metadata, task.bounds, task.toSource, style);
      } catch (error) {
        this.loadTileFailed++;
        this.recordTaskError(task, 'planRasterTile', error);
        this.failures.add(task.key);
        this.completeBatch(task.layer.id);
        this.deps.reportError(task.layer.id, error);
        continue;
      }
      if (!plan) {
        this.planEmpty++;
        this.commitLoadedTile(task, null, signal);
        continue;
      }
      this.planSucceeded++;
      this.plannedLevels.set(plan.level.id, (this.plannedLevels.get(plan.level.id) ?? 0) + 1);
      this.readRequests++;
      planned.push({ task, plan });
    }
    if (!planned.length) return;
    const rendered = await awaitWithSignal(
      source.renderTiles(
        planned.map(({ plan }) => ({
          read: plan.request,
          width: plan.width,
          height: plan.height,
          warp: plan.warp,
          style,
        })),
        signal,
      ),
      signal,
    );
    signal.throwIfAborted();
    if (rendered.length !== planned.length)
      throw new RasterError(
        'INVALID_RASTER_RENDER',
        'Provider returned an invalid raster batch length.',
      );
    for (let index = 0; index < planned.length; index++) {
      const { task, plan } = planned[index];
      const result = rendered[index];
      if (
        result.width !== plan.width ||
        result.height !== plan.height ||
        result.rgba.byteLength !== plan.width * plan.height * 4
      )
        throw new RasterError(
          'INVALID_RASTER_RENDER',
          'Provider returned an invalid display tile.',
        );
      this.commitLoadedTile(
        task,
        this.prepareRasterImage(
          result.rgba,
          plan.width,
          plan.height,
          result.canonicalBinaryAlpha === true,
        ),
        signal,
      );
    }
  }

  private async loadTile(task: Task, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.loadTileStarted++;
    const { source, style } = task.layer;
    let plan: ReturnType<typeof planRasterTile>;
    try {
      plan = planRasterTile(source.metadata, task.bounds, task.toSource, style);
    } catch (error) {
      if (this.taskErrors.length < 5) {
        const value = error as { name?: unknown; code?: unknown; message?: unknown };
        const level = source.metadata.levels.find((item) => item.id === task.selectedLevel);
        this.taskErrors.push({
          stage: 'planRasterTile',
          name: typeof value?.name === 'string' ? value.name : 'Error',
          code: typeof value?.code === 'string' ? value.code : null,
          message: typeof value?.message === 'string' ? value.message : String(error),
          selectedLevel: task.selectedLevel,
          blockSize: level ? [level.tileWidth, level.tileHeight] : null,
        });
      }
      throw error;
    }
    let image: Tile['image'] = null;
    if (plan) {
      this.planSucceeded++;
      this.plannedLevels.set(plan.level.id, (this.plannedLevels.get(plan.level.id) ?? 0) + 1);
      this.readRequests++;
      let rgba: Uint8ClampedArray<ArrayBuffer>;
      let canonicalBinaryAlpha = false;
      if (source.renderTile) {
        const rendered = await awaitWithSignal(
          source.renderTile(
            {
              read: plan.request,
              width: plan.width,
              height: plan.height,
              warp: plan.warp,
              style,
            },
            signal,
          ),
          signal,
        );
        signal.throwIfAborted();
        rgba = rendered.rgba;
        canonicalBinaryAlpha = rendered.canonicalBinaryAlpha === true;
        if (
          rendered.width !== plan.width ||
          rendered.height !== plan.height ||
          rgba.byteLength !== plan.width * plan.height * 4
        )
          throw new RasterError(
            'INVALID_RASTER_RENDER',
            'Provider returned an invalid display tile.',
          );
      } else {
        // Compatibility for third-party sources implementing only the raw-window contract.
        const result = await awaitWithSignal(source.readWindow(plan.request, signal), signal);
        signal.throwIfAborted();
        rgba = colorizeRasterTile(source.metadata, plan, result, style);
        canonicalBinaryAlpha = source.metadata.alphaBand === null;
      }
      image = this.prepareRasterImage(rgba, plan.width, plan.height, canonicalBinaryAlpha);
    } else this.planEmpty++;
    this.commitLoadedTile(task, image, signal);
  }
  private publishTile(key: string): void {
    const tile = this.cache.get(key);
    if (!tile || this.disposed || this.gestures.size || this.settleTimer !== null) return;
    const batch = this.pendingBatches.get(tile.layer);
    if (!batch || !batch.keys.has(key)) return;
    const complete = [...batch.keys].every(
      (item) => this.cache.has(item) || this.failures.has(item),
    );
    this.presentation.add(key, complete);
  }
  private publishTileNow(key: string): void {
    const tile = this.cache.get(key);
    if (!tile || this.gestures.size || this.settleTimer !== null || this.disposed) return;
    const batch = this.pendingBatches.get(tile.layer),
      presentation = this.displayed.get(tile.layer);
    if (
      !batch ||
      !presentation ||
      !batch.keys.has(key) ||
      batch.ready.has(key) ||
      this.layers.get(tile.layer)?.revision !== tile.revision ||
      batch.crs !== tile.crs
    )
      return;
    const region = intersectCoverage(tile.bounds, presentation.bounds);
    if (region) presentation.patches = replaceCoverage(presentation.patches, key, region);
    batch.ready.add(key);
    this.presentedTiles++;
    this.completeBatch(tile.layer);
    // One render request follows the entire bounded presentation group.
  }
  private completeBatch(id: string): void {
    const batch = this.pendingBatches.get(id);
    if (!batch || [...batch.keys].some((key) => !batch.ready.has(key) && !this.failures.has(key)))
      return;
    this.pendingBatches.delete(id);
    if ([...batch.keys].every((key) => batch.ready.has(key))) this.committedFrames++;
  }
  private preparePresentation(
    layer: Layer,
    bounds: RasterWindow,
    crs: string,
    frame: RenderFrame,
    tileBudget: number,
  ): void {
    const previous = this.displayed.get(layer.id);
    let patches = previous?.crs === crs ? clipCoverage(previous.patches, bounds) : [];
    // Missing coverage may reuse cached parent/old-view tiles. Preserve prior
    // ownership first, including transparent pixels; current ready tiles win later.
    const parents = [...this.cache.values()]
      .filter(
        (tile) =>
          tile.layer === layer.id &&
          tile.revision === layer.revision &&
          tile.crs === crs &&
          !tile.fallback &&
          intersects(tile.bounds, bounds),
      )
      .sort((a, b) => b.span - a.span);
    for (const tile of parents) {
      const region = intersectCoverage(tile.bounds, bounds);
      if (region) patches = fillCoverage(patches, tile.key, region);
      if (patches.length > 2048) break;
    }
    const keys = new Set(patches.map((patch) => patch.key));
    const bytes = [...keys].reduce((sum, key) => sum + (this.cache.get(key)?.bytes ?? 0), 0);
    if (
      keys.size > tileBudget ||
      bytes > tileBudget * RASTER_TILE_SIZE ** 2 * 4 ||
      patches.length > 2048
    ) {
      // Repeated interrupted zooms can retain fragments from many generations.
      // Compact only under pressure, preserving their composited coverage at a bounded resolution
      // in one bounded in-memory fallback (never an OPFS or source-file write).
      const maxPixels = tileBudget * RASTER_TILE_SIZE ** 2;
      const ratio = (bounds[2] - bounds[0]) / (bounds[3] - bounds[1]);
      let width = Math.max(
        1,
        Math.min(
          Math.ceil(frame.width * Math.min(2, frame.pixelRatio)),
          Math.floor(Math.sqrt(maxPixels * ratio)),
          maxPixels,
        ),
      );
      const height = Math.max(
        1,
        Math.min(
          Math.ceil(frame.height * Math.min(2, frame.pixelRatio)),
          Math.floor(width / ratio),
          Math.floor(maxPixels / width),
        ),
      );
      width = Math.max(1, Math.min(width, Math.floor(maxPixels / height)));
      const image = document.createElement('canvas');
      const painter = new CanvasPainter(image);
      painter.setPixelRatio(1);
      painter.resize(width, height);
      painter.setTransform(
        AffineTransform.fromBounds(new Bounds(...bounds), new Bounds(0, 0, width, height), true),
      );
      for (const patch of patches) {
        const tile = this.cache.get(patch.key);
        if (tile?.image) {
          // Pressure-only fallback keeps the existing bounded Canvas composition.
          // Materialize one temporary tile at a time and drop it synchronously.
          const temporary = 'data' in tile.image;
          const source =
            'data' in tile.image
              ? this.uploadRasterTile(tile.image.data, tile.image.width, tile.image.height)
              : tile.image;
          try {
            painter.drawRasterImage(
              source,
              tile.bounds,
              1,
              layer.style.resampling === 'bilinear',
              patch.bounds,
            );
          } finally {
            if (temporary) source.width = source.height = 0;
          }
        }
      }
      const key = JSON.stringify(['fallback', ++this.snapshotSequence, layer.id]);
      const tile: Tile = {
        key,
        layer: layer.id,
        revision: layer.revision,
        crs,
        bounds,
        image,
        bytes: width * height * 4,
        span: bounds[2] - bounds[0],
        fallback: true,
      };
      this.cache.set(key, tile);
      this.bytes += tile.bytes;
      patches = [{ key, bounds }];
    }
    this.displayed.set(layer.id, { crs, bounds, patches });
  }
  private trimCache(): void {
    const pinned = new Set(this.wanted);
    for (const presentation of this.displayed.values())
      for (const patch of presentation.patches) pinned.add(patch.key);
    for (const key of this.cache.keys()) {
      if (this.bytes <= this.cacheLimit && this.cache.size <= 1024) break;
      if (!pinned.has(key)) this.evict(key);
    }
  }
  private cancelPending(): void {
    this.presentation.clear();
    this.epoch++;
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    this.scheduled = 0;
    this.queue = [];
    this.wanted.clear();
    this.currentTasks.clear();
    this.pendingBatches.clear();
    this.failures.clear();
    for (const controller of this.active.values())
      controller.abort(new DOMException('View superseded', 'AbortError'));
  }
  /** Navigation changes only transform displayed pixels; new I/O waits for idle. */
  beginNavigation(kind: 'pointer' | 'camera'): void {
    if (this.disposed) return;
    this.gestures.add(kind);
    this.viewChanged();
  }
  viewChanged(): void {
    if (this.disposed) return;
    this.lastMovement = performance.now();
    this.signature = '';
    this.cancelPending();
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (!this.gestures.size) this.scheduleSettledView();
  }
  endNavigation(kind: 'pointer' | 'camera'): void {
    if (this.disposed) return;
    this.gestures.delete(kind);
    if (!this.gestures.size) this.scheduleSettledView();
  }
  private scheduleSettledView(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    const remaining = Math.max(0, this.settleDelay - (performance.now() - this.lastMovement));
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.disposed || this.gestures.size) return;
      this.signature = '';
      this.deps.requestRender();
    }, remaining);
  }
  private evict(key: string): void {
    const tile = this.cache.get(key);
    if (!tile) return;
    this.cache.delete(key);
    this.bytes -= tile.bytes;
    if (tile.image && !('data' in tile.image)) tile.image.width = tile.image.height = 0;
    tile.image = null;
  }
  private layer(id: string): Layer {
    const layer = this.layers.get(id);
    if (!layer) throw new RasterError('RASTER_LAYER_NOT_FOUND', `Unknown raster layer: ${id}`);
    return layer;
  }
  private invalidate(): void {
    this.version++;
    this.cancelPending();
    this.signature = '';
    this.deps.requestRender();
  }
  addSource(id: string, source: RasterSource, style: RasterStyle = {}): void {
    if (this.disposed)
      throw new RasterError('RASTER_DISPOSED', 'Raster renderer has been disposed.');
    if (!id || id.length > 256 || this.layers.has(id))
      throw new RasterError(
        'INVALID_RASTER_LAYER_ID',
        'Raster layer id must be nonempty and unique.',
      );
    if (this.layers.size >= 16)
      throw new RasterError(
        'RASTER_LAYER_BUDGET',
        'At most 16 open raster layers are supported per renderer.',
      );
    validateRasterStyle(source.metadata, style);
    this.layers.set(id, {
      id,
      source,
      style: cloneStyle(style),
      visible: true,
      revision: ++this.version,
    });
    try {
      if (this.deps.registerLayerPass) {
        this.layerPasses.set(
          id,
          this.deps.registerLayerPass(id, (frame) => this.render(frame, id)),
        );
      }
    } catch (error) {
      this.layers.delete(id);
      throw error;
    }
    this.invalidate();
  }
  remove(id: string): void {
    const release = this.layerPasses.get(id);
    if (release) {
      this.layerPasses.delete(id);
      release();
    }
    const layer = this.layers.get(id);
    if (!layer) return;
    this.layers.delete(id);
    this.displayed.delete(id);
    this.pendingBatches.delete(id);
    for (const tile of this.cache.values()) if (tile.layer === id) this.evict(tile.key);
    for (const [key, controller] of this.active) {
      const parts: unknown = JSON.parse(key);
      if (Array.isArray(parts) && parts[0] === id) controller.abort();
    }
    this.queue = this.queue.filter((task) => task.layer.id !== id);
    try {
      this.closeSource(layer.source);
    } finally {
      this.invalidate();
    }
  }
  getLayers(): readonly RasterLayerInfo[] {
    return [...this.layers.values()].map((layer) => ({
      id: layer.id,
      metadata: layer.source.metadata,
      style: cloneStyle(layer.style),
      visible: layer.visible,
    }));
  }
  setStyle(id: string, style: RasterStyle): void {
    const layer = this.layer(id),
      next = { ...layer.style, ...style };
    const beforeBands = rasterBands(layer.source.metadata, layer.style);
    const afterBands = rasterBands(layer.source.metadata, next);
    const bandsChanged =
      beforeBands.length !== afterBands.length ||
      beforeBands.some((band, i) => band !== afterBands[i]);
    if (bandsChanged && !Object.prototype.hasOwnProperty.call(style, 'ranges')) {
      // Inherited channel ranges must not follow a different source band selection.
      delete next.ranges;
    }
    validateRasterStyle(layer.source.metadata, next);
    layer.style = cloneStyle(next);
    if (Object.keys(style).every((key) => key === 'opacity')) {
      this.deps.requestRender();
      return;
    }
    layer.revision = ++this.version;
    // Keep old coverage until each new-style region has a ready replacement.
    this.invalidate();
  }
  setVisibility(id: string, visible: boolean): void {
    this.layer(id).visible = visible;
    if (!visible) this.displayed.delete(id);
    this.invalidate();
  }
  moveLayer(id: string, beforeId?: string): void {
    const layer = this.layer(id);
    if (beforeId === id) return;
    if (beforeId !== undefined) this.layer(beforeId);
    const entries = [...this.layers.values()].filter((value) => value.id !== id);
    entries.splice(
      beforeId === undefined ? entries.length : entries.findIndex((value) => value.id === beforeId),
      0,
      layer,
    );
    this.layers.clear();
    for (const entry of entries) this.layers.set(entry.id, entry);
    if (this.deps.registerLayerPass) {
      for (const release of this.layerPasses.values()) release();
      this.layerPasses.clear();
      for (const entry of entries) {
        this.layerPasses.set(
          entry.id,
          this.deps.registerLayerPass(entry.id, (frame) => this.render(frame, entry.id)),
        );
      }
    }
    this.invalidate();
  }
  async getBounds(id: string): Promise<RasterWindow> {
    const layer = this.layer(id);
    return transformRasterBounds(
      layer.source.metadata.bounds,
      await rasterCoordinateTransform(layer.source.metadata.crs, this.deps.getCRS()),
    );
  }
  async queryPixel(
    id: string,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<readonly number[] | null> {
    const layer = this.layer(id),
      metadata = layer.source.metadata,
      base = metadata.levels[0];
    const transform = await rasterCoordinateTransform(this.deps.getCRS(), metadata.crs),
      world = transform(x, y);
    signal?.throwIfAborted();
    if (!world) return null;
    const pixel = new AffineTransform(
      metadata.resolution[0],
      metadata.resolution[1],
      metadata.origin[0],
      metadata.origin[1],
    ).unproject(world[0], world[1]);
    const col = Math.floor(pixel[0]),
      row = Math.floor(pixel[1]);
    if (col < 0 || row < 0 || col >= base.width || row >= base.height) return null;
    const result = await layer.source.readWindow(
      {
        level: base.id,
        window: [col, row, col + 1, row + 1],
        samples: Array.from({ length: base.samples }, (_, i) => i),
      },
      signal,
    );
    return result.data.map((data) => data[0]);
  }
  toReferences(): readonly RasterLayerReference[] {
    return [...this.layers.values()].map((layer) => ({
      id: layer.id,
      source: layer.source.toReference(),
      style: cloneStyle(layer.style),
      visible: layer.visible,
    }));
  }
  getProcessingStats(id: string): RasterProcessingStats | null {
    return this.layer(id).source.getProcessingStats?.() ?? null;
  }
  getStats(): RasterCacheStats {
    const processing = [...this.layers.values()]
      .map((layer) => layer.source.getProcessingStats?.())
      .filter((value): value is RasterProcessingStats => !!value);
    const sum = (key: keyof RasterProcessingStats) =>
      processing.reduce((total, value) => total + Number(value[key] ?? 0), 0);
    return {
      cachedBytes: this.bytes,
      pixelCacheBytes: [...this.cache.values()].reduce(
        (n, tile) => n + (tile.image && 'data' in tile.image ? tile.bytes : 0),
        0,
      ),
      canvasCacheBytes: [...this.cache.values()].reduce(
        (n, tile) => n + (tile.image && !('data' in tile.image) ? tile.bytes : 0),
        0,
      ),
      cachedTiles: this.cache.size,
      activeReads: this.active.size,
      queuedReads: this.queue.length,
      pendingFrames: this.pendingBatches.size,
      committedFrames: this.committedFrames,
      presentedTiles: this.presentedTiles,
      readRequests: this.readRequests,
      taskLifecycle: {
        queued: this.taskQueued,
        loadTileStarted: this.loadTileStarted,
        planSucceeded: this.planSucceeded,
        planEmpty: this.planEmpty,
        loadTileFailed: this.loadTileFailed,
      },
      pumpBlocked: { gestures: this.pumpBlockedGestures, settleTimer: this.pumpBlockedSettleTimer },
      taskErrors: this.taskErrors.map((item) => ({ ...item })),
      interacting: this.gestures.size > 0 || this.settleTimer !== null,
      planning: this.planningDiagnostics,
      plannedLevels: [...this.plannedLevels.entries()]
        .sort(([a], [b]) => a - b)
        .map(([level, count]) => ({ level, count })),
      performance: {
        planningMs: this.planningMs,
        planningPasses: this.planningPasses,
        plannedTiles: this.plannedTiles,
        canvasUploadMs: this.canvasUploadMs,
        canvasPreparedTiles: this.canvasPreparedTiles,
        pixelPreparedTiles: this.pixelPreparedTiles,
        pixelPreclassifiedTiles: this.pixelPreclassifiedTiles,
        pixelAlphaFallbackTiles: this.pixelAlphaFallbackTiles,
        pixelPrepareMs: this.pixelPrepareMs,
        presentationWaitMs: this.presentation.getDiagnostics().waitMs,
        presentationFlushes: this.presentation.getDiagnostics().flushes,
        workerMs: sum('workerMs'),
        fileReadMs: sum('fileReadMs'),
        fileReadBytes: sum('fileReadBytes'),
        fileReadOps: sum('fileReadOps'),
        pageCacheHits: sum('pageCacheHits'),
        pageCacheMisses: sum('pageCacheMisses'),
        blockCacheHits: sum('blockCacheHits'),
        blockCacheMisses: sum('blockCacheMisses'),
        blockCacheEvictions: sum('blockCacheEvictions'),
        blockCacheEvictedBytes: sum('blockCacheEvictedBytes'),
        blockCacheAdmittedBytes: sum('blockCacheAdmittedBytes'),
        blockCachePeakBytes: Math.max(0, ...processing.map((value) => value.blockCachePeakBytes)),
        blockCachePeakEntries: Math.max(
          0,
          ...processing.map((value) => value.blockCachePeakEntries),
        ),
        blockCacheLimitBytes: sum('blockCacheLimitBytes'),
        blockCacheOversizeSkips: sum('blockCacheOversizeSkips'),
        blockLoadMs: sum('blockLoadMs'),
        assembleMs: sum('assembleMs'),
        colorizeMs: sum('colorizeMs'),
        transferMs: sum('transferMs'),
      },
    };
  }
  private readonly closingSources = new Set<RasterSource>();
  private readonly sourceCleanupErrors = new Map<RasterSource, unknown>();
  get closed(): Promise<void> {
    return settleDisposals(
      [...this.closingSources].map((source) =>
        this.sourceCleanupErrors.has(source)
          ? Promise.reject(this.sourceCleanupErrors.get(source))
          : source.settled,
      ),
    );
  }
  private closeSource(source: RasterSource): void {
    this.closingSources.add(source);
    this.sourceCleanupErrors.delete(source);
    try {
      source.dispose();
    } catch (error) {
      this.sourceCleanupErrors.set(source, error);
      throw error;
    }
    if (!source.settled) {
      this.closingSources.delete(source);
      return;
    }
    void source.settled.then(() => this.closingSources.delete(source)).catch(() => {});
  }
  dispose(): void {
    if (this.disposed) {
      const errors: unknown[] = [];
      for (const source of this.closingSources) {
        try {
          this.closeSource(source);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Unable to close some raster sources');
      return;
    }
    this.disposed = true;
    for (const release of this.layerPasses.values()) release();
    this.layerPasses.clear();
    this.presentation.dispose();
    this.epoch++;
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    this.scheduled = 0;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.queue = [];
    this.wanted.clear();
    this.failures.clear();
    this.currentTasks.clear();
    this.displayed.clear();
    this.pendingBatches.clear();
    this.gestures.clear();
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    const sources = [
      ...new Set([
        ...this.closingSources,
        ...[...this.layers.values()].map((layer) => layer.source),
      ]),
    ];
    this.layers.clear();
    // Run every teardown even when an external provider has a faulty dispose().
    const failures: unknown[] = [];
    for (const source of sources) {
      try {
        this.closeSource(source);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const key of this.cache.keys()) this.evict(key);
    if (failures.length) throw new AggregateError(failures, 'Unable to close some raster sources');
  }
}
