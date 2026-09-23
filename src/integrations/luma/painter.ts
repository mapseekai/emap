import { GpuRenderer } from './gpu-renderer';
import { GpuColors } from './colors';
import { PainterGeometryCache, type CachedGeometry } from './painter-cache';
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
import { CanvasPainter } from '../../engine/rendering/canvas-painter';
import type {
  EditPainter,
  ArrowDotPathOptions,
  PolygonFillOptions,
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
  invalidate: () => void;
  report: (error: Error) => void;
  signal?: AbortSignal;
  msdfWorkerUrl?: string | URL;
}
/** Main map geometry is drawn directly by luma. The existing map owns selection,
 * filter/style resolution, source order and editing; this adapter owns GPU resources only.
 */
export class LumaPainter implements EditPainter {
  private transform = new AffineTransform();
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private active = false;
  private disposed = false;
  private colors: GpuColors;
  private cache: PainterGeometryCache;
  private decoration: { canvas: HTMLCanvasElement; painter: CanvasPainter } | null = null;
  private images = new Set<CanvasImageSource>();
  private lastImages = new Set<CanvasImageSource>();
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly backend: Exclude<RendererBackend, 'canvas2d'>,
    readonly gpu: GpuRenderer,
    private readonly options: Options,
  ) {
    this.colors = new GpuColors(canvas);
    this.cache = new PainterGeometryCache(gpu);
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
    return { ...this.gpu.stats, geometryCache: this.cache.stats, text: this.gpu.textStats };
  }
  createLabelAtlas(): MsdfLabelAtlas {
    const url = this.options.msdfWorkerUrl;
    return new MsdfLabelAtlas(
      url
        ? new URL(String(url), this.canvas.ownerDocument.baseURI)
        : new URL('emap-msdf-worker.js', import.meta.url),
      this.canvas.ownerDocument,
    );
  }
  clearLabels(): void {
    this.gpu.clearLabels();
  }
  setLayerContext(context: { id: string; sourceId: string; revision: number } | null): void {
    this.cache.contextFor(context);
  }
  clearGeometryCache(scope: { sourceId?: string; layerId?: string } = {}): void {
    this.cache.clear(scope);
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
    this.colors.reset();
    this.cache.begin();
    this.images.clear();
    // DPR can change without a resize notification.
    this.gpu.resize(this.width, this.height, this.pixelRatio);
    this.active = this.gpu.begin(this.transform);
  }
  finishFrame(): void {
    if (!this.active) return;
    try {
      this.gpu.end();
    } finally {
      this.active = false;
      this.cache.finish();
      for (const image of this.lastImages) if (!this.images.has(image)) this.gpu.forgetImage(image);
      this.lastImages = new Set(this.images);
    }
  }
  private draw(entry: CachedGeometry, paint: MeshPaint): void {
    if (!entry.mesh) return;
    const selection = entry.ranges?.select(
      this.transform,
      this.width,
      this.height,
      Math.max(8, (paint.width ?? 1) * 4 + 2),
    );
    this.gpu.drawMesh(entry.mesh, paint, selection?.ranges);
  }
  drawPoints(shapes: Shapes, style: PointStyle, ids?: Uint32Array, components?: Uint32Array): void {
    if (!this.active || style.radius === 0) return;
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
    const entry = this.cache.get(
      { references: [shapes], values: ['point'], selections: [ids, components] },
      () => pointsFromShapes(shapes, ids, components),
    );
    this.images.add(icon.asset.image);
    if (entry.mesh) this.gpu.drawPointIcons(entry.mesh, icon);
  }
  clearIcons(): void {
    /* Images are shared and released by their owner through forgetImage. */
  }
  forgetImage(image: CanvasImageSource): void {
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
    _revision?: number,
  ): void {
    if (!this.active || style.width === 0) return;
    const ordered = arcIdsFromShapes(shapes, ids);
    this.drawArcs(arcs, style, filter, ordered);
  }
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (id: number) => boolean,
    arcIds?: Uint32Array | Int32Array,
    arrow?: ArrowDotPathOptions,
  ): void {
    if (!this.active || style.width === 0) return;
    const ids = Int32Array.from(arcIds ?? { length: arcs.size() }, (v, i) =>
      arcIds ? v : i,
    ).filter((id) => !filter || filter(absArcId(id)));
    const hasArrow = style.dashType === 'arrow-dot';
    const paths = function* (): Generator<readonly Point[]> {
      if (hasArrow && arrow) {
        for (const id of arrow.shapeIndices ??
          Uint32Array.from({ length: arrow.shapes.length }, (_, i) => i))
          for (const part of arrow.shapes[id] ?? []) yield readPart(arcs, part);
      } else for (const id of ids) yield readPart(arcs, [id]);
    };
    const entry = this.cache.get(
      {
        references: [arcs, hasArrow ? arrow?.shapes : undefined],
        values: [
          hasArrow ? 'arrow' : 'path',
          arcs.getRetainedInterval?.() ?? 0,
          hasArrow ? arrow?.geometryRevision : undefined,
        ],
        selections: [ids, arrow?.shapeIndices],
      },
      () => (hasArrow ? lineGeometry(paths()) : pathGeometry(paths())),
    );
    this.draw(entry, {
      color: this.colors.resolve(style.color, 'foreground'),
      width: style.width ?? 1,
      dash: style.dash,
      ...(hasArrow
        ? { arrow: { spacing: style.arrowSpacing ?? 32, size: style.arrowSize ?? 6 } }
        : {}),
    });
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
    const paintBucket = (ids: Uint32Array | undefined, fill: string) => {
      if (ids?.length === 0) return;
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
        paintBucket(ids, options.styleBuckets!.colors[i]),
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
    this.gpu.drawImage(image, bounds, opacity, smoothing, clip, immutable);
  }
  drawLabels(frame: LabelFrame): void {
    if (this.active) this.gpu.drawLabels(frame);
  }
  /** Compatibility for custom render passes drawing editor decorations on the main
   * painter. Normal edit handlers use the map's independent Canvas2D overlay instead. */
  private decorate(draw: (painter: CanvasPainter) => void): void {
    if (!this.active) return;
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
    this.drawRasterImage(canvas, [a[0], a[1], b[0], b[1]], 1, false);
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
  dispose(): void {
    if (this.disposed) return;
    this.finishFrame();
    this.disposed = true;
    this.cache.clear();
    this.colors.dispose();
    this.gpu.dispose();
    if (this.decoration) {
      this.decoration.painter.clearIcons();
      this.decoration.canvas.width = this.decoration.canvas.height = 0;
      this.decoration = null;
    }
    this.images.clear();
    this.lastImages.clear();
  }
}
