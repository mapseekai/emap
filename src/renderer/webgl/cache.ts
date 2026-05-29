import type { ArcCollection } from '../../types/mapshaper-types';
import Flatbush from 'flatbush';
import {
  buildArcSegmentGeometry,
  buildArcSegmentGeometryForArcIds,
  buildPointGeometry,
  buildPolygonTessellatedGeometry,
  filterArcSegmentGeometry,
  type WebGLCoordinateOrigin,
  type WebGLArcSegmentGeometry,
  type WebGLPointGeometry,
  type WebGLPolygonTessellatedGeometry,
} from './geometry';

export interface WebGLArcSegmentChunk {
  id: string;
  bbox: [number, number, number, number];
  arcIds: Uint32Array;
  geometry: WebGLArcSegmentGeometry;
}

export interface WebGLArcSegmentChunkSet {
  chunks: WebGLArcSegmentChunk[];
  search(bbox: [number, number, number, number] | number[]): WebGLArcSegmentChunk[];
}

export interface WebGLArcChunkOptions {
  targetChunkArcCount?: number;
}

interface ArcSegmentCacheRecord {
  revision: number;
  arcCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  segments: WebGLArcSegmentGeometry;
  filteredSegments: WeakMap<Uint8Array, WebGLArcSegmentGeometry>;
  filteredByFunction: WeakMap<(i: number) => boolean, WebGLArcSegmentGeometry>;
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

interface PolygonFlagCacheRecord {
  revision: number;
  arcCount: number;
  shapeCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  geometry: WebGLPolygonTessellatedGeometry;
}

interface PointCacheRecord {
  revision: number;
  shapeCount: number;
  origin: WebGLCoordinateOrigin;
  geometry: WebGLPointGeometry;
}

interface ArcChunkCacheRecord {
  revision: number;
  arcCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  allChunkSets: Map<string, WebGLArcSegmentChunkSet>;
  flaggedChunkSets: WeakMap<Uint8Array, Map<string, WebGLArcSegmentChunkSet>>;
}

const DEFAULT_TARGET_CHUNK_ARCS = 512;

export class WebGLGeometryCache {
  private _arcSegments = new WeakMap<ArcCollection, ArcSegmentCacheRecord>();
  private _polygonTessellations = new WeakMap<ArcCollection, WeakMap<any[], PolygonCacheRecord>>();
  private _polygonTessellationsByFlags = new WeakMap<ArcCollection, WeakMap<any[], WeakMap<Uint8Array, PolygonFlagCacheRecord>>>();
  private _pointGeometries = new WeakMap<any[], PointCacheRecord>();
  private _arcChunkSets = new WeakMap<ArcCollection, ArcChunkCacheRecord>();
  private _arcObjectIds = new WeakMap<ArcCollection, number>();
  private _flagObjectIds = new WeakMap<Uint8Array, number>();
  private _nextArcObjectId = 1;
  private _nextFlagObjectId = 1;

  getPointGeometry(
    shapes: any[],
    revision = 0,
    origin: WebGLCoordinateOrigin = this._getPointOrigin(shapes),
  ): WebGLPointGeometry {
    const cached = this._pointGeometries.get(shapes);
    if (
      cached &&
      cached.revision === revision &&
      cached.shapeCount === shapes.length &&
      cached.origin[0] === origin[0] &&
      cached.origin[1] === origin[1]
    ) {
      return cached.geometry;
    }

    const geometry = buildPointGeometry(shapes, origin);
    this._pointGeometries.set(shapes, {
      revision,
      shapeCount: shapes.length,
      origin,
      geometry,
    });
    return geometry;
  }

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
      filteredByFunction: new WeakMap(),
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

  getArcSegmentChunksForFlags(
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
    revision = 0,
    options: WebGLArcChunkOptions = {},
  ): WebGLArcSegmentChunkSet {
    const record = this._getArcChunkRecord(arcs, revision);
    const key = `${options.targetChunkArcCount ?? DEFAULT_TARGET_CHUNK_ARCS}`;
    const byKey = flags
      ? this._getFlaggedChunkSetMap(record, flags)
      : record.allChunkSets;
    const cached = byKey.get(key);
    if (cached) return cached;

    const arcIds = this._getSelectedArcIds(arcs, flags);
    const chunkSet = this._buildArcChunkSet(
      arcs,
      arcIds,
      record.origin,
      Math.max(1, options.targetChunkArcCount ?? DEFAULT_TARGET_CHUNK_ARCS),
      `${this._getArcObjectId(arcs)}:${flags ? this._getFlagObjectId(flags) : 0}`,
    );
    byKey.set(key, chunkSet);
    return chunkSet;
  }

