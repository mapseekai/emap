import mapshaper from 'mapshaper';
import Flatbush from 'flatbush';
import { AffineTransform } from '../geo/transform';
import { TopologySource } from '../source/source';
import { getLayerId } from '../source/layer-utils';
import type { QueryRenderedFeaturesOptions, RenderedFeatureAttributes } from './map';
import type { ArcCollection, MapshaperLayer } from '../types/mapshaper-types';

/** Pixel distance for a bullseye hit on point features */
const POINT_BULLSEYE_DIST = 2;

/** Default pixel threshold for point hit-testing */
const POINT_HIT_THRESHOLD = 25;

type FlatbushIndex = InstanceType<typeof Flatbush>;

/** Sentinel returned by `_getOrBuildIndex` for layers with no shapes. */
type IndexedLayer = { index: FlatbushIndex; shapeCount: number } | null;

interface HitCandidate {
  shape: number[][];
  id: number;
  dist: number;
  info?: { distance: number };
}

/**
 * Handles spatial feature queries (point hit-testing, bbox selection).
 * Extracted from Emap to keep the map class focused on coordination.
 */
export class FeatureQuery {
  private _sources: globalThis.Map<string, TopologySource>;
  private _getTransform: () => AffineTransform;
  private _getSize: () => { width: number; height: number };
  private _getInitialMX: () => number;

  // Per-(source, layer) Flatbush spatial index cache. Keyed by
  // `${sourceId}|${layerIndex}|${shapes.length}|${arcs.size()}` so any
  // dataset-replace op (which always changes shape and / or arc counts)
  // implicitly invalidates. In-place geometry edits like translateSelected
  // do NOT change the counts and therefore don't auto-invalidate — callers
  // must call `clear(sourceId)` after such edits if they want fresh
  // results. The map of (sourceId, layerIndex) → null entries marks
  // layers that have been seen as empty so the no-shape fallback path
  // also short-circuits.
  private _indexCache: globalThis.Map<string, IndexedLayer> =
    new globalThis.Map();

