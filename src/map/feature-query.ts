import mapshaper from 'mapshaper';
import { Transform } from '../geo/transform';
import { TopologySource } from '../source/source';
import type { QueryRenderedFeaturesOptions, RenderedFeatureAttributes } from './map';

/**
 * Handles spatial feature queries (point hit-testing, bbox selection).
 * Extracted from Emap to keep the map class focused on coordination.
 */
export class FeatureQuery {
  private _sources: globalThis.Map<string, TopologySource>;
  private _getTransform: () => Transform;
  private _getSize: () => { width: number; height: number };
  private _getInitialMX: () => number;

  constructor(
    sources: globalThis.Map<string, TopologySource>,
    getTransform: () => Transform,
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
      return this._queryFeaturesAtPoint(point, opts);
    }

    const bbox = geometry as [[number, number], [number, number]];
    return this._queryFeaturesInBBox(bbox, opts);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _getLayerId(layer: any, index: number): string {
    if (layer?.name) return String(layer.name);
    if (layer?.id) return String(layer.id);
    return `layer-${index}`;
  }

  private _layerMatchesFilter(
    layer: any,
    index: number,
    layers?: string[],
  ): boolean {
    if (!layers || layers.length === 0) return true;
    const layerId = this._getLayerId(layer, index);
    if (layers.includes(layerId)) return true;
    if (layer?.name && layers.includes(layer.name)) return true;
    if (layer?.id && layers.includes(layer.id)) return true;
    return false;
  }

  private _unproject(px: number, py: number): [number, number] {
    return this._getTransform().unproject(px, py);
  }

  // ---------------------------------------------------------------------------
  // Point query (with full hit-testing logic ported from Mapshaper)
  // ---------------------------------------------------------------------------

