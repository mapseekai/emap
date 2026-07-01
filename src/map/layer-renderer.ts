import type { Viewport } from '../geo/viewport';
import type { CorePainter } from '../renderer/painter';
import type { TopologySource } from '../source/source';
import type { ArcCollection, MapshaperLayer, StrokeStyle } from '../types/mapshaper-types';
import { resolvePointStyle, resolveStrokeStyle } from './layer';
import type { CirclePaint, FillPaint, LayerSpecification, LinePaint } from './layer';

export interface LayerRendererContext {
  layers: readonly LayerSpecification[];
  sources: ReadonlyMap<string, TopologySource>;
  viewport: Viewport;
  painter: CorePainter;
  resolveSourceLayer(source: TopologySource, sourceLayerName?: string): MapshaperLayer | null;
  getLayerArcFlags(ml: MapshaperLayer, arcs: ArcCollection, cacheKey: string): Uint8Array | null;
  // Branch (WebGL fast path) hooks. The viewport-clipped arc-flag cache and the
  // zoom-LOD retained-interval quantization live on `Emap` because they depend on
  // per-map cache state; the renderer reaches them through these callbacks.
  getFastArcFlags(
    arcs: ArcCollection,
    layerFlags: Uint8Array | null,
    cacheKey: string,
    revision?: number,
  ): Uint8Array | null;
  getRenderRetainedInterval(pixelSize: number, userFloor: number): number;
}

// WebGL painters expose extra draw entry points that clip on the GPU. The core
// `CorePainter` interface doesn't declare them, so detect them structurally.
type FastPainter = CorePainter & {
  prefersGpuClipping: () => boolean;
  drawArcFlags: (arcs: ArcCollection, style: StrokeStyle, flags?: Uint8Array | null) => void;
  drawPolygonFillArcFlags?: (
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    flags: Uint8Array | null | undefined,
    opacity?: number,
    viewportBBox?: number[] | null,
  ) => void;
  drawArcChunks?: (
    arcs: ArcCollection,
    style: StrokeStyle,
    flags: Uint8Array | null | undefined,
    viewportBBox: number[] | null,
  ) => void;
};

function webglFastPainter(painter: CorePainter): FastPainter | null {
  const candidate = painter as Partial<FastPainter>;
  if (typeof candidate.drawArcFlags === 'function' && candidate.prefersGpuClipping?.()) {
    return painter as FastPainter;
  }
  return null;
}

function setPainterArcRevision(painter: CorePainter, arcs: ArcCollection | null, revision: number): void {
  if (!arcs) return;
  (painter as CorePainter & {
    setArcRenderRevision?: (arcs: ArcCollection, revision: number) => void;
  }).setArcRenderRevision?.(arcs, revision);
}

function setPainterPointRevision(
  painter: CorePainter,
  shapes: any[] | null | undefined,
  revision: number,
): void {
  if (!shapes) return;
  (painter as CorePainter & {
    setPointRenderRevision?: (shapes: any[], revision: number) => void;
  }).setPointRenderRevision?.(shapes, revision);
}

export function renderLayers(
  ctx: LayerRendererContext,
  pixelSize: number,
  lineScale: number,
): void {
  for (const layer of ctx.layers) {
    if (layer.layout?.visibility === 'none') continue;

    const source = ctx.sources.get(layer.source);
    if (!source) continue;

    const displayArcs = source.getDisplayArcs();
    const arcs = displayArcs ? displayArcs.getScaledArcs(pixelSize) : source.getArcs();
    const renderRevision = source.getRenderRevision();
    setPainterArcRevision(ctx.painter, arcs ?? null, renderRevision);

    if (arcs?.setRetainedInterval && (typeof arcs.isFlat !== 'function' || !arcs.isFlat())) {
      const userFloor = source.getSimplifyFloor?.() ?? 0;
      arcs.setRetainedInterval(ctx.getRenderRetainedInterval(pixelSize, userFloor));
    }

    const ml = ctx.resolveSourceLayer(source, layer['source-layer']);
    const cacheKey = `${layer.source}:${layer['source-layer'] || 'default'}`;

    if (layer.type === 'line' && arcs) {
      renderLineLayer(ctx, layer, ml, arcs, cacheKey, lineScale, renderRevision);
    } else if (layer.type === 'fill' && arcs && ml?.shapes) {
      renderFillLayer(ctx, layer, ml, arcs, cacheKey, lineScale, renderRevision);
    } else if (layer.type === 'circle' && ml?.shapes) {
      const style = resolvePointStyle(layer.paint as CirclePaint);
      setPainterPointRevision(ctx.painter, ml.shapes, renderRevision);
      ctx.painter.drawPoints(ml.shapes, style);
    }
  }
}

