import type { ArcCollection } from '../../types/mapshaper-types';
import {
  buildArcSegmentGeometry,
  buildPolygonTessellatedGeometry,
  filterArcSegmentGeometry,
  type WebGLCoordinateOrigin,
  type WebGLArcSegmentGeometry,
  type WebGLPolygonTessellatedGeometry,
} from './geometry';

interface ArcSegmentCacheRecord {
  revision: number;
  arcCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  segments: WebGLArcSegmentGeometry;
  filteredSegments: WeakMap<Uint8Array, WebGLArcSegmentGeometry>;
}

interface PolygonCacheRecord {
  revision: number;
  arcCount: number;
  shapeCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  geometry: WebGLPolygonTessellatedGeometry;
}

export class WebGLGeometryCache {
  private _arcSegments = new WeakMap<ArcCollection, ArcSegmentCacheRecord>();
  private _polygonTessellations = new WeakMap<ArcCollection, WeakMap<any[], PolygonCacheRecord>>();

  getArcSegments(
    arcs: ArcCollection,
    revision = 0,
    origin: WebGLCoordinateOrigin = this._getArcOrigin(arcs),
  ): WebGLArcSegmentGeometry {
    const cached = this._arcSegments.get(arcs);
    const arcCount = arcs.size?.() ?? 0;
    const pointCount = arcs.getPointCount?.() ?? 0;
    const retainedInterval = arcs.getRetainedInterval?.() ?? 0;
    if (
      cached &&
      cached.revision === revision &&
      cached.arcCount === arcCount &&
      cached.pointCount === pointCount &&
      cached.retainedInterval === retainedInterval &&
      cached.origin[0] === origin[0] &&
      cached.origin[1] === origin[1]
    ) {
      return cached.segments;
    }

    const segments = buildArcSegmentGeometry(arcs, undefined, origin);
    this._arcSegments.set(arcs, {
      revision,
      arcCount,
      pointCount,
      retainedInterval,
      origin,
      segments,
      filteredSegments: new WeakMap(),
    });
    return segments;
  }

  getArcSegmentsForFlags(
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
    revision = 0,
  ): WebGLArcSegmentGeometry {
    const base = this.getArcSegments(arcs, revision);
    if (!flags || this._flagsIncludeEveryArc(flags, base.arcSegmentStarts.length)) {
      return base;
    }

    const cached = this._arcSegments.get(arcs)?.filteredSegments.get(flags);
    if (cached) return cached;

    const filtered = filterArcSegmentGeometry(base, i => flags[i] === 1);
    this._arcSegments.get(arcs)?.filteredSegments.set(flags, filtered);
    return filtered;
  }

  getPolygonTessellation(
    shapes: any[],
    arcs: ArcCollection,
    revision = 0,
  ): WebGLPolygonTessellatedGeometry {
    let byShapes = this._polygonTessellations.get(arcs);
    if (!byShapes) {
      byShapes = new WeakMap();
      this._polygonTessellations.set(arcs, byShapes);
    }

    const arcCount = arcs.size?.() ?? 0;
    const shapeCount = shapes.length;
    const pointCount = arcs.getPointCount?.() ?? 0;
    const retainedInterval = arcs.getRetainedInterval?.() ?? 0;
    const cached = byShapes.get(shapes);
    if (
      cached &&
      cached.revision === revision &&
      cached.arcCount === arcCount &&
      cached.shapeCount === shapeCount &&
      cached.pointCount === pointCount &&
      cached.retainedInterval === retainedInterval
    ) {
      return cached.geometry;
    }

    const origin = this._getArcOrigin(arcs);
    const geometry = buildPolygonTessellatedGeometry(shapes, arcs as any, undefined, origin);
    byShapes.set(shapes, {
      revision,
      arcCount,
      shapeCount,
      pointCount,
      retainedInterval,
      origin,
      geometry,
    });
    return geometry;
  }

  invalidateArcs(arcs: ArcCollection): void {
    this._arcSegments.delete(arcs);
    this._polygonTessellations.delete(arcs);
  }

  invalidateAll(): void {
    this._arcSegments = new WeakMap();
    this._polygonTessellations = new WeakMap();
  }

  private _flagsIncludeEveryArc(flags: Uint8Array, arcCount: number): boolean {
    if (flags.length < arcCount) return false;
    for (let i = 0; i < arcCount; i++) {
      if (flags[i] !== 1) return false;
    }
    return true;
  }

  private _getArcOrigin(arcs: ArcCollection): WebGLCoordinateOrigin {
    const vertices = arcs.getVertexData?.();
    if (vertices && vertices.xx.length > 0 && vertices.yy.length > 0) {
      return [vertices.xx[0], vertices.yy[0]];
    }
    const bounds = (arcs as ArcCollection & { getBounds?: () => { toArray?: () => number[]; xmin?: number; ymin?: number } }).getBounds?.();
    if (bounds) {
      const bbox = bounds.toArray?.();
      if (bbox && bbox.length >= 2) return [bbox[0], bbox[1]];
      if (typeof bounds.xmin === 'number' && typeof bounds.ymin === 'number') {
        return [bounds.xmin, bounds.ymin];
      }
    }
    return [0, 0];
  }
}