  private _queryFeaturesAtPoint(
    point: [number, number],
    options: QueryRenderedFeaturesOptions,
  ): RenderedFeatureAttributes[] {
    const mapshaperAny: any = mapshaper as any;
    const geom = mapshaperAny.geom;
    if (!geom) return [];

    const transform = this._getTransform();
    const initialMX = this._getInitialMX();
    const results: RenderedFeatureAttributes[] = [];
    const [mx, my] = this._unproject(point[0], point[1]);
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    const getHitBuffer = (pix: number) =>
      pix / Math.abs(transform.mx || 1);
    const getZoomAdjustedHitBuffer = (pix: number, minPix: number) => {
      const scale =
        Math.abs(transform.mx) /
        (initialMX || Math.abs(transform.mx) || 1);
      if (scale < 1) pix *= scale;
      if (minPix > 0 && pix < minPix) pix = minPix;
      return getHitBuffer(pix);
    };

    const findHitCandidates = (
      layer: any,
      arcs: any,
      x: number,
      y: number,
      dist: number,
    ) => {
      const cands: any[] = [];
      const index: Record<number, any> = {};
      const bbox: number[] = [];
      layer.shapes.forEach((shp: any, shpId: number) => {
        if (!shp) return;
        for (let i = 0, n = shp.length; i < n; i++) {
          arcs.getSimpleShapeBbox(shp[i], bbox);
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
      });
      return cands;
    };

    const sortByDistance = (x: number, y: number, cands: any[], arcs: any) => {
      cands.forEach((cand) => {
        cand.info = geom.getPointToShapeInfo(x, y, cand.shape, arcs);
        cand.dist = cand.info.distance;
      });
      cands.sort((a: any, b: any) => a.dist - b.dist);
    };

    const pickNearestCandidates = (
      sorted: any[],
      bufDist: number,
      maxDist: number,
    ) => {
      const hits: any[] = [];
      let minDist = 0;
      for (let i = 0; i < sorted.length; i++) {
        const cand = sorted[i];
        if (cand.dist < maxDist !== true) {
          break;
        } else if (i === 0) {
          minDist = cand.dist;
        } else if (cand.dist - minDist > bufDist) {
          break;
        }
        hits.push(cand);
      }
      return hits;
    };

    const pointTest = (layer: any, x: number, y: number) => {
      const bullseyeDist = 2;
      let hitThreshold = 25;
      const toPx = Math.abs(transform.mx || 1);
      let bestId = -1;
      let bestDist = Infinity;

      layer.shapes.forEach((shp: any, id: number) => {
        if (!shp) return;
        shp.forEach((p: number[]) => {
          if (!p) return;
          const dist = geom.distance2D(x, y, p[0], p[1]) * toPx;
          if (dist > hitThreshold) return;
          if (dist < hitThreshold && hitThreshold > bullseyeDist) {
            hitThreshold = Math.max(bullseyeDist, dist);
          }
          if (dist < bestDist) {
            bestDist = dist;
            bestId = id;
          }
        });
      });
      return bestId === -1 ? [] : [bestId];
    };

    const polylineTest = (
      layer: any,
      arcs: any,
      x: number,
      y: number,
      bufArg: number,
    ) => {
      const maxDist = getZoomAdjustedHitBuffer(15, 2);
      const bufPix = bufArg >= 0 ? bufArg : 0.05;
      const bufDist = getZoomAdjustedHitBuffer(bufPix, 0);
      let cands = findHitCandidates(layer, arcs, x, y, maxDist);
      sortByDistance(x, y, cands, arcs);
      cands = pickNearestCandidates(cands, bufDist, maxDist);
      return cands.length ? [cands[0].id] : [];
    };

    const polygonTest = (layer: any, arcs: any, x: number, y: number) => {
      const maxDist = getZoomAdjustedHitBuffer(10, 1);
      const cands = findHitCandidates(layer, arcs, x, y, maxDist);
      let hits: any[] = [];
      cands.forEach((cand: any) => {
        if (geom.testPointInPolygon(x, y, cand.shape, arcs)) {
          hits.push(cand);
        }
      });
      if (cands.length > 0 && hits.length === 0) {
        sortByDistance(x, y, cands, arcs);
        hits = pickNearestCandidates(cands, 0, maxDist);
      } else if (hits.length > 1) {
        sortByDistance(x, y, hits, arcs);
      }
      return hits.length ? [hits[0].id] : [];
    };

    const polygonVertexTest = (layer: any, arcs: any, x: number, y: number) => {
      const a = polygonTest(layer, arcs, x, y);
      const b = polylineTest(layer, arcs, x, y, 5);
      return a.length ? a : b;
    };

    this._sources.forEach((source: TopologySource, sourceId: string) => {
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();
      layers.forEach((layer: any, layerIndex: number) => {
        if (!layer?.shapes) return;
        if (!this._layerMatchesFilter(layer, layerIndex, options.layers))
          return;
        const geometryType = layer.geometry_type;
        let ids: number[] = [];
        if (geometryType === 'point') {
          ids = pointTest(layer, mx, my);
        } else if (geometryType === 'polyline' && arcs) {
          ids = polylineTest(layer, arcs, mx, my, -1);
        } else if (geometryType === 'polygon' && arcs) {
          ids = polygonVertexTest(layer, arcs, mx, my);
        }
        if (ids.length === 0) return;
        const layerId = this._getLayerId(layer, layerIndex);
        ids.forEach((id) => {
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
        });
      });
    });

    return results;
  }

  // ---------------------------------------------------------------------------
  // BBox query
  // ---------------------------------------------------------------------------

  private _queryFeaturesInBBox(
    bbox: [[number, number], [number, number]],
    options: QueryRenderedFeaturesOptions,
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

    this._sources.forEach((source: TopologySource, sourceId: string) => {
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();
      layers.forEach((layer: any, layerIndex: number) => {
        if (!layer?.shapes) return;
        if (!this._layerMatchesFilter(layer, layerIndex, options.layers))
          return;
        const layerId = this._getLayerId(layer, layerIndex);
        const geometryType = layer.geometry_type;
        const table = layer.data;
        const bboxTmp: number[] = [];
        layer.shapes.forEach((shp: any, id: number) => {
          if (!shp) return;
          let hit = false;
          if (geometryType === 'point') {
            const points = Array.isArray(shp[0]) ? shp : [shp];
            hit = points.some(
              (p: number[]) =>
                p[0] >= xmin && p[0] <= xmax && p[1] >= ymin && p[1] <= ymax,
            );
          } else if (arcs) {
            for (let i = 0, n = shp.length; i < n; i++) {
              arcs.getSimpleShapeBbox(shp[i], bboxTmp);
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
          if (!hit) return;
          const record =
            table?.getRecordAt?.(id) ?? table?.getRecords?.()?.[id] ?? {};
          results.push({
            id,
            source: sourceId,
            layer: layerId,
            geometryType: geometryType || 'unknown',
            properties: { ...record },
          });
        });
      });
    });

    return results;
  }
}