export function renderLineLayer(
  ctx: LayerRendererContext,
  layer: LayerSpecification,
  ml: MapshaperLayer | null,
  arcs: ArcCollection,
  cacheKey: string,
  lineScale: number,
  renderRevision = 0,
): void {
  const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
  const fastPainter = webglFastPainter(ctx.painter);
  if (ml?.shapes) {
    // Optimized layer line rendering: use drawArcs with a boolean arc
    // presence filter so each shared topology arc strokes exactly once.
    const flags = ctx.getLayerArcFlags(ml, arcs, cacheKey);
    if (fastPainter) {
      if (fastPainter.drawArcChunks) {
        fastPainter.drawArcChunks(arcs, style, flags, ctx.viewport.getViewBounds());
      } else {
        fastPainter.drawArcFlags(arcs, style, ctx.getFastArcFlags(arcs, flags, cacheKey, renderRevision));
      }
      return;
    }
    const filter = combineArcFilters(flags, ctx.viewport.getArcFilter(arcs));
    ctx.painter.drawArcs(arcs, style, filter);
  } else {
    if (fastPainter) {
      if (fastPainter.drawArcChunks) {
        fastPainter.drawArcChunks(arcs, style, null, ctx.viewport.getViewBounds());
      } else {
        fastPainter.drawArcFlags(
          arcs,
          style,
          ctx.getFastArcFlags(arcs, null, `${cacheKey}:all`, renderRevision),
        );
      }
      return;
    }
    ctx.painter.drawArcs(arcs, style, ctx.viewport.getArcFilter(arcs));
  }
}

export function renderFillLayer(
  ctx: LayerRendererContext,
  layer: LayerSpecification,
  ml: MapshaperLayer,
  arcs: ArcCollection,
  cacheKey: string,
  lineScale: number,
  renderRevision = 0,
): void {
  const fillPaint = layer.paint as FillPaint | undefined;
  const fillColor = fillPaint?.['fill-color'] || 'rgba(200, 200, 200, 0.4)';
  const fillOpacity = fillPaint?.['fill-opacity'];
  const fastPainter = webglFastPainter(ctx.painter);

  if (fastPainter?.drawPolygonFillArcFlags) {
    // WebGL fast path: tessellate + stroke on the GPU with viewport-clipped
    // arc flags. Outline strokes each topology arc once via the layer flags.
    const layerFlags = ctx.getLayerArcFlags(ml, arcs, cacheKey);
    const fillFlags = ctx.getFastArcFlags(arcs, layerFlags, `${cacheKey}:fill`, renderRevision);
    fastPainter.drawPolygonFillArcFlags(
      ml.shapes!,
      arcs,
      fillColor,
      fillFlags,
      fillOpacity,
      ctx.viewport.getViewBounds(),
    );
    const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
    if (style.width === 0) return;
    if (fastPainter.drawArcChunks) {
      fastPainter.drawArcChunks(arcs, style, layerFlags, ctx.viewport.getViewBounds());
    } else {
      fastPainter.drawArcFlags(arcs, style, ctx.getFastArcFlags(arcs, layerFlags, cacheKey, renderRevision));
    }
    return;
  }

  // Canvas path. Near full extent every part is visible anyway, so per-part
  // bbox culling is pure overhead — and it dominates the frame once LOD arcs
  // make the actual drawing cheap. Mapshaper's getShapeFilter applies the same
  // skip-below-1.1 rule.
  const viewportFilter = ctx.viewport.getArcFilter(arcs);
  const cullParts = ctx.viewport.getMapScale() > 1.1;
  ctx.painter.drawPolygonFill(
    ml.shapes!,
    arcs,
    fillColor,
    cullParts ? viewportFilter : undefined,
    fillOpacity,
    { viewBBox: cullParts ? ctx.viewport.getViewBounds() : null },
  );
  // Outline: stroke each topology arc exactly once via the same flag cache
  // the line layer uses. drawPaths(shapes,...) would re-walk every shape
  // and double-stroke shared boundaries — on big polygon datasets that's
  // the dominant cost of fill mode.
  const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
  if (style.width === 0) return;
  const flags = ctx.getLayerArcFlags(ml, arcs, cacheKey);
  ctx.painter.drawArcs(arcs, style, combineArcFilters(flags, viewportFilter));
}

function combineArcFilters(
  layerFilter: Uint8Array | null,
  viewportFilter?: (i: number) => boolean,
): ((i: number) => boolean) | undefined {
  if (!layerFilter) return viewportFilter;
  if (!viewportFilter) return (i: number) => layerFilter[i] === 1;
  return (i: number) => layerFilter[i] === 1 && viewportFilter(i);
}
