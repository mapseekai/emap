import type { Viewport } from '../geo/viewport';
import type { CorePainter } from '../renderer/painter';
import type { MutableTopologySource } from '../source/source';
import type { ArcCollection, MapshaperLayer } from '../types/mapshaper-types';
import { resolvePointStyle, resolveStrokeStyle } from './layer';
import type { FillLayerSpecification, LayerSpecification, LineLayerSpecification } from './layer';

export interface LayerRendererContext {
  layers: readonly LayerSpecification[];
  sources: ReadonlyMap<string, MutableTopologySource>;
  viewport: Viewport;
  painter: CorePainter;
  resolveSourceLayer(sourceId: string, sourceLayerName?: string): MapshaperLayer | null;
  getLayerArcIds(ml: MapshaperLayer, arcs: ArcCollection, cacheKey: string): Uint32Array | null;
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

    const ml = ctx.resolveSourceLayer(layer.source, layer['source-layer']);
    const cacheKey = `${layer.source}:${layer['source-layer'] || 'default'}`;

    if (layer.type === 'line' && arcs) {
      renderLineLayer(ctx, layer, ml, arcs, cacheKey, lineScale);
    } else if (layer.type === 'fill' && arcs && ml?.shapes) {
      renderFillLayer(ctx, layer, ml, arcs, cacheKey, lineScale);
    } else if (layer.type === 'circle' && ml?.shapes) {
      const style = resolvePointStyle(layer.paint);
      ctx.painter.drawPoints(ml.shapes, style);
    }
  }
}

function renderLineLayer(
  ctx: LayerRendererContext,
  layer: LineLayerSpecification,
  ml: MapshaperLayer | null,
  arcs: ArcCollection,
  cacheKey: string,
  lineScale: number,
): void {
  const style = resolveStrokeStyle(layer.paint, lineScale);
  if (ml?.shapes) {
    const arcIds = ctx.getLayerArcIds(ml, arcs, cacheKey);
    ctx.painter.drawArcs(arcs, style, ctx.viewport.getArcFilter(arcs), arcIds ?? undefined);
  } else {
    ctx.painter.drawArcs(arcs, style, ctx.viewport.getArcFilter(arcs));
  }
}

function renderFillLayer(
  ctx: LayerRendererContext,
  layer: FillLayerSpecification,
  ml: MapshaperLayer,
  arcs: ArcCollection,
  cacheKey: string,
  lineScale: number,
): void {
  const fillPaint = layer.paint;
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
  const style = resolveStrokeStyle(layer.paint, lineScale);
  if ((style.width ?? 0) > 0) {
    const arcIds = ctx.getLayerArcIds(ml, arcs, cacheKey);
    ctx.painter.drawArcs(arcs, style, viewportFilter, arcIds ?? undefined);
  }
}