  getArcSegmentsForFilter(
    arcs: ArcCollection,
    filter: (i: number) => boolean,
    revision = 0,
  ): WebGLArcSegmentGeometry {
    const base = this.getArcSegments(arcs, revision);
    const record = this._arcSegments.get(arcs);
    const cached = record?.filteredByFunction.get(filter);
    if (cached) return cached;

    const filtered = filterArcSegmentGeometry(base, filter);
    record?.filteredByFunction.set(filter, filtered);
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

  getPolygonTessellationForFlags(
    shapes: any[],
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
    revision = 0,
  ): WebGLPolygonTessellatedGeometry {
    const arcCount = arcs.size?.() ?? 0;
    if (!flags || this._flagsIncludeEveryArc(flags, arcCount)) {
      return this.getPolygonTessellation(shapes, arcs, revision);
    }

    let byShapes = this._polygonTessellationsByFlags.get(arcs);
    if (!byShapes) {
      byShapes = new WeakMap();
      this._polygonTessellationsByFlags.set(arcs, byShapes);
    }
    let byFlags = byShapes.get(shapes);
    if (!byFlags) {
      byFlags = new WeakMap();
      byShapes.set(shapes, byFlags);
    }

    const shapeCount = shapes.length;
    const pointCount = arcs.getPointCount?.() ?? 0;
    const retainedInterval = arcs.getRetainedInterval?.() ?? 0;
    const cached = byFlags.get(flags);
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
    const geometry = buildPolygonTessellatedGeometry(
      shapes,
      arcs as any,
      (i: number) => flags[i] === 1,
      origin,
    );
    byFlags.set(flags, {
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
    this._polygonTessellationsByFlags.delete(arcs);
    this._arcChunkSets.delete(arcs);
    this._arcObjectIds.delete(arcs);
  }

  invalidateAll(): void {
    this._arcSegments = new WeakMap();
    this._polygonTessellations = new WeakMap();
    this._polygonTessellationsByFlags = new WeakMap();
    this._pointGeometries = new WeakMap();
    this._arcChunkSets = new WeakMap();
    this._arcObjectIds = new WeakMap();
    this._flagObjectIds = new WeakMap();
  }

  private _flagsIncludeEveryArc(flags: Uint8Array, arcCount: number): boolean {
    if (flags.length < arcCount) return false;
    for (let i = 0; i < arcCount; i++) {
      if (flags[i] !== 1) return false;
    }
    return true;
  }

  private _getArcChunkRecord(arcs: ArcCollection, revision: number): ArcChunkCacheRecord {
    const cached = this._arcChunkSets.get(arcs);
    const arcCount = arcs.size?.() ?? 0;
    const pointCount = arcs.getPointCount?.() ?? 0;
    const retainedInterval = arcs.getRetainedInterval?.() ?? 0;
    const origin = this._getArcOrigin(arcs);
    if (
      cached &&
      cached.revision === revision &&
      cached.arcCount === arcCount &&
      cached.pointCount === pointCount &&
      cached.retainedInterval === retainedInterval &&
      cached.origin[0] === origin[0] &&
      cached.origin[1] === origin[1]
    ) {
      return cached;
    }

    const record: ArcChunkCacheRecord = {
      revision,
      arcCount,
      pointCount,
      retainedInterval,
      origin,
      allChunkSets: new Map(),
      flaggedChunkSets: new WeakMap(),
    };
    this._arcChunkSets.set(arcs, record);
    return record;
  }

  private _getFlaggedChunkSetMap(
    record: ArcChunkCacheRecord,
    flags: Uint8Array,
  ): Map<string, WebGLArcSegmentChunkSet> {
    let byKey = record.flaggedChunkSets.get(flags);
    if (!byKey) {
      byKey = new Map();
      record.flaggedChunkSets.set(flags, byKey);
    }
    return byKey;
  }

  private _getArcObjectId(arcs: ArcCollection): number {
    let id = this._arcObjectIds.get(arcs);
    if (!id) {
      id = this._nextArcObjectId++;
      this._arcObjectIds.set(arcs, id);
    }
    return id;
  }

  private _getFlagObjectId(flags: Uint8Array): number {
    let id = this._flagObjectIds.get(flags);
    if (!id) {
      id = this._nextFlagObjectId++;
      this._flagObjectIds.set(flags, id);
    }
    return id;
  }

  private _getSelectedArcIds(
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
  ): number[] {
    const arcCount = arcs.size?.() ?? 0;
    const ids: number[] = [];
    for (let i = 0; i < arcCount; i++) {
      if (!flags || flags[i] === 1) ids.push(i);
    }
    return ids;
  }

  private _buildArcChunkSet(
    arcs: ArcCollection,
    arcIds: number[],
    origin: WebGLCoordinateOrigin,
    targetChunkArcCount: number,
    idPrefix: string,
  ): WebGLArcSegmentChunkSet {
    const sorted = arcIds
      .map(arcId => ({ arcId, bbox: this._getArcBbox(arcs, arcId) }))
      .sort((a, b) => {
        const ax = (a.bbox[0] + a.bbox[2]) / 2;
        const bx = (b.bbox[0] + b.bbox[2]) / 2;
        if (ax !== bx) return ax - bx;
        return (a.bbox[1] + a.bbox[3]) - (b.bbox[1] + b.bbox[3]);
      });
    const chunks: WebGLArcSegmentChunk[] = [];
    for (let i = 0; i < sorted.length; i += targetChunkArcCount) {
      const group = sorted.slice(i, i + targetChunkArcCount);
      const ids = group.map(item => item.arcId);
      const bbox = this._unionBboxes(group.map(item => item.bbox));
      chunks.push({
        id: `${idPrefix}:${chunks.length}`,
        bbox,
        arcIds: new Uint32Array(ids),
        geometry: buildArcSegmentGeometryForArcIds(arcs, ids, origin),
      });
    }
    const index = new Flatbush(chunks.length);
    for (const chunk of chunks) {
      index.add(chunk.bbox[0], chunk.bbox[1], chunk.bbox[2], chunk.bbox[3]);
    }
    index.finish();
    return {
      chunks,
      search(bbox: [number, number, number, number] | number[]) {
        return index.search(bbox[0], bbox[1], bbox[2], bbox[3])
          .map((i: number) => chunks[i]);
      },
    };
  }

  private _getArcBbox(arcs: ArcCollection, arcId: number): [number, number, number, number] {
    const bb = arcs.getVertexData?.()?.bb;
    if (bb && bb.length >= arcId * 4 + 4) {
      const i = arcId * 4;
      return [bb[i], bb[i + 1], bb[i + 2], bb[i + 3]];
    }
    const iter = arcs.getArcIter(arcId);
    let xmin = Infinity;
    let ymin = Infinity;
    let xmax = -Infinity;
    let ymax = -Infinity;
    while (iter.hasNext()) {
      if (iter.x < xmin) xmin = iter.x;
      if (iter.y < ymin) ymin = iter.y;
      if (iter.x > xmax) xmax = iter.x;
      if (iter.y > ymax) ymax = iter.y;
    }
    if (xmin === Infinity) return [0, 0, 0, 0];
    return [xmin, ymin, xmax, ymax];
  }

  private _unionBboxes(
    boxes: Array<[number, number, number, number]>,
  ): [number, number, number, number] {
    let xmin = Infinity;
    let ymin = Infinity;
    let xmax = -Infinity;
    let ymax = -Infinity;
    for (const bbox of boxes) {
      if (bbox[0] < xmin) xmin = bbox[0];
      if (bbox[1] < ymin) ymin = bbox[1];
      if (bbox[2] > xmax) xmax = bbox[2];
      if (bbox[3] > ymax) ymax = bbox[3];
    }
    if (xmin === Infinity) return [0, 0, 0, 0];
    return [xmin, ymin, xmax, ymax];
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

  private _getPointOrigin(shapes: any[]): WebGLCoordinateOrigin {
    for (const shape of shapes) {
      if (!shape) continue;
      if (typeof shape[0] === 'number' && typeof shape[1] === 'number') {
        return [shape[0], shape[1]];
      }
      for (const point of shape) {
        if (point && typeof point[0] === 'number' && typeof point[1] === 'number') {
          return [point[0], point[1]];
        }
      }
    }
    return [0, 0];
  }
}
