import mapshaper from 'mapshaper';
import { AffineTransform } from '../geo/transform';
import { TopologySource } from '../source/source';
import { getLayerId } from '../source/layer-utils';
import type { QueryRenderedFeaturesOptions, RenderedFeatureAttributes } from './map';
import type { ArcCollection, MapshaperLayer } from '../types/mapshaper-types';

/** Pixel distance for a bullseye hit on point features */
const POINT_BULLSEYE_DIST = 2;

/** Default pixel threshold for point hit-testing */
const POINT_HIT_THRESHOLD = 25;

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

    for (let shpId = 0; shpId < shapes.length; shpId++) {
      const shp = shapes[shpId];
      if (!shp) continue;
      for (let i = 0; i < shp.length; i++) {
        arcs.getSimpleShapeBbox!(shp[i], bbox);
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
        cand.shape.push(shp[i]);
      }
    }
    return cands;
  }

  private _sortByDistance(x: number, y: number, cands: HitCandidate[], arcs: ArcCollection): void {
    const geom = (mapshaper as any).geom;
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

  private _pointTest(layer: MapshaperLayer, x: number, y: number): number[] {
    const geom = (mapshaper as any).geom;
    const toPx = Math.abs(this._getTransform().mx || 1);
    let bestId = -1;
    let bestDist = Infinity;
    let hitThreshold = POINT_HIT_THRESHOLD;
    const shapes = layer.shapes;
    if (!shapes) return [];

    for (let id = 0; id < shapes.length; id++) {
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
    layer: MapshaperLayer,
    arcs: ArcCollection,
    x: number,
    y: number,
    bufArg: number,
  ): number[] {
    const maxDist = this._getZoomAdjustedHitBuffer(15, 2);
    const bufPix = bufArg >= 0 ? bufArg : 0.05;
    const bufDist = this._getZoomAdjustedHitBuffer(bufPix, 0);
    let cands = this._findHitCandidates(layer, arcs, x, y, maxDist);
    this._sortByDistance(x, y, cands, arcs);
    cands = this._pickNearestCandidates(cands, bufDist, maxDist);
    return cands.length ? [cands[0].id] : [];
  }

  private _polygonTest(layer: MapshaperLayer, arcs: ArcCollection, x: number, y: number): number[] {
    const geom = (mapshaper as any).geom;
    const maxDist = this._getZoomAdjustedHitBuffer(10, 1);
    const cands = this._findHitCandidates(layer, arcs, x, y, maxDist);
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

  private _polygonVertexTest(layer: MapshaperLayer, arcs: ArcCollection, x: number, y: number): number[] {
    const a = this._polygonTest(layer, arcs, x, y);
    const b = this._polylineTest(layer, arcs, x, y, 5);
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
          ids = this._pointTest(layer, mx, my);
        } else if (geometryType === 'polyline' && arcs) {
          ids = this._polylineTest(layer, arcs, mx, my, -1);
        } else if (geometryType === 'polygon' && arcs) {
          ids = this._polygonVertexTest(layer, arcs, mx, my);
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

        for (let id = 0; id < layer.shapes.length; id++) {
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
