import type { PointLodSelection } from '../rendering/point-lod';
import Flatbush from 'flatbush';
import { getDefaultMapshaperAdapter } from '../../integrations/mapshaper/adapter';
import { AffineTransform } from '../../domain/geo/transform';
import type { MutableTopologySource } from '../../domain/source/source';
import { getLayerId, normalizePointShape } from '../../domain/source/layer-utils';
import type { QueryFeaturesOptions, QueriedFeature } from './types';
import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
  PathPart,
  PathShape,
} from '../../shared/types/mapshaper-types';
import { hasLayerKey, type VisibleLayerLookup } from './structured-keys';

/** Pixel distance for a bullseye hit on point features */
const POINT_BULLSEYE_DIST = 2;

/** Default pixel threshold for point hit-testing */
const POINT_HIT_THRESHOLD = 25;

type FlatbushIndex = InstanceType<typeof Flatbush>;

/** Sentinel returned by `_getOrBuildIndex` for layers with no shapes. */
type IndexedLayer = {
  index: FlatbushIndex;
  shapeCount: number;
  bounds: number[];
  renderQuery?: { bounds: readonly number[]; ids: Uint32Array | null };
} | null;

const RENDER_INDEX_MIN_SHAPES = 10_000;
const RENDER_INDEX_MAX_FRACTION = 0.25;
const EMPTY_RENDER_CANDIDATES = new Uint32Array();

interface IndexedLayerCacheEntry {
  shapes: MapshaperLayer['shapes'];
  dataset: MapshaperDataset | undefined;
  shapeCount: number;
  arcsSize: number;
  editVersion: number;
  value: Exclude<IndexedLayer, null>;
}

export interface PointLodPick {
  selections: PointLodSelection[];
  fullDetailMasks: (Uint8Array | null)[];
  overlayIds: readonly number[];
}

interface HitCandidate {
  shape: PathShape;
  id: number;
  dist: number;
  info?: { distance: number };
}

/**
 * Handles spatial feature queries (point hit-testing, bbox selection).
 * Extracted from Emap to keep the map class focused on coordination.
 */
export class FeatureQuery {
  private _sources: globalThis.Map<string, MutableTopologySource>;
  private _getTransform: () => AffineTransform;
  private _getSize: () => { width: number; height: number };
  private _getInitialMX: () => number;

  private _featureMaskProvider: ((sourceId: string, layerId: string) => Uint8Array | null) | null =
    null;

  private _pointLodProvider?: (
    sourceId: string,
    layer: MapshaperLayer,
    bounds: readonly number[],
  ) => PointLodPick | null;

  /** @internal Render-only pointer candidates; never used by bbox/lasso/business queries. */
  setPointLodProvider(provider: FeatureQuery['_pointLodProvider']): void {
    this._pointLodProvider = provider;
  }

  // Per-(source, layer) Flatbush spatial index cache. Each entry records
  // shape count, arc count, and edit version so any change invalidates it:
  //   1. Dataset-replace ops change shape and/or arc counts.
  //   2. In-place edits (vertex move / translate / shared-arc split / …)
  //      bump `dataset.editVersion` via `bumpEditVersion`, which lands in
  //      the cache key.
  //   3. Manual `clear(sourceId)` calls (kept as an escape hatch for
  //      callers that mutate via paths that don't go through edit
  //      commands).
  private _indexCache: globalThis.Map<string, globalThis.Map<number, IndexedLayerCacheEntry>> =
    new globalThis.Map();

  constructor(
    sources: globalThis.Map<string, MutableTopologySource>,
    getTransform: () => AffineTransform,
    getSize: () => { width: number; height: number },
    getInitialMX: () => number,
  ) {
    this._sources = sources;
    this._getTransform = getTransform;
    this._getSize = getSize;
    this._getInitialMX = getInitialMX;
  }

