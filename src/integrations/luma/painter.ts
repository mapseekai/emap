import type { WorkerRuntime } from '@mapseekai/tasklane';
import { selectPathMembers } from '../../engine/rendering/luma/path-members';
import { PolygonPresentation, type PolygonChannel } from './polygon-presentation';
import type { MeshDraw } from './mesh-command-cache';
import { compactStrokeCompatible } from '../../engine/rendering/luma/compact-stroke';
import { screenPathFrame } from '../../engine/rendering/luma/screen-path-frame';
import { fillStorageBounds } from '../../engine/rendering/luma/fill-storage';
import type { GeometryEntry } from './geometry-cache';
import { GeometryChunkCache, type GeometryOwner, type GeometryRequest } from './geometry-cache';
import type { GeometryInput } from '../../engine/rendering/luma/geometry-jobs';
import { groundBounds } from '../../domain/geo/perspective-transform';
import { arcVisibilityFilter, arcVisibilityKey } from '../../domain/geo/arc-visibility';
import { GpuRenderer } from './gpu-renderer';
import { GpuColors } from './colors';
import { useMsaaPath } from './path-pipeline';
import {
  PainterGeometryCache,
  type GeometryKey,
  type PreparedGeometry,
  type CachedGeometry,
} from './painter-cache';
import { MsdfLabelAtlas } from '../msdf/atlas';
import { pointsFromShapes, arcIdsFromShapes, readPart } from '../../engine/rendering/luma/geometry';
import {
  polygonGeometry,
  lineGeometry,
  markerVertices,
  type Point,
  type Shapes,
} from '../../engine/rendering/luma/geometry';
import { pathGeometry } from '../../engine/rendering/luma/path-geometry';
import { flatScreenPathGeometry } from '../../engine/rendering/luma/flat-path';
import type { ScreenPathRequest } from '../../engine/rendering/luma/screen-paths';
import { CanvasPainter } from '../../engine/rendering/canvas-painter';
import type {
  EditPainter,
  ArrowDotPathOptions,
  PolygonFillOptions,
  PolygonDrawOptions,
  DrawOverlayState,
  MeasurementOverlayState,
} from '../../engine/rendering/painter';
import type { PointIcon } from '../../engine/rendering/icons/images';
import type { LabelFrame } from '../../engine/rendering/labels/manager';
import { AffineTransform } from '../../domain/geo/transform';
import {
  absArcId,
  type ArcCollection,
  type PathShape,
  type StrokeStyle,
  type PointStyle,
  type VertexDotStyle,
} from '../../shared/types/mapshaper-types';
import type { RendererBackend } from '../../engine/map/renderer';
import type { MeshPaint, Rect } from './types';

interface Options {
  invalidate: (reason?: 'geometry') => void;
  report: (error: Error) => void;
  signal?: AbortSignal;
  workerRuntime?: WorkerRuntime;
  msdfWorkerUrl?: string | URL;
  geometryWorkerUrl?: string | URL;
  screenPathFiltering?: boolean;
}
/** Main map geometry is drawn directly by luma. The existing map owns selection,
 * filter/style resolution, source order and editing; this adapter owns GPU resources only.
 */
