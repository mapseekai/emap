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

export interface WebGLPolygonTessellationChunk {
  id: string;
  bbox: [number, number, number, number];
  featureIds: Uint32Array;
  geometry: WebGLPolygonTessellatedGeometry;
}

export interface WebGLPolygonTessellationChunkSet {
  chunks: WebGLPolygonTessellationChunk[];
  search(bbox: [number, number, number, number] | number[]): WebGLPolygonTessellationChunk[];
}

export interface WebGLArcChunkOptions {
  targetChunkArcCount?: number;
  async?: boolean;
  minArcCount?: number;
}

export interface WebGLPolygonTessellationOptions {
  async?: boolean;
  minPointCount?: number;
  targetChunkFeatureCount?: number;
  maxChunkRequests?: number;
  maxCachedChunks?: number;
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

export interface WebGLPointGeometryWorker {
  buildPointGeometry(
    shapes: any[],
    origin: WebGLCoordinateOrigin,
  ): Promise<WebGLPointGeometry>;
}

export interface WebGLArcChunkGeometryWorker {
  buildArcSegmentChunks(args: {
    vertexData: WebGLArcChunkWorkerVertexData;
    arcIds: Uint32Array;
    origin: WebGLCoordinateOrigin;
    targetChunkArcCount: number;
    idPrefix: string;
  }): Promise<WebGLArcSegmentChunk[]>;
}

export interface WebGLPolygonTessellationWorker {
  buildPolygonTessellation(args: {
    shapes: any[];
    vertexData: WebGLArcChunkWorkerVertexData;
    flags?: Uint8Array | null;
    origin: WebGLCoordinateOrigin;
  }): Promise<WebGLPolygonTessellatedGeometry>;
  registerSourceSnapshot?(snapshot: {
    id: string;
    shapes: any[];
    vertexData: WebGLArcChunkWorkerVertexData;
  }): Promise<void>;
  registerPolygonMask?(mask: {
    id: string;
    flags: Uint8Array;
  }): Promise<void>;
  buildPolygonChunk?(args: {
    snapshotId: string;
    chunkId: string;
    featureIds: Uint32Array;
    flags?: Uint8Array | null;
    flagsId?: string | null;
    origin: WebGLCoordinateOrigin;
  }): Promise<WebGLPolygonTessellatedGeometry>;
  clearRetainedGeometry?(): Promise<void>;
}

export interface WebGLRenderGeometryWorker
  extends WebGLPointGeometryWorker,
    WebGLArcChunkGeometryWorker,
    WebGLPolygonTessellationWorker {}

export interface WebGLArcChunkWorkerVertexData {
  xx: Float64Array;
  yy: Float64Array;
  nn: Int32Array | Uint32Array;
  ii: Int32Array | Uint32Array;
  bb?: Float64Array | null;
}

export interface WebGLGeometryCacheOptions {
  pointWorker?: WebGLPointGeometryWorker | null;
  arcChunkWorker?: WebGLArcChunkGeometryWorker | null;
  polygonWorker?: WebGLPolygonTessellationWorker | null;
  onGeometryReady?: () => void;
}

export interface WebGLPointGeometryOptions {
  async?: boolean;
  minPointCount?: number;
}

interface PendingPointCacheRecord {
  revision: number;
  shapeCount: number;
  origin: WebGLCoordinateOrigin;
  epoch: number;
}

interface PendingArcChunkCacheRecord {
  revision: number;
  arcCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
}

interface PendingPolygonCacheRecord {
  revision: number;
  arcCount: number;
  shapeCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  epoch: number;
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

interface PolygonChunkCacheRecord {
  revision: number;
  arcCount: number;
  shapeCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  chunks: PolygonChunkRecord[];
  index: SpatialIndex;
}

interface PolygonChunkRecord {
  id: string;
  bbox: [number, number, number, number];
  featureIds: Uint32Array;
  geometry: WebGLPolygonTessellatedGeometry | null;
}

interface PendingPolygonChunkCacheRecord {
  revision: number;
  arcCount: number;
  shapeCount: number;
  pointCount: number;
  retainedInterval: number;
  origin: WebGLCoordinateOrigin;
  epoch: number;
}

interface SpatialIndex {
  search(minX: number, minY: number, maxX: number, maxY: number): number[];
}

const DEFAULT_TARGET_CHUNK_ARCS = 512;
const DEFAULT_TARGET_CHUNK_FEATURES = 256;
const DEFAULT_MAX_POLYGON_CHUNK_REQUESTS = 4;
const DEFAULT_MAX_POLYGON_CACHED_CHUNKS = 256;
const EMPTY_POINT_GEOMETRY: WebGLPointGeometry = {
  positions: new Float32Array(),
  vertexCount: 0,
  origin: [0, 0],
};
const EMPTY_ARC_CHUNK_SET: WebGLArcSegmentChunkSet = {
  chunks: [],
  search: () => [],
};
const EMPTY_POLYGON_TESSELLATION: WebGLPolygonTessellatedGeometry = {
  positions: new Float32Array(),
  indices: new Uint32Array(),
  vertexCount: 0,
  origin: [0, 0],
};

function makeSequentialIds(length: number): Uint32Array {
  const ids = new Uint32Array(length);
  for (let i = 0; i < length; i++) ids[i] = i;
  return ids;
}

export class WebGLGeometryCache {
  private _arcSegments = new WeakMap<ArcCollection, ArcSegmentCacheRecord>();
  private _polygonTessellations = new WeakMap<ArcCollection, WeakMap<any[], PolygonCacheRecord>>();
  private _polygonTessellationsByFlags = new WeakMap<ArcCollection, WeakMap<any[], WeakMap<Uint8Array, PolygonFlagCacheRecord>>>();
  private _pointGeometries = new WeakMap<any[], PointCacheRecord>();
  private _arcChunkSets = new WeakMap<ArcCollection, ArcChunkCacheRecord>();
  private _arcObjectIds = new WeakMap<ArcCollection, number>();
  private _flagObjectIds = new WeakMap<Uint8Array, number>();
  private _shapeObjectIds = new WeakMap<any[], number>();
  private _pendingPointGeometries = new WeakMap<any[], PendingPointCacheRecord>();
  private _pendingArcChunkSets = new Map<string, PendingArcChunkCacheRecord>();
  private _pendingPolygonTessellations = new Map<string, PendingPolygonCacheRecord>();
  private _polygonChunkSets = new Map<string, PolygonChunkCacheRecord>();
  private _pendingPolygonChunks = new Map<string, PendingPolygonChunkCacheRecord>();
  private _registeredPolygonSnapshots = new Set<string>();
  private _pendingPolygonSnapshotRegistrations = new Map<string, Promise<void>>();
  private _registeredPolygonMasks = new Set<string>();
  private _pendingPolygonMaskRegistrations = new Map<string, Promise<void>>();
  private _pointCacheEpoch = 0;
  private _polygonCacheEpoch = 0;
  private _nextArcObjectId = 1;
  private _nextFlagObjectId = 1;
  private _nextShapeObjectId = 1;