  /** Host wires the render-layer filter union here; null mask = no filtering. */
  setFeatureMaskProvider(
    fn: ((sourceId: string, layerId: string) => Uint8Array | null) | null,
  ): void {
    this._featureMaskProvider = fn;
  }

  // ---------------------------------------------------------------------------
  // Spatial index — public surface
  // ---------------------------------------------------------------------------

  /**
   * Eagerly build spatial indexes for every layer of one source (or all
   * sources when omitted). Idempotent — already-cached entries are
   * skipped. Used by `Emap.prebuildSpatialIndex` to pay the build cost
   * in idle time before the first user query.
   */
  prebuild(sourceId?: string): void {
    if (sourceId !== undefined) {
      const source = this._sources.get(sourceId);
      if (source) this._prebuildSource(sourceId, source);
      return;
    }
    for (const [id, source] of this._sources) {
      this._prebuildSource(id, source);
    }
  }

  /** Prepare large render layers during source loading, before the first gesture. */
  prebuildForRendering(sourceId: string): void {
    const source = this._sources.get(sourceId);
    if (!source) return;
    const layers = source.getLayers();
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i] as MapshaperLayer;
      if ((layer.shapes?.length ?? 0) >= RENDER_INDEX_MIN_SHAPES) {
        this._getOrBuildIndex(sourceId, i, layer, source.getArcs(), source.getDataset?.());
      }
    }
  }

  /** Ordered broad-phase IDs only; null keeps the direct scan, [] means no candidates. */
  getRenderCandidates(
    sourceId: string,
    layer: MapshaperLayer,
    bounds: readonly number[],
  ): Uint32Array | null {
    if ((layer.shapes?.length ?? 0) < RENDER_INDEX_MIN_SHAPES) return null;
    const source = this._sources.get(sourceId);
    if (!source) return null;
    const layerIndex = source.getLayers().indexOf(layer);
    if (layerIndex < 0) return null;
    const indexed = this._getOrBuildIndex(
      sourceId,
      layerIndex,
      layer,
      source.getArcs(),
      source.getDataset?.(),
    );
    if (!indexed) return null;
    const cached = indexed.renderQuery;
    if (cached && cached.bounds.every((value, i) => value === bounds[i])) return cached.ids;
    const remember = (ids: Uint32Array | null) => {
      indexed.renderQuery = { bounds: bounds.slice(), ids };
      return ids;
    };
    const [xmin, ymin, xmax, ymax] = bounds;
    const extent = indexed.bounds;
    if (xmax < extent[0] || xmin > extent[2] || ymax < extent[1] || ymin > extent[3])
      return remember(EMPTY_RENDER_CANDIDATES);
    const width = extent[2] - extent[0],
      height = extent[3] - extent[1];
    const xFraction =
      width > 0 ? (Math.min(xmax, extent[2]) - Math.max(xmin, extent[0])) / width : 1;
    const yFraction =
      height > 0 ? (Math.min(ymax, extent[3]) - Math.max(ymin, extent[1])) / height : 1;
    // A cheap coverage estimate avoids even searching near full extent. Skewed
    // distributions still use the actual candidate-count guard below.
    if (xFraction * yFraction >= RENDER_INDEX_MAX_FRACTION) return remember(null);
    const ids: number[] = indexed.index.search(xmin, ymin, xmax, ymax);
    // Avoid the expensive sort/materialization when drawing most of the layer anyway.
    if (ids.length >= indexed.shapeCount * RENDER_INDEX_MAX_FRACTION) return remember(null);
    const candidates = Uint32Array.from(ids.sort((a, b) => a - b));
    return remember(candidates);
  }

  /**
   * Drop cached spatial indexes for one source (or all). Necessary after
   * in-place geometry edits (translateSelected, vertex commands) that
   * mutate arc coordinates without changing shape / arc counts — without
   * this call, the cache key wouldn't notice and queries would return
   * prefilter-stale results.
   */
  clear(sourceId?: string): void {
    if (sourceId === undefined) {
      this._indexCache.clear();
      return;
    }
    this._indexCache.delete(sourceId);
  }

  // ---------------------------------------------------------------------------
  // Spatial index — internals
  // ---------------------------------------------------------------------------

  private _prebuildSource(sourceId: string, source: MutableTopologySource): void {
    if (source.type !== 'topology') return;
    const layers = source.getLayers();
    const arcs = source.getArcs();
    const dataset = source.getDataset?.();
    for (let i = 0; i < layers.length; i++) {
      this._getOrBuildIndex(sourceId, i, layers[i] as MapshaperLayer, arcs, dataset);
    }
  }

  /**
   * Lazily build a Flatbush index for one layer, cached by
   * (sourceId, layerIndex, shapeCount, arcCount). Returns `null` for
   * shape-less layers — caller falls back to the no-index loop.
   *
   * Per-shape bbox: point layers union of their coords; path layers
   * union of `arcs.getSimpleShapeBbox()` over each part. Same precision
   * as the existing inline test, just memoized.
   */
  private _getOrBuildIndex(
    sourceId: string,
    layerIndex: number,
    layer: MapshaperLayer,
    arcs: ArcCollection | undefined,
    /**
     * Optional dataset reference. When supplied, its `editVersion` is
     * folded into the cache key so in-place edits that don't change
     * shape or arc counts (vertex move, translate, …) auto-invalidate.
     */
    dataset?: { editVersion?: number },
  ): IndexedLayer {
    const shapes = layer?.shapes;
    if (!shapes || shapes.length === 0) return null;
    // A conservative full-detail bbox is shared by picking and every render LOD.
    const source = this._sources.get(sourceId);
    const datasetIdentity = source?.getDataset?.();
    arcs = source?.getArcs() ?? arcs;
    const arcsSize = layer.geometry_type === 'point' ? 0 : (arcs?.size?.() ?? 0);
    const editVersion = dataset?.editVersion ?? 0;
    const sourceCache = this._indexCache.get(sourceId);
    const cached = sourceCache?.get(layerIndex);
    if (
      cached &&
      cached.shapes === shapes &&
      cached.dataset === datasetIdentity &&
      cached.shapeCount === shapes.length &&
      cached.arcsSize === arcsSize &&
      cached.editVersion === editVersion
    ) {
      return cached.value;
    }

    const isPoint = layer.geometry_type === 'point';
    const index = new Flatbush(shapes.length);
    const partBox: number[] = [];
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];

    for (let id = 0; id < shapes.length; id++) {
      const shp = shapes[id];
      if (!shp) {
        // Null shape: still must add an entry so flatbush ids stay aligned
        // with shape ids. Degenerate bbox at the origin won't match real
        // queries.
        index.add(0, 0, 0, 0);
        continue;
      }
      let xmin = Infinity,
        ymin = Infinity,
        xmax = -Infinity,
        ymax = -Infinity;
      if (isPoint) {
        for (const p of normalizePointShape(shp)) {
          if (!p || p.length < 2) continue;
          if (p[0] < xmin) xmin = p[0];
          if (p[0] > xmax) xmax = p[0];
          if (p[1] < ymin) ymin = p[1];
          if (p[1] > ymax) ymax = p[1];
        }
      } else if (arcs?.getSimpleShapeBbox) {
        const path = shp as PathShape;
        for (let i = 0; i < path.length; i++) {
          arcs.getSimpleShapeBbox(path[i], partBox);
          if (partBox[0] < xmin) xmin = partBox[0];
          if (partBox[1] < ymin) ymin = partBox[1];
          if (partBox[2] > xmax) xmax = partBox[2];
          if (partBox[3] > ymax) ymax = partBox[3];
        }
      }
      if (xmin === Infinity) {
        index.add(0, 0, 0, 0);
        continue;
      }
      index.add(xmin, ymin, xmax, ymax);
      bounds[0] = Math.min(bounds[0], xmin);
      bounds[1] = Math.min(bounds[1], ymin);
      bounds[2] = Math.max(bounds[2], xmax);
      bounds[3] = Math.max(bounds[3], ymax);
    }
    index.finish();
    const entry: IndexedLayer = { index, shapeCount: shapes.length, bounds };
    const layerCache = sourceCache ?? new globalThis.Map<number, IndexedLayerCacheEntry>();
    layerCache.set(layerIndex, {
      shapes,
      dataset: datasetIdentity,
      shapeCount: shapes.length,
      arcsSize,
      editVersion,
      value: entry,
    });
    this._indexCache.set(sourceId, layerCache);
    return entry;
  }

  query(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
    visibleLayers?: VisibleLayerLookup,
  ): QueriedFeature[] {
    const { width, height } = this._getSize();
    const isGeometry = Array.isArray(geometryOrOptions);
    const geometry = isGeometry
      ? geometryOrOptions
      : [
          [0, 0],
          [width, height],
        ];
    const opts = options || (isGeometry ? {} : geometryOrOptions) || {};

    if (Array.isArray(geometry) && typeof geometry[0] === 'number') {
      const point = geometry as [number, number];
      return this._queryFeaturesAtPoint(point, opts, visibleLayers);
    }

    const bbox = geometry as [[number, number], [number, number]];
    return this._queryFeaturesInBBox(bbox, opts, visibleLayers);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _layerMatchesFilter(layer: MapshaperLayer, index: number, layers?: string[]): boolean {
    if (!layers || layers.length === 0) return true;
    const layerId = getLayerId(layer, index);
    if (layers.includes(layerId)) return true;
    if (layer?.name && layers.includes(layer.name)) return true;
    if (layer?.id && layers.includes(layer.id)) return true;
    return false;
  }

  private _unproject(px: number, py: number): [number, number] {
    return this._getTransform().unproject(px, py);
  }

  private _getHitBuffer(pix: number): number {
    return pix / Math.abs(this._getTransform().mx || 1);
  }

  private _getZoomAdjustedHitBuffer(pix: number, minPix: number): number {
    const transform = this._getTransform();
    const initialMX = this._getInitialMX();
    const scale = Math.abs(transform.mx) / (initialMX || Math.abs(transform.mx) || 1);
    if (scale < 1) pix *= scale;
    if (minPix > 0 && pix < minPix) pix = minPix;
    return this._getHitBuffer(pix);
  }

  // ---------------------------------------------------------------------------
  // Hit-testing primitives (promoted from local functions)
  // ---------------------------------------------------------------------------

  private _findHitCandidates(
    sourceId: string,
    layerIndex: number,
    layer: MapshaperLayer,
    arcs: ArcCollection,
    x: number,
    y: number,
    dist: number,
    dataset?: { editVersion?: number },
    mask?: Uint8Array | null,
  ): HitCandidate[] {
    const cands: HitCandidate[] = [];
    const index: Record<number, HitCandidate> = {};
    const bbox: number[] = [];
    const shapes = layer.shapes;
    if (!shapes) return cands;

    // Spatial index prefilter — only iterate shapes whose stored bbox
    // overlaps `[x ± dist, y ± dist]`. The per-part inner test below is
    // unchanged so precision stays identical.
    const indexed = this._getOrBuildIndex(sourceId, layerIndex, layer, arcs, dataset);
    const candidateIds = indexed
      ? indexed.index.search(x - dist, y - dist, x + dist, y + dist)
      : null;
    const idCount = candidateIds !== null ? candidateIds.length : shapes.length;

    for (let i = 0; i < idCount; i++) {
      const shpId = candidateIds !== null ? candidateIds[i] : i;
      const shp = shapes[shpId] as PathShape | null | undefined;
      if (mask && mask[shpId] !== 1) continue;
      if (!shp) continue;
      for (let j = 0; j < shp.length; j++) {
        const part: PathPart = shp[j];
        arcs.getSimpleShapeBbox!(part, bbox);
        if (x + dist < bbox[0] || x - dist > bbox[2] || y + dist < bbox[1] || y - dist > bbox[3]) {
          continue;
        }
        let cand = index[shpId];
        if (!cand) {
          cand = index[shpId] = { shape: [], id: shpId, dist: 0 };
          cands.push(cand);
        }
        cand.shape.push(part);
      }
    }
    return cands;
  }

  private _sortByDistance(x: number, y: number, cands: HitCandidate[], arcs: ArcCollection): void {
    const adapter = getDefaultMapshaperAdapter();
    for (const cand of cands) {
      cand.info = adapter.getPointToShapeInfo(x, y, cand.shape, arcs);
      cand.dist = cand.info!.distance;
    }
    cands.sort((a, b) => a.dist - b.dist);
  }

  private _pickNearestCandidates(
    sorted: HitCandidate[],
    bufDist: number,
    maxDist: number,
  ): HitCandidate[] {
    const hits: HitCandidate[] = [];
    let minDist = 0;
    for (let i = 0; i < sorted.length; i++) {
      const cand = sorted[i];
      if (!(cand.dist < maxDist)) break;
      if (i === 0) {
        minDist = cand.dist;
      } else if (cand.dist - minDist > bufDist) {
        break;
      }
      hits.push(cand);
    }
    return hits;
  }

  private _pointTest(
    sourceId: string,
    layerIndex: number,
    layer: MapshaperLayer,
    x: number,
    y: number,
    dataset?: { editVersion?: number },
    mask?: Uint8Array | null,
  ): number[] {
    const adapter = getDefaultMapshaperAdapter();
    const toPx = Math.abs(this._getTransform().mx || 1);
    let bestId = -1;
    let bestDist = Infinity;
    let hitThreshold = POINT_HIT_THRESHOLD;
    const shapes = layer.shapes;
    if (!shapes) return [];

    // Spatial index prefilter — query bbox = `[x ± hitThresholdInData,
    // y ± hitThresholdInData]`. Since we're working in data-space here,
    // convert the pixel threshold to data units via `1 / toPx`.
    const dataThresh = hitThreshold / (toPx || 1);
    const lod = this._pointLodProvider?.(sourceId, layer, [
      x - dataThresh,
      y - dataThresh,
      x + dataThresh,
      y + dataThresh,
    ]);
    const testPoint = (id: number, component?: number): void => {
      if (mask && mask[id] !== 1) return;
      const points = normalizePointShape(shapes[id]);
      const start = component ?? 0;
      const end = component === undefined ? points.length : start + 1;
      for (let c = start; c < end; c++) {
        const p = points[c];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const dist = adapter.distance2D(x, y, p[0], p[1]) * toPx;
        if (dist > hitThreshold) continue;
        if (dist < hitThreshold && hitThreshold > POINT_BULLSEYE_DIST)
          hitThreshold = Math.max(POINT_BULLSEYE_DIST, dist);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
    };
    if (lod) {
      for (const selection of lod.selections)
        for (let i = 0; i < selection.featureIds.length; i++)
          testPoint(selection.featureIds[i], selection.componentIds[i]);
      for (const id of lod.overlayIds) testPoint(id);
    }
    if (!lod || lod.fullDetailMasks.length) {
      const indexed = this._getOrBuildIndex(sourceId, layerIndex, layer, undefined, dataset);
      const candidateIds = indexed
        ? indexed.index.search(x - dataThresh, y - dataThresh, x + dataThresh, y + dataThresh)
        : null;
      const idCount = candidateIds !== null ? candidateIds.length : shapes.length;
      for (let i = 0; i < idCount; i++) {
        const id = candidateIds !== null ? candidateIds[i] : i;
        if (lod && !lod.fullDetailMasks.some((filter) => !filter || filter[id] === 1)) continue;
        testPoint(id);
      }
    }
    return bestId === -1 ? [] : [bestId];
  }

  private _polylineTest(
    sourceId: string,
    layerIndex: number,
    layer: MapshaperLayer,
    arcs: ArcCollection,
    x: number,
    y: number,
    bufArg: number,
    dataset?: { editVersion?: number },
    mask?: Uint8Array | null,
  ): number[] {
    const maxDist = this._getZoomAdjustedHitBuffer(15, 2);
    const bufPix = bufArg >= 0 ? bufArg : 0.05;
    const bufDist = this._getZoomAdjustedHitBuffer(bufPix, 0);
    let cands = this._findHitCandidates(
      sourceId,
      layerIndex,
      layer,
      arcs,
      x,
      y,
      maxDist,
      dataset,
      mask,
    );
    this._sortByDistance(x, y, cands, arcs);
    cands = this._pickNearestCandidates(cands, bufDist, maxDist);
    return cands.length ? [cands[0].id] : [];
  }

  private _polygonTest(
    sourceId: string,
    layerIndex: number,
    layer: MapshaperLayer,
    arcs: ArcCollection,
    x: number,
    y: number,
    dataset?: { editVersion?: number },
    mask?: Uint8Array | null,
  ): number[] {
    const adapter = getDefaultMapshaperAdapter();
    const maxDist = this._getZoomAdjustedHitBuffer(10, 1);
    const cands = this._findHitCandidates(
      sourceId,
      layerIndex,
      layer,
      arcs,
      x,
      y,
      maxDist,
      dataset,
      mask,
    );
    let hits: HitCandidate[] = [];
    for (const cand of cands) {
      if (adapter.testPointInPolygon(x, y, cand.shape, arcs)) {
        hits.push(cand);
      }
    }
    if (cands.length > 0 && hits.length === 0) {
      this._sortByDistance(x, y, cands, arcs);
      hits = this._pickNearestCandidates(cands, 0, maxDist);
    } else if (hits.length > 1) {
      this._sortByDistance(x, y, hits, arcs);
    }
    return hits.length ? [hits[0].id] : [];
  }

  private _polygonVertexTest(
    sourceId: string,
    layerIndex: number,
    layer: MapshaperLayer,
    arcs: ArcCollection,
    x: number,
    y: number,
    dataset?: { editVersion?: number },
    mask?: Uint8Array | null,
  ): number[] {
    const a = this._polygonTest(sourceId, layerIndex, layer, arcs, x, y, dataset, mask);
    const b = this._polylineTest(sourceId, layerIndex, layer, arcs, x, y, 5, dataset, mask);
    return a.length ? a : b;
  }

  private _eachQueryableLayer(
    pixelSize: number,
    options: QueryFeaturesOptions,
    visibleLayers: VisibleLayerLookup | undefined,
    cb: (
      sourceId: string,
      layerId: string,
      layerIndex: number,
      layer: MapshaperLayer,
      arcs: ArcCollection | undefined,
      dataset: { editVersion?: number } | undefined,
    ) => void,
  ): void {
    for (const [sourceId, source] of this._sources) {
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs ? displayArcs.getScaledArcs(pixelSize) : source.getArcs();
      const dataset = source.getDataset?.();

      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex] as MapshaperLayer;
        if (!layer?.shapes) continue;
        if (!this._layerMatchesFilter(layer, layerIndex, options.layers)) continue;

        const layerId = getLayerId(layer, layerIndex);
        if (visibleLayers && !hasLayerKey(visibleLayers, sourceId, layerId)) continue;
        cb(sourceId, layerId, layerIndex, layer, arcs, dataset);
      }
    }
  }

  private _pushResult(
    results: QueriedFeature[],
    sourceId: string,
    layerId: string,
    geometryType: MapshaperLayer['geometry_type'],
    table: MapshaperLayer['data'],
    id: number,
  ): void {
    const record = table?.getRecordAt?.(id) ?? table?.getRecords?.()?.[id] ?? {};
    results.push({
      id,
      source: sourceId,
      layer: layerId,
      geometryType: geometryType || 'unknown',
      properties: { ...record },
    });
  }

  // ---------------------------------------------------------------------------
  // Point query
  // ---------------------------------------------------------------------------

  private _queryFeaturesAtPoint(
    point: [number, number],
    options: QueryFeaturesOptions,
    visibleLayers?: VisibleLayerLookup,
  ): QueriedFeature[] {
    const transform = this._getTransform();
    const results: QueriedFeature[] = [];
    const [mx, my] = this._unproject(point[0], point[1]);
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    this._eachQueryableLayer(
      pixelSize,
      options,
      visibleLayers,
      (sourceId, layerId, layerIndex, layer, arcs, dataset) => {
        const mask = this._featureMaskProvider?.(sourceId, layerId) ?? undefined;
        const geometryType = layer.geometry_type;
        let ids: number[] = [];
        if (geometryType === 'point') {
          ids = this._pointTest(sourceId, layerIndex, layer, mx, my, dataset, mask);
        } else if (geometryType === 'polyline' && arcs) {
          ids = this._polylineTest(sourceId, layerIndex, layer, arcs, mx, my, -1, dataset, mask);
        } else if (geometryType === 'polygon' && arcs) {
          ids = this._polygonVertexTest(sourceId, layerIndex, layer, arcs, mx, my, dataset, mask);
        }
        for (const id of ids) {
          this._pushResult(results, sourceId, layerId, geometryType, layer.data, id);
        }
      },
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // BBox query
  // ---------------------------------------------------------------------------

  private _queryFeaturesInBBox(
    bbox: [[number, number], [number, number]],
    options: QueryFeaturesOptions,
    visibleLayers?: VisibleLayerLookup,
  ): QueriedFeature[] {
    const transform = this._getTransform();
    const results: QueriedFeature[] = [];
    const [p1, p2] = bbox;
    const a = this._unproject(p1[0], p1[1]);
    const b = this._unproject(p2[0], p2[1]);
    const xmin = Math.min(a[0], b[0]);
    const ymin = Math.min(a[1], b[1]);
    const xmax = Math.max(a[0], b[0]);
    const ymax = Math.max(a[1], b[1]);
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    this._eachQueryableLayer(
      pixelSize,
      options,
      visibleLayers,
      (sourceId, layerId, layerIndex, layer, arcs, dataset) => {
        const mask = this._featureMaskProvider?.(sourceId, layerId);
        const geometryType = layer.geometry_type;
        const table = layer.data;
        const bboxTmp: number[] = [];

        // Spatial index prefilter — `index.search` returns only shape ids
        // whose stored bbox overlaps the query bbox. Falls back to a full
        // scan for shape-less / un-indexed layers.
        const indexed = this._getOrBuildIndex(sourceId, layerIndex, layer, arcs, dataset);
        const candidateIds = indexed ? indexed.index.search(xmin, ymin, xmax, ymax) : null;
        const idCount = candidateIds !== null ? candidateIds.length : layer.shapes!.length;

        for (let i = 0; i < idCount; i++) {
          const id = candidateIds !== null ? candidateIds[i] : i;
          const shp = layer.shapes![id];
          if (!shp) continue;
          if (mask && mask[id] !== 1) continue;
          let hit = false;
          if (geometryType === 'point') {
            hit = normalizePointShape(shp).some(
              (p) => p[0] >= xmin && p[0] <= xmax && p[1] >= ymin && p[1] <= ymax,
            );
          } else if (arcs) {
            const path = shp as PathShape;
            for (let i = 0; i < path.length; i++) {
              arcs.getSimpleShapeBbox!(path[i], bboxTmp);
              if (
                xmax < bboxTmp[0] ||
                xmin > bboxTmp[2] ||
                ymax < bboxTmp[1] ||
                ymin > bboxTmp[3]
              ) {
                continue;
              }
              hit = true;
              break;
            }
          }
          if (!hit) continue;
          this._pushResult(results, sourceId, layerId, geometryType, table, id);
        }
      },
    );

    return results;
  }
}
