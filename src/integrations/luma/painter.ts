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
import { cameraUniforms, groundBounds } from '../../domain/geo/perspective-transform';
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
type DrawCommand =
  | { kind: 'mesh'; draws: MeshDraw[]; paint: MeshPaint; sequence?: boolean }
  | { kind: 'icon'; mesh: MeshDraw['mesh']; icon: PointIcon }
  | {
      kind: 'image';
      image: CanvasImageSource | ImageData;
      bounds: Rect;
      opacity: number;
      smoothing: boolean;
      clip?: Rect;
      immutable: boolean;
    }
  | { kind: 'forced'; draw: () => void };

function copyPaint(paint: MeshPaint): MeshPaint {
  return {
    ...paint,
    color: [...paint.color],
    marker: paint.marker?.slice(),
    dash: paint.dash?.slice(),
    screenView: paint.screenView && [...paint.screenView],
    arrow: paint.arrow && { ...paint.arrow },
  };
}
function copyIcon(icon: PointIcon): PointIcon {
  return {
    ...icon,
    asset: { ...icon.asset },
    color: [...icon.color],
    rect: [...icon.rect],
    size: [...icon.size],
    anchor: [...icon.anchor],
    offset: [...icon.offset],
    bounds: [...icon.bounds],
  };
}
function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}
/** Only draw state and resource identities: never source geometry or fresh selection closures. */
function commandState(command: DrawCommand): unknown[] | null {
  const numbers = (values?: readonly number[]) => [values?.length, ...(values ?? [])];
  const mesh = (value: MeshDraw['mesh']) => [
    value,
    value.buffer,
    value.indices,
    value.kind,
    value.count,
    value.indexBytes,
    value.firstIndex,
    value.firstInstance,
    value.logicalCount,
    value.compactStroke,
    value.compactStrokeXY,
    value.solidPath,
    value.pageSlice?.page,
    value.pageSlice?.released,
  ];
  switch (command.kind) {
    case 'mesh': {
      const p = command.paint;
      return [
        'mesh',
        !!command.sequence,
        ...p.color,
        p.width,
        p.radius,
        p.filled,
        ...numbers(p.marker),
        ...numbers(p.dash),
        p.arrow?.spacing,
        p.arrow?.size,
        p.screenSpace,
        ...numbers(p.screenView),
        command.draws.length,
        ...command.draws.flatMap((d) => [
          ...mesh(d.mesh),
          d.ranges?.length,
          ...(d.ranges?.flatMap((r) => [r.firstInstance, r.count]) ?? []),
          d.indexRanges?.length,
          ...(d.indexRanges?.flatMap((r) => [r.firstIndex, r.indexCount]) ?? []),
        ]),
      ];
    }
    case 'icon': {
      const i = command.icon;
      return [
        'icon',
        ...mesh(command.mesh),
        i.asset.image,
        i.asset.width,
        i.asset.height,
        ...i.color,
        ...i.rect,
        ...i.size,
        ...i.anchor,
        ...i.offset,
        i.angle,
        !!i.tint,
      ];
    }
    case 'image':
      return command.immutable
        ? [
            'image',
            command.image,
            ...command.bounds,
            command.opacity,
            command.smoothing,
            ...numbers(command.clip),
          ]
        : null;
    case 'forced':
      return null;
  }
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
  private screenPathFiltering = false;
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
  private preparations: (() => void)[] = [];
  private passErrors: { report: (error: unknown) => void; next: number; failedAt: number } | null =
    null;
  private requestGuards = new Map<GeometryRequest, (() => boolean)[]>();
  private imageGuards = new Map<CanvasImageSource | ImageData, (() => boolean)[]>();
  private selected: DrawCommand[] = [];
  private lastPresentation: { camera: number[]; commands: unknown[][] } | null = null;
  private paintedCommands: (() => void)[] = [];
  private drawnEntries = new Set<GeometryEntry>();
  private hasLabels = false;
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
  private polygonFrames: { presentation: PolygonPresentation; valid: () => boolean }[] = [];
  private strokeScopes = new Map<
    string,
    { channels: (PolygonChannel & { valid: () => boolean })[]; presentation: PolygonPresentation }
  >();
  private context:
    | (GeometryOwner & { bounds?: Rect; content?: string; geometryLod?: boolean })
    | null = null;
  /** Presence marker; owner.content in the chunk cache owns content invalidation. */
  private paintedContent: true | null = null;
  private paintedDimensions = '';
  private bitmapRetained = false;
  private paintedComplete = false;
  private paintedVisible = false;
  frameComplete = true;
  frameRetained = false;
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly backend: Exclude<RendererBackend, 'canvas2d'>,
    readonly gpu: GpuRenderer,
    private readonly options: Options,
  ) {
    this.screenPathFiltering = options.screenPathFiltering ?? false;
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
      retainPresentation: () => {
        if (this.disposed || this.paintedContent === null || !this.paintedVisible) return false;
        this.bitmapRetained = true;
        this.paintedCommands = [];
        this.drawnEntries.clear();
        return true;
      },
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
    // Expired/unavailable samples require a fresh settled frame, never a zero-cost GPU claim.
    if (!this.completionSample && now - this.completionSampleAt > 1000) return Infinity;
    return Math.max(this.navigationCpuMs, this.queueBusyMs ?? Infinity);
  }
  /** One outstanding fence, at most every 250 ms during camera-only replay.
   * A changed full presentation starts a new sample generation. */
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
    if (this.hasLabels) this.lastPresentation = null;
    this.hasLabels = false;
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
    this.lastPresentation = null;
    this.forgetPolygons(scope);
    this.cache.clear(scope);
    this.chunks.clear(scope);
    this.paintedContent = null;
    this.bitmapRetained = this.paintedComplete = this.paintedVisible = false;
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
    if (!this.paintedVisible || this.paintedContent === null)
      this.gpu.resize(this.width, this.height, this.pixelRatio);
  }
  clear(): void {
    if (this.disposed) return;
    this.finishFrame();
    this.frameStarted = performance.now();
    this.colors.reset();
    this.cache.begin();
    this.chunks.begin(this.cache.stats.bytes);
    this.images.clear();
    this.commands = [];
    this.preparations = [];
    this.passErrors = null;
    this.requestGuards.clear();
    this.imageGuards.clear();
    this.selected = [];
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
      for (const prepare of this.preparations) prepare();
      this.discardFailedRequests();
      for (const [image, guards] of this.imageGuards)
        if (!guards.some((valid) => valid())) this.images.delete(image);
      for (const scope of this.strokeScopes.values())
        scope.presentation.update(scope.channels.filter((channel) => channel.valid()));
      this.polygonFrames = this.polygonFrames.filter((polygon) => polygon.valid());
      const pending = this.requests.some((request) => !this.chunks.complete(request));
      // Complete warm images stay atomic; pressure may also freeze a visible
      // cold partial image while its old meshes retire. Empty startup stays progressive.
      if (
        pending &&
        this.paintedContent !== null &&
        this.paintedVisible &&
        (this.paintedComplete || this.bitmapRetained)
      ) {
        this.resetNavigationTiming();
        this.bitmapRetained = true;
        this.frameRetained = true;
        return;
      }
      const retained = this.bitmapRetained;
      this.bitmapRetained = false;
      this.drawnEntries.clear();
      this.selected = [];
      // Resolve polygon publications and camera-dependent ranges before opening a GPU pass.
      for (const command of this.commands) command();
      const camera = [
        this.width,
        this.height,
        this.pixelRatio,
        this.transform.mx,
        this.transform.my,
        this.transform.bx,
        this.transform.by,
        ...cameraUniforms(this.transform),
      ];
      const states = this.selected.map(commandState);
      const previous = this.lastPresentation;
      const unchanged =
        !retained &&
        previous &&
        sameValues(previous.camera, camera) &&
        states.length === previous.commands.length &&
        states.every((state, i) => state !== null && sameValues(state, previous.commands[i]));
      if (!unchanged) {
        this.resetNavigationTiming();
        this.lastPresentation = null;
        this.gpu.resize(this.width, this.height, this.pixelRatio);
        if (!this.gpu.begin(this.transform)) {
          this.paintedContent = null;
          this.paintedCommands = [];
          return;
        }
        const drawsBefore = this.gpu.stats.drawCalls;
        try {
          this.submit();
        } finally {
          this.gpu.end();
        }
        this.paintedVisible = this.gpu.stats.drawCalls > drawsBefore;
        if (states.every((state): state is unknown[] => state !== null))
          this.lastPresentation = { camera, commands: states };
      }
      this.chunks.pin(
        this.drawnEntries,
        this.polygonFrames.some((polygon) => polygon.presentation.planning),
      );
      this.frameComplete =
        !pending && this.polygonFrames.every((polygon) => polygon.presentation.complete);
      // An empty loading frame must not become a navigation snapshot that blocks first paint.
      this.framePresented = this.frameComplete || this.paintedVisible;
      this.paintedCommands = this.commands;
      this.paintedContent = true;
      this.paintedComplete = this.frameComplete;
      this.paintedDimensions = dimensions;
      if (!unchanged) {
        this.chunks.didPresent(performance.now() - this.frameStarted);
        this.measureCompletion(this.frameStarted);
        this.presentation.presented++;
        if (!this.frameComplete) this.presentation.partial++;
        else this.presentation.complete++;
      }
    } catch (error) {
      this.lastPresentation = null;
      this.paintedContent = null;
      this.paintedCommands = [];
      this.chunks.pin([]);
      this.frameComplete = this.framePresented = this.frameRetained = false;
      throw error;
    } finally {
      this.active = false;
      this.commands = [];
      this.preparations = [];
      this.selected = [];
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
      this.bitmapRetained ||
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
    this.lastPresentation = null;
    this.transform = view.clone();
    this.navigationLabels = labels;
    this.drawnEntries.clear();
    const drawsBefore = this.gpu.stats.drawCalls;
    try {
      this.selected = [];
      for (const command of this.paintedCommands) command();
      if (!this.gpu.begin(this.transform)) {
        this.paintedContent = null;
        this.paintedCommands = [];
        return false;
      }
      try {
        this.submit();
      } finally {
        this.gpu.end();
      }
      this.paintedVisible = this.gpu.stats.drawCalls > drawsBefore;
      this.chunks.pin(this.drawnEntries);
      this.presentation.replays++;
      this.measureCompletion(start);
      return true;
    } catch (error) {
      this.lastPresentation = null;
      this.paintedContent = null;
      this.paintedCommands = [];
      throw error;
    } finally {
      this.navigationLabels = undefined;
      this.selected = [];
    }
  }
  private submit(): void {
    for (const command of this.selected) {
      switch (command.kind) {
        case 'mesh':
          if (command.sequence && this.gpu.drawMeshSequence)
            this.gpu.drawMeshSequence(command.draws, command.paint);
          else
            for (const draw of command.draws)
              this.gpu.drawMesh(draw.mesh, command.paint, draw.ranges, draw.indexRanges);
          break;
        case 'icon':
          this.gpu.drawPointIcons(command.mesh, command.icon);
          break;
        case 'image':
          this.gpu.drawImage(
            command.image,
            command.bounds,
            command.opacity,
            command.smoothing,
            command.clip,
            command.immutable,
          );
          break;
        case 'forced':
          command.draw();
          break;
      }
    }
  }
  setRenderPassErrorHandler(report: ((error: unknown) => void) | null): void {
    this.passErrors = report ? { report, next: 0, failedAt: Infinity } : null;
  }
  private passGuard(): () => boolean {
    const errors = this.passErrors;
    const order = errors ? errors.next++ : 0;
    return () => !errors || order < errors.failedAt;
  }
  private record(command: () => void, valid = this.passGuard()): void {
    this.commands.push(() => {
      if (valid()) command();
    });
  }
  private retainImage(image: CanvasImageSource | ImageData): void {
    this.images.add(image);
    const guards = this.imageGuards.get(image) ?? [];
    guards.push(this.passGuard());
    this.imageGuards.set(image, guards);
  }
  private discardFailedRequests(): void {
    this.requests = this.requests.filter((request) => {
      if (this.requestGuards.get(request)?.some((valid) => valid()) !== false) return true;
      this.chunks.cancel(request);
      return false;
    });
  }
  private prepare(resolve: () => CachedGeometry): () => CachedGeometry | undefined {
    const owner = this.context && { ...this.context };
    const errors = this.passErrors;
    const order = errors ? errors.next++ : 0;
    let entry: CachedGeometry | undefined;
    this.preparations.push(() => {
      if (errors && order >= errors.failedAt) return;
      this.cache.contextFor(owner);
      try {
        entry = resolve();
      } catch (error) {
        if (!errors) throw error;
        errors.failedAt = order;
        this.discardFailedRequests();
        errors.report(error);
      } finally {
        this.cache.contextFor(this.context);
      }
    });
    // Navigation reads the resolved entry without touching cache slots or allocating.
    return () => entry;
  }
  private prepareAtInterval(
    arcs: ArcCollection,
    interval: number,
    resolve: () => CachedGeometry,
  ): () => CachedGeometry | undefined {
    return this.prepare(() => {
      const previous = arcs.getRetainedInterval?.() ?? 0;
      arcs.setRetainedInterval?.(interval);
      try {
        return resolve();
      } finally {
        arcs.setRetainedInterval?.(previous);
      }
    });
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
    paint = copyPaint(paint);
    if (icon) icon = copyIcon(icon);
    const owner = this.context;
    if (!owner || (input.kind === 'arrow' && !input.shapes)) return false;
    const large =
      input.kind === 'point'
        ? (input.ids?.length ?? input.shapes?.length ?? 0) >= 50_000
        : (input.arcs?.getPointCount?.() ?? 0) >= 100_000;
    if (!large || (input.filter && !arcVisibilityKey(input.arcs!, input.filter))) return false;
    const valid = this.passGuard();
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
          input.kind === 'path' &&
          this.gpu.compactStrokesEnabled !== false &&
          useMsaaPath(paint, this.gpu.pathMode, this.gpu.pathRendering.samples) &&
          (!screen || compactStrokeCompatible(view, screen.view)),
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
    const guards = this.requestGuards.get(request) ?? [];
    guards.push(valid);
    this.requestGuards.set(request, guards);
    if (icon) this.retainImage(icon.asset.image);
    const drawEntries = (
      entries: readonly GeometryEntry[],
      members?: ReadonlyMap<GeometryEntry, ReadonlySet<number> | undefined>,
    ) => {
      if (!valid()) return;
      let batch: MeshDraw[] = [],
        batchPaint: MeshPaint | undefined,
        basis = '';
      let strokeBounds: readonly [number, number, number, number] | undefined;
      const flush = () => {
        if (batch.length && batchPaint) {
          this.selected.push({ kind: 'mesh', draws: batch, paint: batchPaint, sequence: true });
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
            this.selected.push({ kind: 'icon', mesh, icon });
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
        const active = () => scope!.channels.some((channel) => channel.valid());
        this.polygonFrames.push({ presentation: layer.presentation, valid: active });
        this.record(() => layer!.presentation.draw(), active);
      }
      scope.channels.push({
        valid,
        key: JSON.stringify([request.owner.content, request.slot]),
        order: scope.channels.length,
        request,
        draw: (entries) => {
          if (!valid()) return;
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
          if (!valid()) return;
          // Empty (offscreen/degenerate) meshes still participate in readiness.
          for (const entry of entries) this.drawnEntries.add(entry);
          drawEntries(entries, members);
        },
      });
    }
    this.record(() => drawEntries(this.chunks.drawable(request)), valid);
    return true;
  }
  private draw(resolve: () => CachedGeometry | undefined, paint: MeshPaint): void {
    paint = copyPaint(paint);
    this.record(() => {
      const entry = resolve();
      if (!entry?.mesh) return;
      const selection = !entry.screenView
        ? entry.ranges?.select(
            this.transform,
            this.width,
            this.height,
            Math.max(8, (paint.width ?? 1) * 4 + 2),
          )
        : undefined;
      this.selected.push({
        kind: 'mesh',
        draws: [{ mesh: entry.mesh, ranges: selection?.ranges }],
        paint: entry.screenView
          ? { ...paint, screenSpace: true, screenView: entry.screenView }
          : paint,
      });
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
    ids = ids?.slice();
    components = components?.slice();
    const entry = this.prepare(() =>
      this.cache.get(
        { references: [shapes], values: ['point'], selections: [ids, components] },
        () => pointsFromShapes(shapes, ids, components),
      ),
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
    ids = ids?.slice();
    components = components?.slice();
    const entry = this.prepare(() =>
      this.cache.get(
        { references: [shapes], values: ['point'], selections: [ids, components] },
        () => pointsFromShapes(shapes, ids, components),
      ),
    );
    icon = copyIcon(icon);
    this.retainImage(icon.asset.image);
    this.record(() => {
      const mesh = entry()?.mesh;
      if (mesh) this.selected.push({ kind: 'icon', mesh, icon });
    });
  }
  clearIcons(): void {
    /* Images are shared and released by their owner through forgetImage. */
  }
  forgetImage(image: CanvasImageSource | ImageData): void {
    this.lastPresentation = null;
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
    ids = ids?.slice();
    style = { ...style, dash: style.dash?.slice() };
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
    arcIds = arcIds?.slice();
    if (arrow) arrow = { ...arrow, shapeIndices: arrow.shapeIndices?.slice() };
    style = { ...style, dash: style.dash?.slice() };
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
  ): () => CachedGeometry | undefined {
    const interval = arcs.getRetainedInterval?.() ?? 0;
    const visibility = arcVisibilityKey(arcs, filter);
    // Only predicates created by Viewport have a trustworthy semantic key.
    // Re-evaluate arbitrary closures, even if their function identity is stable.
    if (filter && !visibility) {
      const prepared = prepare();
      return this.prepareAtInterval(arcs, interval, () =>
        this.cache.get(prepared.key, prepared.build),
      );
    }
    return this.prepareAtInterval(arcs, interval, () =>
      this.cache.getPrepared(
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
      ),
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
  private paintArcs(entry: () => CachedGeometry | undefined, style: StrokeStyle): void {
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
    const valid = this.passGuard();
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
    const completeCall = this.passGuard();
    if (scope.channels.length !== commands.length || !this.context) {
      // A custom non-cacheable filter can mix immediate and chunked primitives.
      // Keep that uncommon combination atomic without changing its geometry.
      this.record(() => {
        if (
          !completeCall() ||
          scope.channels.every((channel) => this.chunks.complete(channel.request))
        )
          for (const command of commands) command();
      }, valid);
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
          // Publish every face and boundary together, like whole stroke layers.
          atomic: true,
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
    this.polygonFrames.push({ presentation: polygon.presentation, valid: completeCall });
    polygon.presentation.update(scope.channels);
    this.record(() => {
      if (completeCall()) polygon!.presentation.draw();
      else for (const command of commands) command();
    }, valid);
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
      ids = ids?.slice();
      const interval = arcs.getRetainedInterval?.() ?? 0;
      // Culling removes whole features only. Always retain all their rings so offscreen
      // shells/holes enclosing the viewport cannot disappear during a deep zoom.
      const features = function* (): Generator<readonly (readonly Point[])[]> {
        for (let k = 0, n = ids?.length ?? shapes.length; k < n; k++) {
          const shape = shapes[ids?.[k] ?? k] as PathShape | null | undefined;
          if (shape) yield shape.map((part) => readPart(arcs, part));
        }
      };
      const entry = this.prepareAtInterval(arcs, interval, () =>
        this.cache.get(
          {
            references: [shapes, arcs],
            values: ['fill', interval],
            selections: [ids],
          },
          () => polygonGeometry(features()),
        ),
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
    this.retainImage(image);
    const command: DrawCommand = {
      kind: 'image',
      image,
      bounds: [...bounds],
      opacity,
      smoothing,
      clip: clip && [...clip],
      immutable,
    };
    this.record(() => this.selected.push(command));
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
    this.retainImage(pixels);
    const command: DrawCommand = {
      kind: 'image',
      image: pixels,
      bounds: [...bounds],
      opacity,
      smoothing,
      clip: clip && [...clip],
      immutable,
    };
    this.record(() => this.selected.push(command));
  }
  drawLabels(frame: LabelFrame): void {
    if (!this.active) return;
    this.hasLabels = true;
    this.record(() =>
      this.selected.push({
        kind: 'forced',
        draw: () => this.gpu.drawLabels(this.navigationLabels ?? frame),
      }),
    );
  }
  /** Compatibility for custom render passes drawing editor decorations on the main
   * painter. Normal edit handlers use the map's independent Canvas2D overlay instead. */
  private decorate(draw: (painter: CanvasPainter) => void): void {
    if (!this.active) return;
    this.record(() => this.selected.push({ kind: 'forced', draw: () => this.decorateNow(draw) }));
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
    this.preparations = [];
    this.passErrors = null;
    this.requestGuards.clear();
    this.imageGuards.clear();
    this.selected = [];
    this.lastPresentation = null;
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
