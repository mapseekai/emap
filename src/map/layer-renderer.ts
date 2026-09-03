import type { Viewport } from '../geo/viewport';
import type { CorePainter } from '../renderer/painter';
import type { MutableTopologySource } from '../source/source';
import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
  PathShape,
  StrokeStyle,
} from '../types/mapshaper-types';
import { resolvePointStyle, resolveStrokeStyle } from './layer';
import type { FillLayerSpecification, LayerSpecification, LineLayerSpecification } from './layer';
import { EMAP_THEME_COLORS } from '../theme/colors';
import type { StyleResolver } from './style-resolver';

export interface LayerRendererContext {
  layers: readonly LayerSpecification[];
  sources: ReadonlyMap<string, MutableTopologySource>;
  viewport: Viewport;
  painter: CorePainter;
  /** 可选：缺省时表达式/烘焙样式不解析（静态路径）。 */
  styleResolver?: StyleResolver;
  resolveSourceLayer(sourceId: string, sourceLayerName?: string): MapshaperLayer | null;
  getLayerArcIds(sourceId: string, ml: MapshaperLayer, arcs: ArcCollection): Uint32Array | null;
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
    if (layer.type === 'line' && arcs) {
      renderLineLayer(ctx, layer, ml, arcs, source.getDataset?.()?.editVersion ?? 0, lineScale);
    } else if (layer.type === 'fill' && arcs && ml?.shapes) {
      renderFillLayer(
        ctx,
        layer,
        ml,
        arcs,
        source.getDataset?.()?.editVersion ?? 0,
        lineScale,
        source.getDataset?.(),
      );
    } else if (layer.type === 'circle' && ml?.shapes) {
      const style = resolvePointStyle(layer.paint);
      ctx.painter.drawPoints(ml.shapes, style);
    }
  }
}

function drawOutline(
  ctx: LayerRendererContext,
  layer: LineLayerSpecification | FillLayerSpecification,
  ml: MapshaperLayer,
  arcs: ArcCollection,
  style: StrokeStyle,
  viewportFilter: (arcId: number) => boolean,
  geometryRevision: number,
): void {
  if (style.dashType === 'arrow-dot') {
    ctx.painter.drawArcs(arcs, style, viewportFilter, undefined, {
      shapes: ml.shapes as readonly (PathShape | null)[],
      cacheKey: `${layer.source}:${layer['source-layer'] || 'default'}:${layer.id}`,
      geometryRevision,
    });
    return;
  }
  const arcIds = ctx.getLayerArcIds(layer.source, ml, arcs);
  ctx.painter.drawArcs(arcs, style, viewportFilter, arcIds ?? undefined);
}

function renderLineLayer(
  ctx: LayerRendererContext,
  layer: LineLayerSpecification,
  ml: MapshaperLayer | null,
  arcs: ArcCollection,
  geometryRevision: number,
  lineScale: number,
): void {
  const style = resolveStrokeStyle(layer.paint, lineScale);
  if (ml?.shapes) {
    const viewportFilter = ctx.viewport.getArcFilter(arcs);
    drawOutline(ctx, layer, ml, arcs, style, viewportFilter, geometryRevision);
  } else {
    ctx.painter.drawArcs(arcs, style, ctx.viewport.getArcFilter(arcs));
  }
}

function renderFillLayer(
  ctx: LayerRendererContext,
  layer: FillLayerSpecification,
  ml: MapshaperLayer,
  arcs: ArcCollection,
  geometryRevision: number,
  lineScale: number,
  dataset?: MapshaperDataset,
): void {
  const fillPaint = layer.paint;
  const fillSpec = fillPaint?.['fill-color'];
  const fillColor = typeof fillSpec === 'string' ? fillSpec : EMAP_THEME_COLORS.muted;
  const fillOpacity = fillPaint?.['fill-opacity'];
  const viewportFilter = ctx.viewport.getArcFilter(arcs);
  // Near full extent every part is visible anyway, so per-part bbox culling
  // is pure overhead — and it dominates the frame once LOD arcs make the
  // actual drawing cheap. Mapshaper's getShapeFilter applies the same
  // skip-below-1.1 rule.
  const cullParts = ctx.viewport.getMapScale() > 1.1;
  const resolution =
    ctx.styleResolver && dataset
      ? ctx.styleResolver.resolveFill({
          layerId: layer.id,
          paint: fillPaint,
          styleSource: layer.styleSource,
          dataset,
          layer: ml,
        })
      : null;
  ctx.painter.drawPolygonFill(
    ml.shapes!,
    arcs,
    fillColor,
    cullParts ? viewportFilter : undefined,
    fillOpacity,
    {
      viewBBox: cullParts ? ctx.viewport.getViewBounds() : null,
      ...(resolution
        ? {
            styleBuckets: {
              buckets: resolution.fillBuckets,
              colors: resolution.styles,
            },
          }
        : {}),
    },
  );
  const style = resolveStrokeStyle(layer.paint, lineScale);
  if ((style.width ?? 0) > 0) {
    drawOutline(ctx, layer, ml, arcs, style, viewportFilter, geometryRevision);
  }
}
