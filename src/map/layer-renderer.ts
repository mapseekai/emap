import type { Viewport } from '../geo/viewport';
import type { CorePainter } from '../renderer/painter';
import type { TopologySource } from '../source/source';
import type { ArcCollection, MapshaperLayer } from '../types/mapshaper-types';
import { resolvePointStyle, resolveStrokeStyle } from './layer';
import type { CirclePaint, FillPaint, LayerSpecification, LinePaint } from './layer';

export interface LayerRendererContext {
  layers: readonly LayerSpecification[];
  sources: ReadonlyMap<string, TopologySource>;
  viewport: Viewport;
  painter: CorePainter;
  resolveSourceLayer(source: TopologySource, sourceLayerName?: string): MapshaperLayer | null;
  getLayerArcFlags(ml: MapshaperLayer, arcs: ArcCollection, cacheKey: string): Uint8Array | null;
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

    if (arcs?.setRetainedInterval && (typeof arcs.isFlat !== 'function' || !arcs.isFlat())) {
      const userFloor = source.getSimplifyFloor?.() ?? 0;
      arcs.setRetainedInterval(Math.max(userFloor, pixelSize * 0.5));
    }

    const ml = ctx.resolveSourceLayer(source, layer['source-layer']);
    const cacheKey = `${layer.source}:${layer['source-layer'] || 'default'}`;

    if (layer.type === 'line' && arcs) {
      renderLineLayer(ctx, layer, ml, arcs, cacheKey, lineScale);
    } else if (layer.type === 'fill' && arcs && ml?.shapes) {
      renderFillLayer(ctx, layer, ml, arcs, cacheKey, lineScale);
    } else if (layer.type === 'circle' && ml?.shapes) {
      const style = resolvePointStyle(layer.paint as CirclePaint);
      ctx.painter.drawPoints(ml.shapes, style);
    }
  }
}

function renderLineLayer(
  ctx: LayerRendererContext,
  layer: LayerSpecification,
  ml: MapshaperLayer | null,
  arcs: ArcCollection,
  cacheKey: string,
  lineScale: number,
): void {
  const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
  if (ml?.shapes) {
    const flags = ctx.getLayerArcFlags(ml, arcs, cacheKey);
    const filter = combineArcFilters(flags, ctx.viewport.getArcFilter(arcs));
    ctx.painter.drawArcs(arcs, style, filter);
  } else {
    ctx.painter.drawArcs(arcs, style, ctx.viewport.getArcFilter(arcs));
  }
}

function renderFillLayer(
  ctx: LayerRendererContext,
  layer: LayerSpecification,
  ml: MapshaperLayer,
  arcs: ArcCollection,
  cacheKey: string,
  lineScale: number,
): void {
  const fillPaint = layer.paint as FillPaint | undefined;
  const fillColor = fillPaint?.['fill-color'] || 'rgba(200, 200, 200, 0.4)';
  const fillOpacity = fillPaint?.['fill-opacity'];
  const viewportFilter = ctx.viewport.getArcFilter(arcs);
  // Near full extent every part is visible anyway, so per-part bbox culling
  // is pure overhead — and it dominates the frame once LOD arcs make the
  // actual drawing cheap. Mapshaper's getShapeFilter applies the same
  // skip-below-1.1 rule.
  const cullParts = ctx.viewport.getMapScale() > 1.1;
  ctx.painter.drawPolygonFill(
    ml.shapes!,
    arcs,
    fillColor,
    cullParts ? viewportFilter : undefined,
    fillOpacity,
    { viewBBox: cullParts ? ctx.viewport.getViewBounds() : null },
  );
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
