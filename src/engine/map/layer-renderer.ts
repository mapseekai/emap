import type { PointIconImages } from '../rendering/icons/images';
import { pointLodForPainter } from '../rendering/point-lod';
import type { Viewport } from '../../domain/geo/viewport';
import type { CorePainter } from '../rendering/painter';
import type { MutableTopologySource } from '../../domain/source/source';
import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
  PathShape,
  StrokeStyle,
} from '../../shared/types/mapshaper-types';
import { resolvePointStyle, resolveStrokeStyle } from './layer';
import type { FillLayerSpecification, LayerSpecification, LineLayerSpecification } from './layer';
import { EMAP_THEME_COLORS } from '../../ui/theme/colors';
import type { StyleResolution, StyleResolver } from './style-resolver';
import { applyMaskToCandidates, type FilterResolver } from './filter-resolver';

export interface LayerRendererContext {
  iconImages?: PointIconImages | null;
  layers: readonly LayerSpecification[];
  /** Full-frame layer IDs retained when rendering one source block at a time. */
  retainLayerIds?: ReadonlySet<string>;
  sources: ReadonlyMap<string, MutableTopologySource>;
  viewport: Viewport;
  painter: CorePainter;
  /** 可选：缺省时表达式/烘焙样式不解析（静态路径）。 */
  styleResolver?: StyleResolver;
  /** 可选：图层显示过滤器掩码解析器。 */
  filterResolver?: FilterResolver;
  resolveSourceLayer(sourceId: string, sourceLayerName?: string): MapshaperLayer | null;
  getLayerArcIds(sourceId: string, ml: MapshaperLayer, arcs: ArcCollection): Uint32Array | null;
  getRenderCandidates?(
    sourceId: string,
    ml: MapshaperLayer,
    bounds: readonly number[],
  ): Uint32Array | null;
}

const sourceDatasetIds = new WeakMap<MapshaperDataset, number>();
let sourceDatasetSerial = 0;
const sourceBoundsCache = new WeakMap<
  MutableTopologySource,
  { datasetId: number; revision: number; bounds: [number, number, number, number] | undefined }
>();
function stableSourceBounds(
  source: MutableTopologySource,
  dataset: MapshaperDataset | undefined,
): [number, number, number, number] | undefined {
  let datasetId = dataset ? sourceDatasetIds.get(dataset) : 0;
  if (dataset && !datasetId) {
    datasetId = ++sourceDatasetSerial;
    sourceDatasetIds.set(dataset, datasetId);
  }
  const revision = dataset?.editVersion ?? 0,
    previous = sourceBoundsCache.get(source);
  if (previous && previous.datasetId === datasetId && previous.revision === revision)
    return previous.bounds;
  const extent = source.getExtent?.(),
    bounds = extent
      ? ([extent.xmin, extent.ymin, extent.xmax, extent.ymax] as [number, number, number, number])
      : undefined;
  sourceBoundsCache.set(source, { datasetId: datasetId ?? 0, revision, bounds });
  return bounds;
}

const bucketMembership = new WeakMap<
  StyleResolution,
  {
    count: number;
    ids: Uint32Array;
    candidates?: Uint32Array;
    filtered?: StyleResolution;
  }
>();

function getStyleMembership(resolution: StyleResolution, count: number) {
  let membership = bucketMembership.get(resolution);
  if (!membership || membership.count !== count) {
    const ids = new Uint32Array(count);
    for (let b = 0; b < resolution.buckets.length; b++) {
      for (const id of resolution.buckets[b]) ids[id] = b + 1;
    }
    membership = { count, ids };
    bucketMembership.set(resolution, membership);
  }
  return membership;
}