export class LumaPainter implements EditPainter {
  readonly retainedVectorChunks = true;
  private transform = new AffineTransform();
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private screenPathFiltering = true;
  private active = false;
  private frameStarted = 0;
  private completionSample: {
    start: number;
    probe: ReturnType<GpuRenderer['probeCompletion']>;
  } | null = null;
  private completionSampleAt = -Infinity;
  private completionMs: number | null = null;
  private queueBusyMs: number | null = null;
  private navigationCpuMs = 0;
  private disposed = false;
  private colors: GpuColors;
  private cache: PainterGeometryCache;
  private decoration: { canvas: HTMLCanvasElement; painter: CanvasPainter } | null = null;
  private images = new Set<CanvasImageSource | ImageData>();
  private lastImages = new Set<CanvasImageSource | ImageData>();
  private chunks: GeometryChunkCache;
  private commands: (() => void)[] = [];
  private paintedCommands: (() => void)[] = [];
  private drawnEntries = new Set<GeometryEntry>();
  private navigationLabels: LabelFrame | undefined;
  private presentation = { presented: 0, partial: 0, complete: 0, replays: 0 };
  framePresented = false;
  private requests: GeometryRequest[] = [];
  private polygonScope: { channels: PolygonChannel[]; order: number } | null = null;
  private polygons = new Map<
    string,
    { signature: string; sourceId: string; layerId: string; presentation: PolygonPresentation }
  >();
  private polygonKeys = new Set<string>();
  private polygonSlots = new Map<string, number>();
  private polygonFrames: PolygonPresentation[] = [];
  private strokeScopes = new Map<
    string,
    { channels: PolygonChannel[]; presentation: PolygonPresentation }
  >();
  private context:
    | (GeometryOwner & { bounds?: Rect; content?: string; geometryLod?: boolean })
    | null = null;
  /** Presence marker; owner.content in the chunk cache owns content invalidation. */
  private paintedContent: true | null = null;
  private paintedDimensions = '';
  frameComplete = true;
  frameRetained = false;
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly backend: Exclude<RendererBackend, 'canvas2d'>,
    readonly gpu: GpuRenderer,
    private readonly options: Options,
  ) {
    this.screenPathFiltering = options.screenPathFiltering !== false;
    this.colors = new GpuColors(canvas);
    this.cache = new PainterGeometryCache(gpu, undefined, true, (incoming) =>
      this.chunks.admitExternal(incoming),
    );
    this.chunks = new GeometryChunkCache(gpu, {
      workerRuntime: options.workerRuntime,
      externalBytes: () =>
        this.cache.byteSize +
        Math.max(this.gpu.pageSlackBytes ?? 0, this.gpu.pageReservationBytes ?? 0),
      invalidate: () => options.invalidate('geometry'),
      report: options.report,
      workerUrl: options.geometryWorkerUrl
        ? new URL(String(options.geometryWorkerUrl), canvas.ownerDocument.baseURI)
        : new URL('emap-geometry-worker.js', import.meta.url),
    });
  }
  static async create(
    canvas: HTMLCanvasElement,
    backend: Exclude<RendererBackend, 'canvas2d'>,
    options: Options,
  ): Promise<LumaPainter> {
    options.signal?.throwIfAborted();
    let painter: LumaPainter | undefined;
    const gpu = await GpuRenderer.create(
      canvas,
      () => {
        painter?.clearGeometryCache();
        options.invalidate();
      },
      options.report,
      backend === 'webgl2' ? 'webgl' : 'webgpu',
    );
    try {
      options.signal?.throwIfAborted();
      painter = new LumaPainter(canvas, backend, gpu, options);
      return painter;
    } catch (error) {
      gpu.dispose();
      throw error;
    }
  }
  get stats() {
    return {
      ...this.gpu.stats,
      geometryCache: this.cache.stats,
      geometryChunks: this.chunks.stats,
      geometryPages: this.gpu.pageStats,
      renderCommands: this.gpu.commandStats,
      presentation: { ...this.presentation },
      navigationFrameMs: this.navigationFrameMs,
      navigationTiming: {
        cpuMs: this.navigationCpuMs,
        gpuMs: null, // Independent GPU duration is available only through timestamp diagnostics.
        completionMs: this.completionMs,
        queueBusyMs: this.queueBusyMs,
        pending: this.completionSample !== null,
      },
      text: this.gpu.textStats,
      memory: this.gpu.memoryStats,
    };
  }
  get navigationPending(): boolean {
    // Poll the fence now; its most recent observation may predate this recovery timer.
    void this.navigationFrameMs;
    return this.completionSample !== null;
  }
  get navigationFrameMs(): number {
    if (this.disposed) return 0;
    const now = performance.now();
    const sample = this.completionSample;
    if (sample) {
      const status = sample.probe.poll();
      if (status === 'pending') {
        // A nonblocking poll actually observed unfinished work at this instant.
        this.queueBusyMs = now - sample.start;
      } else {
        this.completionMs = status === 'complete' ? now - sample.start : null;
        if (status === 'unavailable') this.queueBusyMs = null;
        sample.probe.dispose();
        this.completionSample = null;
      }
    }
    // Expired/unavailable samples require a recovery draw, never a zero-cost GPU claim.
    if (!this.completionSample && now - this.completionSampleAt > 1000) return Infinity;
    return Math.max(this.navigationCpuMs, this.queueBusyMs ?? Infinity);
  }
  /** One outstanding fence, at most every 250 ms during camera-only replay.
   * Full content/view replanning starts a new sample generation in clear(). */
  private measureCompletion(start: number): void {
    this.navigationCpuMs = performance.now() - start;
    if (this.completionSample || start - this.completionSampleAt < 250) return;
    this.completionSample = { start, probe: this.gpu.probeCompletion() };
    this.completionSampleAt = start;
    this.completionMs = null;
    // Zero is the observed lower bound of queue pressure, NOT a GPU duration.
    this.queueBusyMs = 0;
  }
  private resetNavigationTiming(): void {
    this.completionSample?.probe.dispose();
    this.completionSample = null;
    this.completionSampleAt = -Infinity;
    this.completionMs = this.queueBusyMs = null;
    this.navigationCpuMs = 0;
  }
  createLabelAtlas(): MsdfLabelAtlas {
    const url = this.options.msdfWorkerUrl;
    return new MsdfLabelAtlas(
      url
        ? new URL(String(url), this.canvas.ownerDocument.baseURI)
        : new URL('emap-msdf-worker.js', import.meta.url),
      this.canvas.ownerDocument,
      this.options.workerRuntime,
    );
  }
  clearLabels(): void {
    this.gpu.clearLabels();
  }
  setLayerContext(
    context: (GeometryOwner & { bounds?: Rect; content?: string; geometryLod?: boolean }) | null,
  ): void {
    this.context = context;
    this.cache.contextFor(context);
  }
  setInteracting(value: boolean): void {
    this.chunks.setInteracting(value);
    if (!value) this.resetNavigationTiming();
  }
  clearGeometryCache(scope: { sourceId?: string; layerId?: string } = {}): void {
    this.resetNavigationTiming();
    this.forgetPolygons(scope);
    this.cache.clear(scope);
    this.chunks.clear(scope);
    this.paintedContent = null;
    this.paintedCommands = [];
    this.chunks.pin([]);
  }
  setScreenPathFiltering(enabled: boolean): void {
    if (enabled === this.screenPathFiltering) return;
    this.screenPathFiltering = enabled;
    this.clearGeometryCache();
  }
  setTransform(transform: AffineTransform): void {
    this.transform = transform.clone();
  }
  setPixelRatio(ratio: number): void {
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid pixel ratio');
    this.pixelRatio = ratio;
  }
  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.finishFrame();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.gpu.resize(this.width, this.height, this.pixelRatio);
  }
  clear(): void {
    if (this.disposed) return;
    this.finishFrame();
    // A full frame may have different visible layers, content, labels or viewport.
    // Retire the old generation without discarding any hidden geometry buffers.
    this.resetNavigationTiming();
    this.frameStarted = performance.now();
    this.colors.reset();
    this.cache.begin();
    this.chunks.begin(this.cache.stats.bytes);
    this.images.clear();
    this.commands = [];
    this.requests = [];
    this.polygonScope = null;
    this.polygonKeys.clear();
    this.polygonSlots.clear();
    this.polygonFrames = [];
    this.strokeScopes.clear();
    this.context = null;
    // Record an ordered frame before clearing the last complete GPU image.
    this.active = true;
    this.frameComplete = false;
    this.framePresented = false;
    this.frameRetained = false;
  }
  finishFrame(): void {
    if (!this.active) return;
    const dimensions = [this.width, this.height, this.pixelRatio].join(':');
    try {
      for (const scope of this.strokeScopes.values()) scope.presentation.update(scope.channels);
      const pending = this.requests.some((request) => !this.chunks.complete(request));
      this.gpu.resize(this.width, this.height, this.pixelRatio);
      if (!this.gpu.begin(this.transform)) {
        this.paintedContent = null;
        return;
      }
      this.drawnEntries.clear();
      const drawsBefore = this.gpu.stats.drawCalls;
      try {
        // Clear and replay ALL available commands in original order on every
        // progressive frame. Never blend successive partial frames over each other.
        for (const command of this.commands) command();
      } finally {
        this.gpu.end();
      }
      this.chunks.pin(
        this.drawnEntries,
        this.polygonFrames.some((polygon) => polygon.planning),
      );
      this.frameComplete = !pending && this.polygonFrames.every((polygon) => polygon.complete);
      // An empty loading frame must not become a navigation snapshot that blocks first paint.
      this.framePresented = this.frameComplete || this.gpu.stats.drawCalls > drawsBefore;
      this.paintedCommands = this.commands;
      this.paintedContent = true;
      this.paintedDimensions = dimensions;
      this.chunks.didPresent(performance.now() - this.frameStarted);
      this.measureCompletion(this.frameStarted);
      this.presentation.presented++;
      if (!this.frameComplete) this.presentation.partial++;
      else this.presentation.complete++;
    } catch (error) {
      this.paintedContent = null;
      this.paintedCommands = [];
      this.chunks.pin([]);
      this.frameComplete = this.framePresented = this.frameRetained = false;
      throw error;
    } finally {
      this.active = false;
      this.commands = [];
      this.requests = [];
      this.strokeScopes.clear();
      for (const [key, polygon] of this.polygons)
        if (!this.polygonKeys.has(key)) {
          polygon.presentation.dispose();
          this.polygons.delete(key);
        }
      this.cache.finish();
      this.chunks.finish();
      for (const image of this.lastImages) if (!this.images.has(image)) this.gpu.forgetImage(image);
      this.lastImages = new Set(this.images);
    }
  }
  /** Immediate camera-only replay. Existing GPU buffers are projected afresh, so
   * line/icon/text sizes stay in CSS pixels. New viewport planning is rate-limited
   * by the render service; ready Worker blocks may join this replay without waiting
   * for the gesture to end. No synchronous geometry preparation runs here. */
  renderNavigation(view: AffineTransform, labels: LabelFrame = { key: '', labels: [] }): boolean {
    const start = performance.now();
    if (
      this.disposed ||
      this.active ||
      this.paintedContent === null ||
      this.paintedDimensions !== [this.width, this.height, this.pixelRatio].join(':')
    )
      return false;
    if (
      [...this.drawnEntries].some(
        (entry) =>
          entry.meshes.some((mesh) => mesh.compactStroke) &&
          !compactStrokeCompatible(view, entry.screenView),
      )
    )
      return false;
    this.transform = view.clone();
    this.navigationLabels = labels;
    this.drawnEntries.clear();
    try {
      if (!this.gpu.begin(this.transform)) return false;
      try {
        for (const command of this.paintedCommands) command();
      } finally {
        this.gpu.end();
      }
      this.chunks.pin(this.drawnEntries);
      this.presentation.replays++;
      this.measureCompletion(start);
      return true;
    } catch (error) {
      this.paintedContent = null;
      this.paintedCommands = [];
      throw error;
    } finally {
      this.navigationLabels = undefined;
    }
  }
  /** Large owner-bound draws use bounded packets. Tiny layers and immediate editor
   * highlights retain their existing synchronous implementation. */
  private screenPath(paint: MeshPaint): ScreenPathRequest | undefined {
    if (!this.screenPathFiltering || paint.color[3] !== 1 || paint.dash?.length || paint.arrow)
      return;
    return {
      view: screenPathFrame(
        this.transform,
        this.context?.bounds ?? [-180, -90, 180, 90],
        this.pixelRatio,
      ),
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio,
      initialScale: 0,
      smallArcs: false,
      halfPixel: true,
      cull: false,
      padding: 8,
      revision: this.context?.revision ?? 0,
    };
  }
  private chunked(
    input: Omit<GeometryInput, 'bounds' | 'interval'>,
    paint: MeshPaint,
    icon?: PointIcon,
  ): boolean {
    const owner = this.context;
    if (!owner || (input.kind === 'arrow' && !input.shapes)) return false;
    const large =
      input.kind === 'point'
        ? (input.ids?.length ?? input.shapes?.length ?? 0) >= 50_000
        : (input.arcs?.getPointCount?.() ?? 0) >= 100_000;
    if (!large || (input.filter && !arcVisibilityKey(input.arcs!, input.filter))) return false;
    const view = this.transform;
    const wholeLayer = input.kind === 'path' && owner.sourceSelection && !this.polygonScope;
    const visibility = input.arcs && arcVisibilityKey(input.arcs, input.filter);
    const bounds = owner.bounds ?? ([-180, -90, 180, 90] as const);
    const screen = input.kind === 'path' ? this.screenPath(paint) : undefined;
    const viewBounds = groundBounds(
      this.transform,
      this.width,
      this.height,
      Math.max(8, (paint.width ?? 1) * 4 + 2, paint.radius ?? 0, icon?.radius ?? 0),
    );
    const request = this.chunks.request(
      {
        ...input,
        wholeLayer,
        filter:
          wholeLayer && visibility
            ? arcVisibilityFilter(input.arcs!, visibility[0], null)
            : input.filter,
        sourceSelection: owner.sourceSelection,
        ordered: !!icon || input.ordered,
        spatialOrder:
          !!wholeLayer &&
          !screen &&
          !input.ordered &&
          !icon &&
          this.gpu.strokeBatchingEnabled &&
          useMsaaPath(paint, this.gpu.pathMode, this.gpu.pathRendering.samples),
        compactStroke:
          !!screen &&
          this.gpu.compactStrokesEnabled !== false &&
          this.gpu.pathRendering.samples > 1 &&
          this.gpu.pathMode !== 'legacy' &&
          compactStrokeCompatible(view, screen.view),
        screen,
        bounds,
        viewBounds: wholeLayer ? undefined : viewBounds,
        storageBounds: input.kind === 'fill' ? fillStorageBounds(viewBounds, bounds) : undefined,
        interval: input.arcs?.getRetainedInterval?.() ?? 0,
      },
      {
        ...owner,
        content: JSON.stringify([
          owner.content,
          paint.color,
          paint.radius,
          paint.filled,
          paint.marker,
          // Stroke widths/dashes scale together at extreme camera zoom levels.
          paint.dash?.map((length) => Number((length / (paint.width || 1)).toPrecision(12))),
          paint.arrow,
          icon && { ...icon, asset: this.chunks.identity(icon.asset.image) },
        ]),
      },
    );
    this.requests.push(request);
    if (icon) this.images.add(icon.asset.image);
    const drawEntries = (
      entries: readonly GeometryEntry[],
      members?: ReadonlyMap<GeometryEntry, ReadonlySet<number> | undefined>,
    ) => {
      let batch: MeshDraw[] = [],
        batchPaint: MeshPaint | undefined,
        basis = '';
      let strokeBounds: readonly [number, number, number, number] | undefined;
      const flush = () => {
        if (batch.length && batchPaint) {
          if (this.gpu.drawMeshSequence) this.gpu.drawMeshSequence(batch, batchPaint);
          else
            for (const draw of batch)
              this.gpu.drawMesh(draw.mesh, batchPaint, draw.ranges, draw.indexRanges);
        }
        batch = [];
      };
      for (const entry of entries) {
        const nextBasis = entry.screenSpace ? (entry.screenView?.join(':') ?? 'screen') : 'source';
        if (nextBasis !== basis) {
          flush();
          basis = nextBasis;
          let rangeView = this.transform;
          if (entry.screenSpace && entry.screenView) {
            const old = new AffineTransform(...entry.screenView);
            const [x, y] = this.transform.project(...old.unproject(0, 0));
            rangeView = new AffineTransform(
              this.transform.mx / old.mx,
              this.transform.my / old.my,
              x,
              y,
            );
          }
          strokeBounds = groundBounds(
            rangeView,
            this.width,
            this.height,
            Math.max(8, (paint.width ?? 1) * 4 + 2),
          );
        }
        const currentPaint = {
          ...paint,
          screenSpace: entry.screenSpace,
          screenView: entry.screenView,
        };
        batchPaint = currentPaint;
        for (let i = 0; i < entry.meshes.length; i++) {
          const mesh = entry.meshes[i];
          if (mesh.compactStroke && !compactStrokeCompatible(this.transform, entry.screenView))
            continue;
          this.drawnEntries.add(entry);
          if (icon) {
            flush();
            this.gpu.drawPointIcons(mesh, icon);
          } else {
            const index = entry.ranges[i];
            const range =
              entry.screenSpace &&
              (!index?.data.envelopeHalfWidths ||
                !compactStrokeCompatible(this.transform, entry.screenView))
                ? undefined
                : index?.selectBounds(strokeBounds!);
            const fill = entry.fillRanges[i]?.select(this.transform, this.width, this.height);
            const owners = members?.get(entry);
            const selected =
              owners && entry.memberRanges?.[i]
                ? selectPathMembers(
                    entry.memberRanges[i]!,
                    entry.job.members,
                    owners,
                    range?.ranges,
                  )
                : range?.ranges;
            batch.push({ mesh, ranges: selected, indexRanges: fill?.ranges });
          }
        }
      }
      flush();
    };
    if (wholeLayer) {
      const key = JSON.stringify(['stroke', owner.sourceId, owner.id]);
      let scope = this.strokeScopes.get(key);
      if (!scope) {
        const signature = JSON.stringify([
          owner.revision,
          owner.content,
          this.chunks.identity(input.shapes),
          this.chunks.identity(owner.bounds),
        ]);
        let layer = this.polygons.get(key);
        if (layer?.signature !== signature) {
          layer?.presentation.dispose();
          layer = {
            signature,
            sourceId: owner.sourceId,
            layerId: owner.id,
            presentation: new PolygonPresentation(input.shapes ?? [], {
              atomic: true,
              ready: (entry) =>
                this.chunks.isResident(entry) &&
                (!entry.meshes.some((mesh) => mesh.compactStroke) ||
                  compactStrokeCompatible(this.transform, entry.screenView)),
              complete: (pending) => this.chunks.complete(pending),
              invalidate: () => this.options.invalidate('geometry'),
              report: this.options.report,
            }),
          };
          this.polygons.set(key, layer);
        }
        scope = { channels: [], presentation: layer.presentation };
        this.strokeScopes.set(key, scope);
        this.polygonKeys.add(key);
        this.polygonFrames.push(layer.presentation);
        this.commands.push(() => layer!.presentation.draw());
      }
      scope.channels.push({
        key: JSON.stringify([request.owner.content, request.slot]),
        order: scope.channels.length,
        request,
        draw: (entries) => {
          for (const entry of entries) this.drawnEntries.add(entry);
          drawEntries(entries);
        },
      });
      return true;
    }
    if (this.polygonScope) {
      const order = this.polygonScope.order;
      this.polygonScope.channels.push({
        key: JSON.stringify([order, request.input.kind, request.owner.content]),
        order,
        request,
        draw: (entries, members) => {
          // Empty (offscreen/degenerate) meshes still participate in readiness.
          for (const entry of entries) this.drawnEntries.add(entry);
          drawEntries(entries, members);
        },
      });
    }
    this.commands.push(() => drawEntries(this.chunks.drawable(request)));
    return true;
  }
  private draw(entry: CachedGeometry, paint: MeshPaint): void {
    if (!entry.mesh) return;
    const mesh = entry.mesh;
    this.commands.push(() => {
      const selection = !entry.screenView
        ? entry.ranges?.select(
            this.transform,
            this.width,
            this.height,
            Math.max(8, (paint.width ?? 1) * 4 + 2),
          )
        : undefined;
      this.gpu.drawMesh(
        mesh,
        entry.screenView
          ? {
              ...paint,
              screenSpace: true,
              screenView: entry.screenView,
            }
          : paint,
        selection?.ranges,
      );
    });
  }

  drawPoints(shapes: Shapes, style: PointStyle, ids?: Uint32Array, components?: Uint32Array): void {
    if (!this.active || style.radius === 0) return;
    if (
      this.chunked(
        { kind: 'point', shapes, ids, components },
        {
          color: this.colors.resolve(style.color, 'primary'),
          radius: style.radius ?? 4,
          width: 1,
          filled: style.fill !== false,
          marker: markerVertices(style.shape),
        },
      )
    )
      return;
    const entry = this.cache.get(
      { references: [shapes], values: ['point'], selections: [ids, components] },
      () => pointsFromShapes(shapes, ids, components),
    );
    this.draw(entry, {
      color: this.colors.resolve(style.color, 'primary'),
      radius: style.radius ?? 4,
      width: 1,
      filled: style.fill !== false,
      marker: markerVertices(style.shape),
    });
  }
  drawPointIcons(
    shapes: Shapes,
    icon: PointIcon,
    ids?: Uint32Array,
    components?: Uint32Array,
  ): void {
    if (!this.active) return;
    if (this.chunked({ kind: 'point', shapes, ids, components }, { color: [1, 1, 1, 1] }, icon))
      return;
    const entry = this.cache.get(
      { references: [shapes], values: ['point'], selections: [ids, components] },
      () => pointsFromShapes(shapes, ids, components),
    );
    this.images.add(icon.asset.image);
    if (entry.mesh) {
      const mesh = entry.mesh;
      this.commands.push(() => this.gpu.drawPointIcons(mesh, icon));
    }
  }
  clearIcons(): void {
    /* Images are shared and released by their owner through forgetImage. */
  }
  forgetImage(image: CanvasImageSource | ImageData): void {
    this.gpu.forgetImage(image);
    this.images.delete(image);
    this.lastImages.delete(image);
  }
  drawPaths(
    shapes: Shapes,
    style: StrokeStyle,
    arcs: ArcCollection,
    filter?: (id: number) => boolean,
    ids?: Uint32Array,
    revision?: number,
  ): void {
    this.drawShapePaths(shapes, style, arcs, filter, ids, revision, false);
  }
  drawOutlinePaths(
    shapes: Shapes,
    style: StrokeStyle,
    arcs: ArcCollection,
    filter?: (id: number) => boolean,
    ids?: Uint32Array,
    revision?: number,
  ): void {
    this.drawShapePaths(shapes, style, arcs, filter, ids, revision, true);
  }
  private drawShapePaths(
    shapes: Shapes,
    style: StrokeStyle,
    arcs: ArcCollection,
    filter: ((id: number) => boolean) | undefined,
    ids: Uint32Array | undefined,
    revision: number | undefined,
    forward: boolean,
  ): void {
    if (!this.active || style.width === 0) return;
    if (
      this.chunked(
        {
          kind: style.dashType === 'arrow-dot' ? 'arrow' : 'path',
          arcs,
          shapes,
          filter,
          ids,
          forward,
        },
        this.arcPaint(style),
      )
    )
      return;
    const screen = this.screenPath(this.arcPaint(style));
    const entry = this.preparedArcs(
      arcs,
      filter,
      {
        references: [arcs, shapes],
        values: [
          style.dashType === 'arrow-dot' ? 'shape-arrows' : 'shape-paths',
          forward ? 'forward' : 'signed',
          arcs.size(),
          shapes.length,
          arcs.getRetainedInterval?.() ?? 0,
          revision,
        ],
        selections: [ids],
      },
      () => {
        const ordered = arcIdsFromShapes(shapes, ids);
        // Default outlines historically discard arc direction; bucketed drawPaths
        // preserves it. Keep that distinction so dash phases do not change.
        if (forward) for (let i = 0; i < ordered.length; i++) ordered[i] = absArcId(ordered[i]);
        const prepared = this.arcJob(arcs, style, filter, ordered, undefined, screen);
        prepared.key = { ...prepared.key, values: [...prepared.key.values, revision] };
        return prepared;
      },
      screen,
    );
    this.paintArcs(entry, style);
  }
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (id: number) => boolean,
    arcIds?: Uint32Array | Int32Array,
    arrow?: ArrowDotPathOptions,
  ): void {
    if (!this.active || style.width === 0) return;
    const hasArrow = style.dashType === 'arrow-dot';
    if (
      this.chunked(
        {
          kind: hasArrow ? 'arrow' : 'path',
          arcs,
          filter,
          ...(hasArrow && arrow
            ? { shapes: arrow.shapes, ids: arrow.shapeIndices }
            : { ids: arcIds }),
        },
        this.arcPaint(style),
      )
    )
      return;
    const screen = this.screenPath(this.arcPaint(style));
    const entry = this.preparedArcs(
      arcs,
      filter,
      {
        references: [arcs, hasArrow ? arrow?.shapes : undefined],
        values: [
          hasArrow ? 'arrow' : 'path',
          arcs.size(),
          arcs.getRetainedInterval?.() ?? 0,
          hasArrow ? arrow?.geometryRevision : undefined,
        ],
        selections: [arcIds, arrow?.shapeIndices],
      },
      () => this.arcJob(arcs, style, filter, arcIds, arrow, screen),
      screen,
    );
    this.paintArcs(entry, style);
  }
  private preparedArcs(
    arcs: ArcCollection,
    filter: ((id: number) => boolean) | undefined,
    key: GeometryKey,
    prepare: () => PreparedGeometry,
    screen?: ScreenPathRequest,
  ): CachedGeometry {
    const visibility = arcVisibilityKey(arcs, filter);
    // Only predicates created by Viewport have a trustworthy semantic key.
    // Re-evaluate arbitrary closures, even if their function identity is stable.
    if (filter && !visibility) {
      const prepared = prepare();
      return this.cache.get(prepared.key, prepared.build);
    }
    return this.cache.getPrepared(
      {
        ...key,
        values: [
          ...key.values,
          filter ? 'viewport' : 'unfiltered',
          ...(visibility ?? []),
          screen ? 'screen' : 'source',
          ...(screen?.view ?? []),
          screen?.pixelRatio,
        ],
      },
      prepare,
    );
  }
  private arcJob(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (id: number) => boolean,
    arcIds?: Uint32Array | Int32Array,
    arrow?: ArrowDotPathOptions,
    screen?: ScreenPathRequest,
  ): PreparedGeometry {
    const hasArrow = style.dashType === 'arrow-dot';
    const storage = new Int32Array(arcIds?.length ?? arcs.size());
    let count = 0;
    for (let i = 0; i < storage.length; i++) {
      const id = (arcIds?.[i] ?? i) | 0;
      if (!filter || filter(absArcId(id))) storage[count++] = id;
    }
    const ordered = count === storage.length ? storage : storage.subarray(0, count);
    const paths = function* (): Generator<readonly Point[]> {
      if (hasArrow && arrow) {
        for (let k = 0, count = arrow.shapeIndices?.length ?? arrow.shapes.length; k < count; k++)
          for (const part of arrow.shapes[arrow.shapeIndices?.[k] ?? k] ?? [])
            yield readPart(arcs, part);
      } else for (const id of ordered) yield readPart(arcs, [id]);
    };
    return {
      key: {
        references: [arcs, hasArrow ? arrow?.shapes : undefined],
        values: [
          hasArrow ? 'arrow' : 'path',
          arcs.getRetainedInterval?.() ?? 0,
          hasArrow ? arrow?.geometryRevision : undefined,
          screen ? 'screen' : 'source',
          ...(screen?.view ?? []),
          screen?.pixelRatio,
        ],
        selections: [ordered, arrow?.shapeIndices],
      },
      build: () => {
        if (hasArrow) return lineGeometry(paths());
        if (!screen) return pathGeometry(paths());
        const list = Array.from(paths());
        const coordinates = new Float64Array(list.reduce((n, p) => n + p.length * 2, 0));
        const offsets = new Uint32Array(list.length + 1);
        let cursor = 0;
        for (let i = 0; i < list.length; i++) {
          offsets[i] = cursor / 2;
          for (const point of list[i]) {
            coordinates[cursor++] = point[0];
            coordinates[cursor++] = point[1];
          }
        }
        offsets[list.length] = cursor / 2;
        const filtered = flatScreenPathGeometry(coordinates, offsets, screen);
        return filtered.screenSpace
          ? { ...filtered.geometry, screenView: screen.view }
          : filtered.geometry;
      },
    };
  }
  private paintArcs(entry: CachedGeometry, style: StrokeStyle): void {
    this.draw(entry, this.arcPaint(style));
  }
  private arcPaint(style: StrokeStyle): MeshPaint {
    return {
      color: this.colors.resolve(style.color, 'foreground'),
      width: style.width ?? 1,
      dash: style.dash,
      ...(style.dashType === 'arrow-dot'
        ? { arrow: { spacing: style.arrowSpacing ?? 32, size: style.arrowSize ?? 6 } }
        : {}),
    };
  }
  private forgetPolygons(scope: { sourceId?: string; layerId?: string } = {}): void {
    for (const [key, polygon] of this.polygons) {
      if (
        scope.layerId !== undefined
          ? polygon.layerId !== scope.layerId
          : scope.sourceId !== undefined && polygon.sourceId !== scope.sourceId
      )
        continue;
      polygon.presentation.dispose();
      this.polygons.delete(key);
    }
  }
  drawPolygon(shapes: Shapes, arcs: ArcCollection, options: PolygonDrawOptions): void {
    if (!this.active) return;
    const paired =
      !!options.fill && (options.fill.opacity ?? 1) > 0 && (options.stroke?.width ?? 0) > 0;
    const start = this.commands.length;
    const previousScope = this.polygonScope;
    const scope = paired ? { channels: [] as PolygonChannel[], order: 0 } : null;
    this.polygonScope = scope;
    try {
      if (options.fill)
        this.drawPolygonFill(
          shapes,
          arcs,
          options.fill.color,
          options.fillFilter,
          options.fill.opacity,
          options,
        );
      const style = options.stroke;
      if (style && (style.width ?? 0) > 0) {
        if (scope) scope.order = Number.MAX_SAFE_INTEGER;
        if (style.dashType === 'arrow-dot') {
          this.drawArcs(arcs, style, options.strokeFilter, undefined, {
            shapes: shapes as readonly (PathShape | null | undefined)[],
            shapeIndices: options.shapeIndices,
            cacheKey: JSON.stringify([this.context?.sourceId, this.context?.id]),
            geometryRevision: options.geometryRevision ?? 0,
          });
        } else
          this.drawOutlinePaths(
            shapes,
            style,
            arcs,
            options.strokeFilter,
            options.shapeIndices,
            options.geometryRevision,
          );
      }
    } finally {
      this.polygonScope = previousScope;
    }
    if (!scope?.channels.length) return;
    const commands = this.commands.splice(start);
    if (scope.channels.length !== commands.length || !this.context) {
      // A custom non-cacheable filter can mix immediate and chunked primitives.
      // Keep that uncommon combination atomic without changing its geometry.
      this.commands.push(() => {
        if (scope.channels.every((channel) => this.chunks.complete(channel.request)))
          for (const command of commands) command();
      });
      return;
    }
    const owner = this.context;
    const family = JSON.stringify([owner.sourceId, owner.id, this.chunks.identity(shapes)]);
    const slot = this.polygonSlots.get(family) ?? 0;
    this.polygonSlots.set(family, slot + 1);
    const key = family + ':' + slot;
    const signature = JSON.stringify([
      owner.revision,
      owner.content,
      this.chunks.identity(owner.bounds ?? arcs),
      arcs.size(),
      options.fill,
      options.styleBuckets?.colors,
      options.stroke?.color,
      options.stroke?.dashType,
      options.stroke?.arrowSpacing,
      options.stroke?.arrowSize,
    ]);
    let polygon = this.polygons.get(key);
    if (polygon?.signature !== signature) {
      polygon?.presentation.dispose();
      polygon = {
        signature,
        sourceId: owner.sourceId,
        layerId: owner.id,
        presentation: new PolygonPresentation(shapes, {
          ready: (entry) =>
            this.chunks.isResident(entry) &&
            (!entry.meshes.some((mesh) => mesh.compactStroke) ||
              compactStrokeCompatible(this.transform, entry.screenView)),
          complete: (request) => this.chunks.complete(request),
          invalidate: () => this.options.invalidate('geometry'),
          report: this.options.report,
        }),
      };
      this.polygons.set(key, polygon);
    }
    this.polygonKeys.add(key);
    this.polygonFrames.push(polygon.presentation);
    polygon.presentation.update(scope.channels);
    this.commands.push(() => polygon!.presentation.draw());
  }
  drawPolygonFill(
    shapes: Shapes,
    arcs: ArcCollection,
    color: string,
    _filter?: (id: number) => boolean,
    opacity = 1,
    options: PolygonFillOptions = {},
  ): void {
    if (!this.active || opacity <= 0) return;
    const paintBucket = (ids: Uint32Array | undefined, fill: string, order = 0) => {
      if (this.polygonScope) this.polygonScope.order = order;
      if (ids?.length === 0) return;
      const chunkColor = [...this.colors.resolve(fill, 'muted')] as MeshPaint['color'];
      chunkColor[3] *= Math.max(0, Math.min(1, opacity));
      if (this.chunked({ kind: 'fill', shapes, arcs, ids }, { color: chunkColor })) return;
      // Culling removes whole features only. Always retain all their rings so offscreen
      // shells/holes enclosing the viewport cannot disappear during a deep zoom.
      const features = function* (): Generator<readonly (readonly Point[])[]> {
        for (let k = 0, n = ids?.length ?? shapes.length; k < n; k++) {
          const shape = shapes[ids?.[k] ?? k] as PathShape | null | undefined;
          if (shape) yield shape.map((part) => readPart(arcs, part));
        }
      };
      const entry = this.cache.get(
        {
          references: [shapes, arcs],
          values: ['fill', arcs.getRetainedInterval?.() ?? 0],
          selections: [ids],
        },
        () => polygonGeometry(features()),
      );
      const rgba = [...this.colors.resolve(fill, 'muted')] as MeshPaint['color'];
      rgba[3] *= Math.max(0, Math.min(1, opacity));
      this.draw(entry, { color: rgba });
    };
    if (options.styleBuckets)
      options.styleBuckets.buckets.forEach((ids, i) =>
        paintBucket(ids, options.styleBuckets!.colors[i], i),
      );
    else paintBucket(options.shapeIndices, color);
  }
  drawRasterImage(
    image: CanvasImageSource,
    bounds: Rect,
    opacity = 1,
    smoothing = true,
    clip?: Rect,
    immutable = false,
  ): void {
    if (!this.active) return;
    this.images.add(image);
    this.commands.push(() =>
      this.gpu.drawImage(image, bounds, opacity, smoothing, clip, immutable),
    );
  }
  drawRasterPixels(
    pixels: ImageData,
    bounds: Rect,
    opacity = 1,
    smoothing = true,
    clip?: Rect,
    immutable = false,
  ): void {
    if (!this.active) return;
    this.images.add(pixels);
    this.commands.push(() =>
      this.gpu.drawImage(pixels, bounds, opacity, smoothing, clip, immutable),
    );
  }
  drawLabels(frame: LabelFrame): void {
    if (this.active) this.commands.push(() => this.gpu.drawLabels(this.navigationLabels ?? frame));
  }
  /** Compatibility for custom render passes drawing editor decorations on the main
   * painter. Normal edit handlers use the map's independent Canvas2D overlay instead. */
  private decorate(draw: (painter: CanvasPainter) => void): void {
    if (!this.active) return;
    this.commands.push(() => this.decorateNow(draw));
  }
  private decorateNow(draw: (painter: CanvasPainter) => void): void {
    if (!this.decoration) {
      const canvas = this.canvas.ownerDocument.createElement('canvas');
      this.decoration = { canvas, painter: new CanvasPainter(canvas) };
    }
    const { canvas, painter } = this.decoration;
    painter.setPixelRatio(this.pixelRatio);
    painter.resize(this.width, this.height);
    painter.setTransform(this.transform);
    painter.clear();
    draw(painter);
    const a = this.transform.unproject(0, this.height),
      b = this.transform.unproject(this.width, 0);
    this.images.add(canvas);
    this.gpu.drawImage(canvas, [a[0], a[1], b[0], b[1]], 1, false);
  }
  drawVertexDots(shapes: Shapes, arcs: ArcCollection, style: VertexDotStyle): void {
    this.decorate((p) => p.drawVertexDots(shapes, arcs, style));
  }
  drawVertexBand(band: { x0: number; y0: number; x1: number; y1: number }): void {
    this.decorate((p) => p.drawVertexBand(band));
  }
  drawDrawingOverlay(state: DrawOverlayState): void {
    this.decorate((p) => p.drawDrawingOverlay(state));
  }
  drawMeasurementOverlay(state: MeasurementOverlayState): void {
    this.decorate((p) => p.drawMeasurementOverlay(state));
  }
  get closed(): Promise<void> {
    return this.chunks.closed;
  }
  dispose(): void {
    if (this.disposed) {
      this.chunks.dispose();
      return;
    }
    // Teardown must not render or depend on a successful final GPU submission.
    this.disposed = true;
    this.resetNavigationTiming();
    this.active = false;
    this.commands = this.paintedCommands = [];
    this.requests = [];
    this.strokeScopes.clear();
    this.polygonScope = null;
    this.forgetPolygons();
    this.polygonFrames = [];
    this.polygonKeys.clear();
    this.polygonSlots.clear();
    this.context = null;
    this.drawnEntries.clear();
    this.paintedContent = null;
    const errors: unknown[] = [];
    for (const cleanup of [
      () => this.chunks.dispose(),
      () => this.cache.clear(),
      () => this.colors.dispose(),
      () => this.gpu.dispose(),
      () => this.decoration?.painter.clearIcons(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.decoration) {
      this.decoration.canvas.width = this.decoration.canvas.height = 0;
      this.decoration = null;
    }
    this.images.clear();
    this.lastImages.clear();
    if (errors.length) throw new AggregateError(errors, 'Luma painter cleanup failed');
  }
}