  constructor(
    sources: globalThis.Map<string, TopologySource>,
    getTransform: () => AffineTransform,
    getSize: () => { width: number; height: number },
    getInitialMX: () => number,
  ) {
    this._sources = sources;
    this._getTransform = getTransform;
    this._getSize = getSize;
    this._getInitialMX = getInitialMX;
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
    const prefix = `${sourceId}|`;
    const stale: string[] = [];
    for (const key of this._indexCache.keys()) {
      if (key.startsWith(prefix)) stale.push(key);
    }
    for (const key of stale) this._indexCache.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Spatial index — internals
  // ---------------------------------------------------------------------------

  private _prebuildSource(sourceId: string, source: TopologySource): void {
    if (source.type !== 'topology') return;
    const layers = source.getLayers();
    const arcs = source.getArcs();
    for (let i = 0; i < layers.length; i++) {
      this._getOrBuildIndex(sourceId, i, layers[i] as MapshaperLayer, arcs);
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
  ): IndexedLayer {
    const shapes = layer?.shapes;
    if (!shapes || shapes.length === 0) return null;
    const arcsSize = arcs?.size?.() ?? 0;
    const key = `${sourceId}|${layerIndex}|${shapes.length}|${arcsSize}`;
    const cached = this._indexCache.get(key);
    if (cached !== undefined) return cached;

    // Pre-emptively drop stale entries for this (sourceId, layerIndex)
    // pair. Cheap — at most one entry per (source, layer).
    const stalePrefix = `${sourceId}|${layerIndex}|`;
    const stale: string[] = [];
    for (const k of this._indexCache.keys()) {
      if (k !== key && k.startsWith(stalePrefix)) stale.push(k);
    }
    for (const k of stale) this._indexCache.delete(k);

    const isPoint = layer.geometry_type === 'point';
    const index = new Flatbush(shapes.length);
    const partBox: number[] = [];

    for (let id = 0; id < shapes.length; id++) {
      const shp = shapes[id];
      if (!shp) {
        // Null shape: still must add an entry so flatbush ids stay aligned
        // with shape ids. Degenerate bbox at the origin won't match real
        // queries.
        index.add(0, 0, 0, 0);
        continue;
      }
      let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      if (isPoint) {
        const points = Array.isArray(shp[0]) ? (shp as unknown as number[][]) : [shp as unknown as number[]];
        for (const p of points) {
          if (!p || p.length < 2) continue;
          if (p[0] < xmin) xmin = p[0];
          if (p[0] > xmax) xmax = p[0];
          if (p[1] < ymin) ymin = p[1];
          if (p[1] > ymax) ymax = p[1];
        }
      } else if (arcs?.getSimpleShapeBbox) {
        for (let i = 0; i < shp.length; i++) {
          arcs.getSimpleShapeBbox(shp[i] as number[], partBox);
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
    }
    index.finish();
    const entry: IndexedLayer = { index, shapeCount: shapes.length };
    this._indexCache.set(key, entry);
    return entry;
  }

  query(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryRenderedFeaturesOptions,
    options?: QueryRenderedFeaturesOptions,
    visibleLayers?: Set<string>,
  ): RenderedFeatureAttributes[] {
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

  private _layerMatchesFilter(
    layer: MapshaperLayer,
    index: number,
    layers?: string[],
  ): boolean {
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
  ): HitCandidate[] {
    const cands: HitCandidate[] = [];
    const index: Record<number, HitCandidate> = {};
    const bbox: number[] = [];
    const shapes = layer.shapes;
    if (!shapes) return cands;

    // Spatial index prefilter — only iterate shapes whose stored bbox
    // overlaps `[x ± dist, y ± dist]`. The per-part inner test below is
    // unchanged so precision stays identical.
    const indexed = this._getOrBuildIndex(sourceId, layerIndex, layer, arcs);
    const candidateIds = indexed
      ? indexed.index.search(x - dist, y - dist, x + dist, y + dist)
      : null;
    const idCount = candidateIds !== null ? candidateIds.length : shapes.length;

    for (let i = 0; i < idCount; i++) {
      const shpId = candidateIds !== null ? candidateIds[i] : i;
      const shp = shapes[shpId];
      if (!shp) continue;
      for (let j = 0; j < shp.length; j++) {
        arcs.getSimpleShapeBbox!(shp[j], bbox);
        if (
          x + dist < bbox[0] ||
          x - dist > bbox[2] ||
          y + dist < bbox[1] ||
          y - dist > bbox[3]
        ) {
          continue;
        }
        let cand = index[shpId];
        if (!cand) {
          cand = index[shpId] = { shape: [], id: shpId, dist: 0 };
          cands.push(cand);
        }
        cand.shape.push(shp[j]);
      }
    }
    return cands;
  }

  private _sortByDistance(x: number, y: number, cands: HitCandidate[], arcs: ArcCollection): void {
    const geom = mapshaper.geom;
    for (const cand of cands) {
      cand.info = geom.getPointToShapeInfo(x, y, cand.shape, arcs);
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
  ): number[] {
    const geom = mapshaper.geom;
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
    const indexed = this._getOrBuildIndex(sourceId, layerIndex, layer, undefined);
    const candidateIds = indexed
      ? indexed.index.search(x - dataThresh, y - dataThresh, x + dataThresh, y + dataThresh)
      : null;
    const idCount = candidateIds !== null ? candidateIds.length : shapes.length;

    for (let i = 0; i < idCount; i++) {
      const id = candidateIds !== null ? candidateIds[i] : i;
      const shp = shapes[id];
      if (!shp) continue;
      for (const p of shp) {
        if (!p) continue;
        const dist = geom.distance2D(x, y, p[0], p[1]) * toPx;
        if (dist > hitThreshold) continue;
        if (dist < hitThreshold && hitThreshold > POINT_BULLSEYE_DIST) {
          hitThreshold = Math.max(POINT_BULLSEYE_DIST, dist);
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
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
  ): number[] {
    const maxDist = this._getZoomAdjustedHitBuffer(15, 2);
    const bufPix = bufArg >= 0 ? bufArg : 0.05;
    const bufDist = this._getZoomAdjustedHitBuffer(bufPix, 0);
    let cands = this._findHitCandidates(sourceId, layerIndex, layer, arcs, x, y, maxDist);
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
  ): number[] {
    const geom = mapshaper.geom;
    const maxDist = this._getZoomAdjustedHitBuffer(10, 1);
    const cands = this._findHitCandidates(sourceId, layerIndex, layer, arcs, x, y, maxDist);
    let hits: HitCandidate[] = [];
    for (const cand of cands) {
      if (geom.testPointInPolygon(x, y, cand.shape, arcs)) {
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
  ): number[] {
    const a = this._polygonTest(sourceId, layerIndex, layer, arcs, x, y);
    const b = this._polylineTest(sourceId, layerIndex, layer, arcs, x, y, 5);
    return a.length ? a : b;
  }

  // ---------------------------------------------------------------------------
  // Point query
  // ---------------------------------------------------------------------------

  private _queryFeaturesAtPoint(
    point: [number, number],
    options: QueryRenderedFeaturesOptions,
    visibleLayers?: Set<string>,
  ): RenderedFeatureAttributes[] {
    const transform = this._getTransform();
    const results: RenderedFeatureAttributes[] = [];
    const [mx, my] = this._unproject(point[0], point[1]);
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    for (const [sourceId, source] of this._sources) {
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();

      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex] as MapshaperLayer;
        if (!layer?.shapes) continue;
        if (!this._layerMatchesFilter(layer, layerIndex, options.layers)) continue;

        const layerId = getLayerId(layer, layerIndex);
        if (visibleLayers && !visibleLayers.has(`${sourceId}:${layerId}`)) continue;

        const geometryType = layer.geometry_type;
        let ids: number[] = [];
        if (geometryType === 'point') {
          ids = this._pointTest(sourceId, layerIndex, layer, mx, my);
        } else if (geometryType === 'polyline' && arcs) {
          ids = this._polylineTest(sourceId, layerIndex, layer, arcs, mx, my, -1);
        } else if (geometryType === 'polygon' && arcs) {
          ids = this._polygonVertexTest(sourceId, layerIndex, layer, arcs, mx, my);
        }
        if (ids.length === 0) continue;

        for (const id of ids) {
          const table = layer.data;
          const record =
            table?.getRecordAt?.(id) ?? table?.getRecords?.()?.[id] ?? {};
          results.push({
            id,
            source: sourceId,
            layer: layerId,
            geometryType: geometryType || 'unknown',
            properties: { ...record },
          });
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // BBox query
  // ---------------------------------------------------------------------------

  private _queryFeaturesInBBox(
    bbox: [[number, number], [number, number]],
    options: QueryRenderedFeaturesOptions,
    visibleLayers?: Set<string>,
  ): RenderedFeatureAttributes[] {
    const transform = this._getTransform();
    const results: RenderedFeatureAttributes[] = [];
    const [p1, p2] = bbox;
    const a = this._unproject(p1[0], p1[1]);
    const b = this._unproject(p2[0], p2[1]);
    const xmin = Math.min(a[0], b[0]);
    const ymin = Math.min(a[1], b[1]);
    const xmax = Math.max(a[0], b[0]);
    const ymax = Math.max(a[1], b[1]);
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    for (const [sourceId, source] of this._sources) {
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();

      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex] as MapshaperLayer;
        if (!layer?.shapes) continue;
        if (!this._layerMatchesFilter(layer, layerIndex, options.layers)) continue;

        const layerId = getLayerId(layer, layerIndex);
        if (visibleLayers && !visibleLayers.has(`${sourceId}:${layerId}`)) continue;

        const geometryType = layer.geometry_type;
        const table = layer.data;
        const bboxTmp: number[] = [];

        // Spatial index prefilter — `index.search` returns only shape ids
        // whose stored bbox overlaps the query bbox. Falls back to a full
        // scan for shape-less / un-indexed layers.
        const indexed = this._getOrBuildIndex(sourceId, layerIndex, layer, arcs);
        const candidateIds = indexed
          ? indexed.index.search(xmin, ymin, xmax, ymax)
          : null;
        const idCount = candidateIds !== null ? candidateIds.length : layer.shapes.length;

        for (let i = 0; i < idCount; i++) {
          const id = candidateIds !== null ? candidateIds[i] : i;
          const shp = layer.shapes[id];
          if (!shp) continue;
          let hit = false;
          if (geometryType === 'point') {
            const points = Array.isArray(shp[0]) ? shp : [shp];
            hit = points.some(
              (p: number[]) =>
                p[0] >= xmin && p[0] <= xmax && p[1] >= ymin && p[1] <= ymax,
            );
          } else if (arcs) {
            for (let i = 0; i < shp.length; i++) {
              arcs.getSimpleShapeBbox!(shp[i], bboxTmp);
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
          const record =
            table?.getRecordAt?.(id) ?? table?.getRecords?.()?.[id] ?? {};
          results.push({
            id,
            source: sourceId,
            layer: layerId,
            geometryType: geometryType || 'unknown',
            properties: { ...record },
          });
        }
      }
    }

    return results;
  }
}