  constructor(private _options: WebGLGeometryCacheOptions = {}) {}

  getPointGeometry(
    shapes: any[],
    revision = 0,
    origin: WebGLCoordinateOrigin = this._getPointOrigin(shapes),
    options: WebGLPointGeometryOptions = {},
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

    if (options.async && this._options.pointWorker) {
      const pointCount = this._countPoints(shapes);
      if (pointCount >= (options.minPointCount ?? 0)) {
        this._requestPointGeometry(shapes, revision, origin);
        return cached?.geometry ?? {
          ...EMPTY_POINT_GEOMETRY,
          origin,
        };
      }
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
    if (options.async && this._options.arcChunkWorker) {
      const minArcCount = options.minArcCount ?? 0;
      if (arcIds.length >= minArcCount && this._requestArcChunkSet(
        arcs,
        arcIds,
        record,
        Math.max(1, options.targetChunkArcCount ?? DEFAULT_TARGET_CHUNK_ARCS),
        `${this._getArcObjectId(arcs)}:${flags ? this._getFlagObjectId(flags) : 0}`,
        key,
        byKey,
      )) {
        return EMPTY_ARC_CHUNK_SET;
      }
    }

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
    options: WebGLPolygonTessellationOptions = {},
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
    const origin = this._getArcOrigin(arcs);
    if (
      cached &&
      cached.revision === revision &&
      cached.arcCount === arcCount &&
      cached.shapeCount === shapeCount &&
      cached.pointCount === pointCount &&
      cached.retainedInterval === retainedInterval &&
      cached.origin[0] === origin[0] &&
      cached.origin[1] === origin[1]
    ) {
      return cached.geometry;
    }

    if (
      options.async &&
      this._options.polygonWorker &&
      pointCount >= (options.minPointCount ?? 0) &&
      this._requestPolygonTessellation(
        shapes,
        arcs,
        null,
        revision,
        origin,
        `full:${this._getArcObjectId(arcs)}`,
        geometry => {
          byShapes.set(shapes, {
            revision,
            arcCount,
            shapeCount,
            pointCount,
            retainedInterval,
            origin,
            geometry,
          });
        },
      )
    ) {
      return cached?.geometry ?? { ...EMPTY_POLYGON_TESSELLATION, origin };
    }

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
    options: WebGLPolygonTessellationOptions = {},
  ): WebGLPolygonTessellatedGeometry {
    const arcCount = arcs.size?.() ?? 0;
    if (!flags || this._flagsIncludeEveryArc(flags, arcCount)) {
      return this.getPolygonTessellation(shapes, arcs, revision, options);
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
    const origin = this._getArcOrigin(arcs);
    if (
      cached &&
      cached.revision === revision &&
      cached.arcCount === arcCount &&
      cached.shapeCount === shapeCount &&
      cached.pointCount === pointCount &&
      cached.retainedInterval === retainedInterval &&
      cached.origin[0] === origin[0] &&
      cached.origin[1] === origin[1]
    ) {
      return cached.geometry;
    }

    if (
      options.async &&
      this._options.polygonWorker &&
      pointCount >= (options.minPointCount ?? 0) &&
      this._requestPolygonTessellation(
        shapes,
        arcs,
        flags,
        revision,
        origin,
        `flags:${this._getArcObjectId(arcs)}:${this._getFlagObjectId(flags)}`,
        geometry => {
          byFlags.set(flags, {
            revision,
            arcCount,
            shapeCount,
            pointCount,
            retainedInterval,
            origin,
            geometry,
          });
        },
      )
    ) {
      return cached?.geometry ?? { ...EMPTY_POLYGON_TESSELLATION, origin };
    }

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

  getPolygonTessellationChunksForFlags(
    shapes: any[],
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
    revision = 0,
    viewportBBox: [number, number, number, number] | number[] | null = null,
    options: WebGLPolygonTessellationOptions = {},
  ): WebGLPolygonTessellationChunkSet {
    const targetChunkFeatureCount = Math.max(
      1,
      options.targetChunkFeatureCount ?? DEFAULT_TARGET_CHUNK_FEATURES,
    );
    const arcCount = arcs.size?.() ?? 0;
    const shapeCount = shapes.length;
    const pointCount = arcs.getPointCount?.() ?? 0;
    const retainedInterval = arcs.getRetainedInterval?.() ?? 0;
    const origin = this._getArcOrigin(arcs);
    const key = [
      'polygon-chunks',
      this._getArcObjectId(arcs),
      this._getShapeObjectId(shapes),
      flags ? this._getFlagObjectId(flags) : 0,
      targetChunkFeatureCount,
    ].join(':');
    let record = this._polygonChunkSets.get(key);
    if (
      !record ||
      record.revision !== revision ||
      record.arcCount !== arcCount ||
      record.shapeCount !== shapeCount ||
      record.pointCount !== pointCount ||
      record.retainedInterval !== retainedInterval ||
      record.origin[0] !== origin[0] ||
      record.origin[1] !== origin[1]
    ) {
      record = this._buildPolygonChunkRecord(
        shapes,
        arcs,
        flags,
        revision,
        arcCount,
        shapeCount,
        pointCount,
        retainedInterval,
        origin,
        targetChunkFeatureCount,
        key,
      );
      this._polygonChunkSets.set(key, record);
    }

    const maxCachedChunks = Math.max(
      1,
      options.maxCachedChunks ?? DEFAULT_MAX_POLYGON_CACHED_CHUNKS,
    );
    const visibleRecords = this._searchPolygonChunkRecords(record, viewportBBox)
      .slice(0, maxCachedChunks);
    if (
      options.async &&
      this._options.polygonWorker?.registerSourceSnapshot &&
      this._options.polygonWorker.buildPolygonChunk &&
      pointCount >= (options.minPointCount ?? 0)
    ) {
      const vertexData = this._getArcChunkWorkerVertexData(arcs);
      if (vertexData) {
        let requestCount = 0;
        const maxChunkRequests = Math.max(
          1,
          options.maxChunkRequests ?? DEFAULT_MAX_POLYGON_CHUNK_REQUESTS,
        );
        for (const chunk of visibleRecords) {
          if (requestCount >= maxChunkRequests) break;
          if (!chunk.geometry) {
            const requested = this._requestPolygonChunkGeometry(
              shapes,
              arcs,
              vertexData,
              flags,
              record,
              chunk,
              key,
            );
            if (requested) requestCount++;
          }
        }
      }
    } else {
      for (const chunk of visibleRecords) {
        if (!chunk.geometry) {
          const chunkShapes = this._getShapesByFeatureIds(shapes, chunk.featureIds);
          chunk.geometry = buildPolygonTessellatedGeometry(
            chunkShapes,
            arcs as any,
            flags ? (i: number) => flags[i] === 1 : undefined,
            origin,
          );
        }
      }
    }

    return this._buildPolygonChunkSetFromRecords(
      visibleRecords.filter(chunk => chunk.geometry),
    );
  }

  invalidateArcs(arcs: ArcCollection): void {
    this._arcSegments.delete(arcs);
    this._polygonTessellations.delete(arcs);
    this._polygonTessellationsByFlags.delete(arcs);
    this._arcChunkSets.delete(arcs);
    this._arcObjectIds.delete(arcs);
    this._polygonChunkSets.clear();
    this._pendingPolygonChunks.clear();
  }

  invalidateAll(): void {
    this._arcSegments = new WeakMap();
    this._polygonTessellations = new WeakMap();
    this._polygonTessellationsByFlags = new WeakMap();
    this._pointGeometries = new WeakMap();
    this._pendingPointGeometries = new WeakMap();
    this._pendingArcChunkSets.clear();
    this._pendingPolygonTessellations.clear();
    this._polygonChunkSets.clear();
    this._pendingPolygonChunks.clear();
    this._pointCacheEpoch++;
    this._polygonCacheEpoch++;
    this._arcChunkSets = new WeakMap();
    this._arcObjectIds = new WeakMap();
    this._flagObjectIds = new WeakMap();
    this._shapeObjectIds = new WeakMap();
    this._registeredPolygonSnapshots.clear();
    this._pendingPolygonSnapshotRegistrations.clear();
    this._registeredPolygonMasks.clear();
    this._pendingPolygonMaskRegistrations.clear();
    void this._options.polygonWorker?.clearRetainedGeometry?.().catch(() => {});
  }

  private _requestPointGeometry(
    shapes: any[],
    revision: number,
    origin: WebGLCoordinateOrigin,
  ): void {
    const shapeCount = shapes.length;
    const pending = this._pendingPointGeometries.get(shapes);
    if (
      pending &&
      pending.revision === revision &&
      pending.shapeCount === shapeCount &&
      pending.origin[0] === origin[0] &&
      pending.origin[1] === origin[1] &&
      pending.epoch === this._pointCacheEpoch
    ) {
      return;
    }

    const epoch = this._pointCacheEpoch;
    this._pendingPointGeometries.set(shapes, {
      revision,
      shapeCount,
      origin,
      epoch,
    });
    this._options.pointWorker?.buildPointGeometry(shapes, origin).then((geometry) => {
      const latest = this._pendingPointGeometries.get(shapes);
      if (
        !latest ||
        latest.revision !== revision ||
        latest.shapeCount !== shapeCount ||
        latest.origin[0] !== origin[0] ||
        latest.origin[1] !== origin[1] ||
        latest.epoch !== epoch ||
        epoch !== this._pointCacheEpoch
      ) {
        return;
      }
      this._pointGeometries.set(shapes, {
        revision,
        shapeCount,
        origin,
        geometry,
      });
      this._pendingPointGeometries.delete(shapes);
      this._options.onGeometryReady?.();
    }).catch(() => {
      const latest = this._pendingPointGeometries.get(shapes);
      if (latest?.revision === revision && latest.epoch === epoch) {
        this._pendingPointGeometries.delete(shapes);
      }
    });
  }

  private _requestArcChunkSet(
    arcs: ArcCollection,
    arcIds: number[],
    record: ArcChunkCacheRecord,
    targetChunkArcCount: number,
    idPrefix: string,
    key: string,
    byKey: Map<string, WebGLArcSegmentChunkSet>,
  ): boolean {
    const vertexData = this._getArcChunkWorkerVertexData(arcs);
    if (!vertexData) return false;

    const pendingKey = `${idPrefix}:${key}`;
    const pending = this._pendingArcChunkSets.get(pendingKey);
    if (
      pending &&
      pending.revision === record.revision &&
      pending.arcCount === record.arcCount &&
      pending.pointCount === record.pointCount &&
      pending.retainedInterval === record.retainedInterval &&
      pending.origin[0] === record.origin[0] &&
      pending.origin[1] === record.origin[1]
    ) {
      return true;
    }

    this._pendingArcChunkSets.set(pendingKey, {
      revision: record.revision,
      arcCount: record.arcCount,
      pointCount: record.pointCount,
      retainedInterval: record.retainedInterval,
      origin: record.origin,
    });
    this._options.arcChunkWorker?.buildArcSegmentChunks({
      vertexData,
      arcIds: new Uint32Array(arcIds),
      origin: record.origin,
      targetChunkArcCount,
      idPrefix,
    }).then((chunks) => {
      const latest = this._pendingArcChunkSets.get(pendingKey);
      if (
        !latest ||
        latest.revision !== record.revision ||
        latest.arcCount !== record.arcCount ||
        latest.pointCount !== record.pointCount ||
        latest.retainedInterval !== record.retainedInterval ||
        latest.origin[0] !== record.origin[0] ||
        latest.origin[1] !== record.origin[1]
      ) {
        return;
      }
      byKey.set(key, this._buildArcChunkSetFromChunks(chunks));
      this._pendingArcChunkSets.delete(pendingKey);
      this._options.onGeometryReady?.();
    }).catch(() => {
      this._pendingArcChunkSets.delete(pendingKey);
    });
    return true;
  }

  private _requestPolygonTessellation(
    shapes: any[],
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
    revision: number,
    origin: WebGLCoordinateOrigin,
    keyPrefix: string,
    setGeometry: (geometry: WebGLPolygonTessellatedGeometry) => void,
  ): boolean {
    const vertexData = this._getArcChunkWorkerVertexData(arcs);
    if (!vertexData) return false;

    const arcCount = arcs.size?.() ?? 0;
    const shapeCount = shapes.length;
    const pointCount = arcs.getPointCount?.() ?? 0;
    const retainedInterval = arcs.getRetainedInterval?.() ?? 0;
    const epoch = this._polygonCacheEpoch;
    const key = `${keyPrefix}:${revision}:${shapeCount}:${pointCount}:${retainedInterval}:${origin[0]}:${origin[1]}`;
    const pending = this._pendingPolygonTessellations.get(key);
    if (pending?.epoch === epoch) return true;

    this._pendingPolygonTessellations.set(key, {
      revision,
      arcCount,
      shapeCount,
      pointCount,
      retainedInterval,
      origin,
      epoch,
    });
    const polygonWorker = this._options.polygonWorker;
    const buildPromise = polygonWorker?.registerSourceSnapshot && polygonWorker.buildPolygonChunk
      ? this._requestPolygonChunkFromSnapshot(
        shapes,
        arcs,
        vertexData,
        revision,
        retainedInterval,
        origin,
        flags,
      )
      : polygonWorker?.buildPolygonTessellation({
        shapes,
        vertexData,
        flags,
        origin,
      });
    buildPromise?.then((geometry) => {
      const latest = this._pendingPolygonTessellations.get(key);
      if (
        !latest ||
        latest.revision !== revision ||
        latest.arcCount !== arcCount ||
        latest.shapeCount !== shapeCount ||
        latest.pointCount !== pointCount ||
        latest.retainedInterval !== retainedInterval ||
        latest.origin[0] !== origin[0] ||
        latest.origin[1] !== origin[1] ||
        latest.epoch !== epoch ||
        epoch !== this._polygonCacheEpoch
      ) {
        return;
      }
      setGeometry(geometry);
      this._pendingPolygonTessellations.delete(key);
      this._options.onGeometryReady?.();
    }).catch(() => {
      this._pendingPolygonTessellations.delete(key);
    });
    return true;
  }

  private _requestPolygonChunkFromSnapshot(
    shapes: any[],
    arcs: ArcCollection,
    vertexData: WebGLArcChunkWorkerVertexData,
    revision: number,
    retainedInterval: number,
    origin: WebGLCoordinateOrigin,
    flags: Uint8Array | null | undefined,
  ): Promise<WebGLPolygonTessellatedGeometry> {
    const snapshotId = this._getPolygonSnapshotId(
      shapes,
      arcs,
      revision,
      retainedInterval,
      origin,
    );
    return Promise.all([
      this._ensurePolygonSnapshotRegistered(snapshotId, shapes, vertexData),
      this._ensurePolygonMaskRegistered(flags),
    ]).then(([, flagsId]) => this._options.polygonWorker!.buildPolygonChunk!({
        snapshotId,
        chunkId: 'all',
        featureIds: makeSequentialIds(shapes.length),
        flags: flagsId ? undefined : flags,
        flagsId,
        origin,
      }));
  }

  private _requestPolygonChunkGeometry(
    shapes: any[],
    arcs: ArcCollection,
    vertexData: WebGLArcChunkWorkerVertexData,
    flags: Uint8Array | null | undefined,
    record: PolygonChunkCacheRecord,
    chunk: PolygonChunkRecord,
    recordKey: string,
  ): boolean {
    const snapshotId = this._getPolygonSnapshotId(
      shapes,
      arcs,
      record.revision,
      record.retainedInterval,
      record.origin,
    );
    const pendingKey = `${recordKey}:${chunk.id}`;
    const epoch = this._polygonCacheEpoch;
    const pending = this._pendingPolygonChunks.get(pendingKey);
    if (
      pending &&
      pending.revision === record.revision &&
      pending.arcCount === record.arcCount &&
      pending.shapeCount === record.shapeCount &&
      pending.pointCount === record.pointCount &&
      pending.retainedInterval === record.retainedInterval &&
      pending.origin[0] === record.origin[0] &&
      pending.origin[1] === record.origin[1] &&
      pending.epoch === epoch
    ) {
      return true;
    }

    this._pendingPolygonChunks.set(pendingKey, {
      revision: record.revision,
      arcCount: record.arcCount,
      shapeCount: record.shapeCount,
      pointCount: record.pointCount,
      retainedInterval: record.retainedInterval,
      origin: record.origin,
      epoch,
    });
    Promise.all([
      this._ensurePolygonSnapshotRegistered(snapshotId, shapes, vertexData),
      this._ensurePolygonMaskRegistered(flags),
    ])
      .then(([, flagsId]) => this._options.polygonWorker!.buildPolygonChunk!({
        snapshotId,
        chunkId: chunk.id,
        featureIds: chunk.featureIds,
        flags: flagsId ? undefined : flags,
        flagsId,
        origin: record.origin,
      }))
      .then((geometry) => {
        const latest = this._pendingPolygonChunks.get(pendingKey);
        if (
          !latest ||
          latest.revision !== record.revision ||
          latest.arcCount !== record.arcCount ||
          latest.shapeCount !== record.shapeCount ||
          latest.pointCount !== record.pointCount ||
          latest.retainedInterval !== record.retainedInterval ||
          latest.origin[0] !== record.origin[0] ||
          latest.origin[1] !== record.origin[1] ||
          latest.epoch !== epoch ||
          epoch !== this._polygonCacheEpoch ||
          this._polygonChunkSets.get(recordKey) !== record
        ) {
          return;
        }
        chunk.geometry = geometry;
        this._pendingPolygonChunks.delete(pendingKey);
        this._options.onGeometryReady?.();
      })
      .catch(() => {
        this._pendingPolygonChunks.delete(pendingKey);
      });
    return true;
  }

  private _ensurePolygonSnapshotRegistered(
    snapshotId: string,
    shapes: any[],
    vertexData: WebGLArcChunkWorkerVertexData,
  ): Promise<void> {
    if (this._registeredPolygonSnapshots.has(snapshotId)) return Promise.resolve();
    const pending = this._pendingPolygonSnapshotRegistrations.get(snapshotId);
    if (pending) return pending;

    const register = this._options.polygonWorker!.registerSourceSnapshot!({
      id: snapshotId,
      shapes,
      vertexData,
    }).then(() => {
      this._pendingPolygonSnapshotRegistrations.delete(snapshotId);
      this._registeredPolygonSnapshots.add(snapshotId);
    }).catch((err) => {
      this._pendingPolygonSnapshotRegistrations.delete(snapshotId);
      throw err;
    });
    this._pendingPolygonSnapshotRegistrations.set(snapshotId, register);
    return register;
  }

  private _ensurePolygonMaskRegistered(
    flags: Uint8Array | null | undefined,
  ): Promise<string | null> {
    if (!flags || !this._options.polygonWorker?.registerPolygonMask) {
      return Promise.resolve(null);
    }
    const maskId = this._getPolygonMaskId(flags);
    if (this._registeredPolygonMasks.has(maskId)) return Promise.resolve(maskId);
    const pending = this._pendingPolygonMaskRegistrations.get(maskId);
    if (pending) return pending.then(() => maskId);

    const register = this._options.polygonWorker.registerPolygonMask({
      id: maskId,
      flags,
    }).then(() => {
      this._pendingPolygonMaskRegistrations.delete(maskId);
      this._registeredPolygonMasks.add(maskId);
    }).catch((err) => {
      this._pendingPolygonMaskRegistrations.delete(maskId);
      throw err;
    });
    this._pendingPolygonMaskRegistrations.set(maskId, register);
    return register.then(() => maskId);
  }

  private _buildPolygonChunkRecord(
    shapes: any[],
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
    revision: number,
    arcCount: number,
    shapeCount: number,
    pointCount: number,
    retainedInterval: number,
    origin: WebGLCoordinateOrigin,
    targetChunkFeatureCount: number,
    idPrefix: string,
  ): PolygonChunkCacheRecord {
    const selected = this._getSelectedPolygonFeatures(shapes, arcs, flags)
      .sort((a, b) => {
        const ax = (a.bbox[0] + a.bbox[2]) / 2;
        const bx = (b.bbox[0] + b.bbox[2]) / 2;
        if (ax !== bx) return ax - bx;
        return (a.bbox[1] + a.bbox[3]) - (b.bbox[1] + b.bbox[3]);
      });
    const chunks: PolygonChunkRecord[] = [];
    for (let i = 0; i < selected.length; i += targetChunkFeatureCount) {
      const group = selected.slice(i, i + targetChunkFeatureCount);
      if (group.length === 0) continue;
      chunks.push({
        id: `${idPrefix}:${chunks.length}`,
        bbox: this._unionBboxes(group.map(feature => feature.bbox)),
        featureIds: new Uint32Array(group.map(feature => feature.featureId)),
        geometry: null,
      });
    }
    const index = new Flatbush(chunks.length);
    for (const chunk of chunks) {
      index.add(chunk.bbox[0], chunk.bbox[1], chunk.bbox[2], chunk.bbox[3]);
    }
    index.finish();
    return {
      revision,
      arcCount,
      shapeCount,
      pointCount,
      retainedInterval,
      origin,
      chunks,
      index,
    };
  }

  private _searchPolygonChunkRecords(
    record: PolygonChunkCacheRecord,
    bbox: [number, number, number, number] | number[] | null,
  ): PolygonChunkRecord[] {
    if (!bbox) return record.chunks;
    return record.index.search(bbox[0], bbox[1], bbox[2], bbox[3])
      .map((i: number) => record.chunks[i]);
  }

  private _buildPolygonChunkSetFromRecords(
    records: PolygonChunkRecord[],
  ): WebGLPolygonTessellationChunkSet {
    const chunks = records.map((record) => ({
      id: record.id,
      bbox: record.bbox,
      featureIds: record.featureIds,
      geometry: record.geometry!,
    }));
    if (chunks.length === 0) {
      return {
        chunks: [],
        search: () => [],
      };
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

  private _getSelectedPolygonFeatures(
    shapes: any[],
    arcs: ArcCollection,
    flags: Uint8Array | null | undefined,
  ): Array<{ featureId: number; bbox: [number, number, number, number] }> {
    const features: Array<{ featureId: number; bbox: [number, number, number, number] }> = [];
    for (let featureId = 0; featureId < shapes.length; featureId++) {
      const shape = shapes[featureId];
      if (!shape || (flags && !this._shapeUsesFlags(shape, flags))) continue;
      features.push({
        featureId,
        bbox: this._getShapeBbox(arcs, shape),
      });
    }
    return features;
  }

  private _shapeUsesFlags(shape: any[], flags: Uint8Array): boolean {
    for (const part of shape) {
      if (!part) continue;
      for (const arcId of part) {
        const absId = arcId >= 0 ? arcId : ~arcId;
        if (flags[absId] === 1) return true;
      }
    }
    return false;
  }

  private _getShapeBbox(
    arcs: ArcCollection,
    shape: any[],
  ): [number, number, number, number] {
    const boxes: Array<[number, number, number, number]> = [];
    for (const part of shape) {
      if (!part) continue;
      for (const arcId of part) {
        boxes.push(this._getArcBbox(arcs, arcId >= 0 ? arcId : ~arcId));
      }
    }
    return this._unionBboxes(boxes);
  }

  private _getShapesByFeatureIds(shapes: any[], featureIds: Uint32Array): any[] {
    const selected: any[] = [];
    for (let i = 0; i < featureIds.length; i++) {
      selected.push(shapes[featureIds[i]]);
    }
    return selected;
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

  private _getShapeObjectId(shapes: any[]): number {
    let id = this._shapeObjectIds.get(shapes);
    if (!id) {
      id = this._nextShapeObjectId++;
      this._shapeObjectIds.set(shapes, id);
    }
    return id;
  }

  private _getPolygonSnapshotId(
    shapes: any[],
    arcs: ArcCollection,
    revision: number,
    retainedInterval: number,
    origin: WebGLCoordinateOrigin,
  ): string {
    return [
      'polygon-source',
      this._getArcObjectId(arcs),
      this._getShapeObjectId(shapes),
      revision,
      retainedInterval,
      origin[0],
      origin[1],
    ].join(':');
  }

  private _getPolygonMaskId(flags: Uint8Array): string {
    return `polygon-mask:${this._getFlagObjectId(flags)}`;
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
    return this._buildArcChunkSetFromChunks(chunks, index);
  }

  private _buildArcChunkSetFromChunks(
    chunks: WebGLArcSegmentChunk[],
    index = new Flatbush(chunks.length),
  ): WebGLArcSegmentChunkSet {
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

  private _getArcChunkWorkerVertexData(
    arcs: ArcCollection,
  ): WebGLArcChunkWorkerVertexData | null {
    const vertexData = arcs.getVertexData?.();
    if (!vertexData?.xx || !vertexData.yy || !vertexData.nn || !vertexData.ii) {
      return null;
    }
    return {
      xx: vertexData.xx,
      yy: vertexData.yy,
      nn: vertexData.nn,
      ii: vertexData.ii,
      bb: vertexData.bb ?? null,
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

  private _countPoints(shapes: any[]): number {
    let count = 0;
    for (const shape of shapes) {
      if (!shape) continue;
      if (typeof shape[0] === 'number' && typeof shape[1] === 'number') {
        count++;
        continue;
      }
      count += shape.length;
    }
    return count;
  }
}