function visibleStyleBuckets(
  resolution: StyleResolution | null,
  candidates: Uint32Array | null,
  count: number,
): StyleResolution | null {
  if (!resolution || !candidates) return resolution;
  const membership = getStyleMembership(resolution, count);
  if (membership.candidates === candidates && membership.filtered) return membership.filtered;
  const lists: number[][] = resolution.buckets.map(() => []);
  for (const id of candidates) {
    const bucket = membership.ids[id];
    if (bucket) lists[bucket - 1].push(id);
  }
  membership.candidates = candidates;
  membership.filtered = {
    styles: resolution.styles,
    buckets: lists.map((ids) => Uint32Array.from(ids)),
    ...(resolution.extras ? { extras: resolution.extras } : {}),
  };
  return membership.filtered;
}

function getCandidates(
  ctx: LayerRendererContext,
  sourceId: string,
  ml: MapshaperLayer,
  padding = 0,
): Uint32Array | null {
  if (!ctx.getRenderCandidates) return null;
  const bounds = ctx.viewport.getViewBounds();
  if (!bounds) return null;
  return ctx.getRenderCandidates(sourceId, ml, [
    bounds[0] - padding,
    bounds[1] - padding,
    bounds[2] + padding,
    bounds[3] + padding,
  ]);
}

export function renderLayers(
  ctx: LayerRendererContext,
  pixelSize: number,
  lineScale: number,
): void {
  const pointLod = pointLodForPainter(ctx.painter);
  pointLod.retainLayers(ctx.retainLayerIds ?? new Set(ctx.layers.map((layer) => layer.id)));
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
    const dataset = source.getDataset?.();
    ctx.painter.setLayerContext?.({
      id: layer.id,
      sourceId: layer.source,
      revision: dataset?.editVersion ?? 0,
      bounds: stableSourceBounds(source, dataset),
      content: JSON.stringify([
        layer.paint,
        layer.filter,
        layer.label,
        layer.type === 'circle' ? layer.icon : undefined,
        dataset?.attributeVersion ?? 0,
      ]),
    });
    let featureMask: Uint8Array | null = null;
    if (layer.filter && dataset && ml?.shapes && ctx.filterResolver) {
      featureMask = ctx.filterResolver.mask({
        layerId: layer.id,
        filter: layer.filter,
        dataset,
        layer: ml,
      });
      if (layer.type !== 'circle' && featureMask && !featureMask.some((v) => v === 1)) continue;
    }
    if (layer.type === 'line' && arcs) {
      renderLineLayer(
        ctx,
        layer,
        ml,
        arcs,
        dataset?.editVersion ?? 0,
        lineScale,
        dataset,
        featureMask,
      );
    } else if (layer.type === 'fill' && arcs && ml?.shapes) {
      renderFillLayer(
        ctx,
        layer,
        ml,
        arcs,
        dataset?.editVersion ?? 0,
        lineScale,
        dataset,
        featureMask,
      );
    } else if (layer.type === 'circle' && ml?.shapes) {
      const style = resolvePointStyle(layer.paint);
      const fullResolution =
        ctx.styleResolver && dataset
          ? ctx.styleResolver.resolveCircle({
              layerId: layer.id,
              paint: layer.paint,
              styleSource: layer.styleSource,
              dataset,
              layer: ml,
            })
          : null;
      const icon = ctx.painter.drawPointIcons ? ctx.iconImages?.get(layer.icon) : null;
      const radius = Math.max(Number(style.radius) || 4, icon?.radius ?? 0);
      const bounds = ctx.viewport.getViewBounds();
      const padding = radius * pixelSize;
      const lod =
        bounds && ctx.viewport.transform
          ? pointLod.query(
              layer,
              ml,
              dataset,
              featureMask,
              ctx.viewport.transform,
              [bounds[0] - padding, bounds[1] - padding, bounds[2] + padding, bounds[3] + padding],
              {
                width: ctx.viewport.width ?? 1024,
                height: ctx.viewport.height ?? 768,
                bounds: [
                  bounds[0] - padding,
                  bounds[1] - padding,
                  bounds[2] + padding,
                  bounds[3] + padding,
                ],
                painting: true,
                getCandidates: () => getCandidates(ctx, layer.source, ml, padding),
              },
            )
          : null;
      if (lod) {
        if (!lod.featureIds.length) continue;
        if (icon) {
          ctx.painter.drawPointIcons!(ml.shapes, icon, lod.featureIds, lod.componentIds);
          continue;
        }
        if (fullResolution) {
          // One pass through survivors; styles still resolve by original feature ID.
          const membership = getStyleMembership(fullResolution, ml.shapes.length);
          const features: number[][] = fullResolution.buckets.map(() => []);
          const components: number[][] = fullResolution.buckets.map(() => []);
          for (let i = 0; i < lod.featureIds.length; i++) {
            const bucket = membership.ids[lod.featureIds[i]] - 1;
            if (bucket < 0) continue;
            features[bucket].push(lod.featureIds[i]);
            components[bucket].push(lod.componentIds[i]);
          }
          for (let b = 0; b < features.length; b++) {
            if (!features[b].length) continue;
            ctx.painter.drawPoints(
              ml.shapes,
              { ...style, color: fullResolution.styles[b], ...fullResolution.extras?.[b] },
              Uint32Array.from(features[b]),
              Uint32Array.from(components[b]),
            );
          }
        } else {
          ctx.painter.drawPoints(ml.shapes, style, lod.featureIds, lod.componentIds);
        }
        continue;
      }
      let candidates = getCandidates(ctx, layer.source, ml, padding);
      if (featureMask) candidates = applyMaskToCandidates(candidates, featureMask);
      if (candidates?.length === 0) continue;
      if (icon) {
        ctx.painter.drawPointIcons!(ml.shapes, icon, candidates ?? undefined);
        continue;
      }
      const resolution = visibleStyleBuckets(fullResolution, candidates, ml.shapes.length);
      if (resolution) {
        for (let i = 0; i < resolution.buckets.length; i++) {
          if (resolution.buckets[i].length === 0) continue;
          ctx.painter.drawPoints(
            ml.shapes,
            { ...style, color: resolution.styles[i], ...resolution.extras?.[i] },
            resolution.buckets[i],
          );
        }
      } else {
        if (candidates) ctx.painter.drawPoints(ml.shapes, style, candidates);
        else ctx.painter.drawPoints(ml.shapes, style);
      }
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
  candidates: Uint32Array | null = null,
): void {
  if (style.dashType === 'arrow-dot') {
    ctx.painter.drawArcs(arcs, style, viewportFilter, undefined, {
      shapes: ml.shapes as readonly (PathShape | null)[],
      cacheKey: `${layer.source}:${layer['source-layer'] || 'default'}:${layer.id}`,
      geometryRevision,
      ...(candidates ? { shapeIndices: candidates } : {}),
    });
    return;
  }
  if (ctx.painter.drawOutlinePaths) {
    ctx.painter.drawOutlinePaths(
      ml.shapes!,
      style,
      arcs,
      viewportFilter,
      candidates ?? undefined,
      geometryRevision,
    );
    return;
  }
  let arcIds: Uint32Array | null;
  if (candidates) {
    // Candidate shapes keep source order, hence the first occurrence of every
    // visible shared arc keeps the same order as the full layer arc list.
    const ids = new Set<number>();
    for (const id of candidates) {
      const shape = ml.shapes?.[id] as PathShape | null | undefined;
      if (!shape) continue;
      for (const part of shape) {
        for (const signedId of part) {
          const arcId = signedId >= 0 ? signedId : ~signedId;
          if (!viewportFilter || viewportFilter(arcId)) ids.add(arcId);
        }
      }
    }
    arcIds = Uint32Array.from(ids);
  } else {
    arcIds = ctx.getLayerArcIds(layer.source, ml, arcs);
  }
  ctx.painter.drawArcs(arcs, style, viewportFilter, arcIds ?? undefined);
}

function renderLineLayer(
  ctx: LayerRendererContext,
  layer: LineLayerSpecification,
  ml: MapshaperLayer | null,
  arcs: ArcCollection,
  geometryRevision: number,
  lineScale: number,
  dataset?: MapshaperDataset,
  featureMask: Uint8Array | null = null,
): void {
  const style = resolveStrokeStyle(layer.paint, lineScale);
  if (ml?.shapes) {
    const viewportFilter = ctx.viewport.getArcFilter(arcs);
    let candidates = getCandidates(ctx, layer.source, ml);
    if (featureMask) candidates = applyMaskToCandidates(candidates, featureMask);
    const resolution = visibleStyleBuckets(
      ctx.styleResolver && dataset
        ? ctx.styleResolver.resolveLine({
            layerId: layer.id,
            paint: layer.paint,
            styleSource: layer.styleSource,
            dataset,
            layer: ml,
          })
        : null,
      candidates,
      ml.shapes.length,
    );
    if (resolution) {
      for (let i = 0; i < resolution.buckets.length; i++) {
        const bucket = resolution.buckets[i];
        if (bucket.length === 0) continue;
        // 表达式桶覆盖 dashType 时，dash 数组必须按具名模式重解：
        // 图层级 style.dash 来自 line-dasharray/静态 dashstyle，直接沿用会错配。
        const extra = resolution.extras?.[i];
        const base =
          extra?.dashType !== undefined
            ? resolveStrokeStyle({ ...layer.paint, 'line-dashstyle': extra.dashType }, lineScale)
            : style;
        const bucketStyle = { ...base, color: resolution.styles[i], ...extra };
        if (bucketStyle.dashType === 'arrow-dot') {
          ctx.painter.drawArcs(arcs, bucketStyle, viewportFilter, undefined, {
            shapes: ml.shapes as readonly (PathShape | null)[],
            shapeIndices: bucket,
            cacheKey: `${layer.source}:${layer['source-layer'] || 'default'}:${layer.id}:${i}`,
            geometryRevision,
          });
        } else {
          ctx.painter.drawPaths(
            ml.shapes,
            bucketStyle,
            arcs,
            viewportFilter,
            bucket,
            geometryRevision,
          );
        }
      }
    } else {
      drawOutline(ctx, layer, ml, arcs, style, viewportFilter, geometryRevision, candidates);
    }
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
  featureMask: Uint8Array | null = null,
): void {
  const fillPaint = layer.paint;
  const fillColorValue = fillPaint?.['fill-color'];
  const fillColor = typeof fillColorValue === 'string' ? fillColorValue : EMAP_THEME_COLORS.muted;
  const fillOpacity = fillPaint?.['fill-opacity'];
  const viewportFilter = ctx.viewport.getArcFilter(arcs);
  // Near full extent every part is visible anyway, so per-part bbox culling
  // is pure overhead — and it dominates the frame once LOD arcs make the
  // actual drawing cheap. Mapshaper's getShapeFilter applies the same
  // skip-below-1.1 rule.
  const cullParts = ctx.viewport.getMapScale() > 1.1;
  // At full extent the fill deliberately bypasses part culling. Keep that
  // behavior, including polygons whose boundary encloses the whole viewport.
  let candidates = cullParts ? getCandidates(ctx, layer.source, ml) : null;
  if (featureMask) candidates = applyMaskToCandidates(candidates, featureMask);
  const resolution = visibleStyleBuckets(
    ctx.styleResolver && dataset
      ? ctx.styleResolver.resolveFill({
          layerId: layer.id,
          paint: fillPaint,
          styleSource: layer.styleSource,
          dataset,
          layer: ml,
        })
      : null,
    candidates,
    ml.shapes!.length,
  );
  ctx.painter.drawPolygonFill(
    ml.shapes!,
    arcs,
    fillColor,
    cullParts ? viewportFilter : undefined,
    fillOpacity,
    {
      viewBBox: cullParts ? ctx.viewport.getViewBounds() : null,
      ...(candidates && !resolution ? { shapeIndices: candidates } : {}),
      ...(resolution
        ? {
            styleBuckets: {
              buckets: resolution.buckets,
              colors: resolution.styles,
            },
          }
        : {}),
    },
  );
  const style = resolveStrokeStyle(layer.paint, lineScale);
  if ((style.width ?? 0) > 0) {
    drawOutline(ctx, layer, ml, arcs, style, viewportFilter, geometryRevision, candidates);
  }
}
