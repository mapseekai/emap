import earcut from 'earcut';
import { modifyPolygonWindingDirection, WINDING } from '@math.gl/polygon';
import {
  buildPointGeometry,
  type WebGLArcSegmentGeometry,
  type WebGLCoordinateOrigin,
  type WebGLPolygonTessellatedGeometry,
} from './geometry';
import type {
  WebGLArcChunkWorkerVertexData,
  WebGLArcSegmentChunk,
} from './cache';

interface BuildPointGeometryRequest {
  id: number;
  type: 'build-point-geometry';
  shapes: any[];
  origin: WebGLCoordinateOrigin;
}

interface BuildArcSegmentChunksRequest {
  id: number;
  type: 'build-arc-segment-chunks';
  vertexData: WebGLArcChunkWorkerVertexData;
  arcIds: Uint32Array;
  origin: WebGLCoordinateOrigin;
  targetChunkArcCount: number;
  idPrefix: string;
}

interface BuildPolygonTessellationRequest {
  id: number;
  type: 'build-polygon-tessellation';
  shapes: any[];
  vertexData: WebGLArcChunkWorkerVertexData;
  flags?: Uint8Array | null;
  origin: WebGLCoordinateOrigin;
}

interface RegisterSourceSnapshotRequest {
  id: number;
  type: 'register-source-snapshot';
  snapshot: {
    id: string;
    shapes: any[];
    vertexData: WebGLArcChunkWorkerVertexData;
  };
}

interface RegisterPolygonMaskRequest {
  id: number;
  type: 'register-polygon-mask';
  mask: {
    id: string;
    flags: Uint8Array;
  };
}

interface BuildPolygonChunkRequest {
  id: number;
  type: 'build-polygon-chunk';
  snapshotId: string;
  chunkId: string;
  featureIds: Uint32Array;
  flags?: Uint8Array | null;
  flagsId?: string | null;
  origin: WebGLCoordinateOrigin;
}

interface ClearRetainedGeometryRequest {
  id: number;
  type: 'clear-retained-geometry';
}

type GeometryWorkerRequest =
  | BuildPointGeometryRequest
  | BuildArcSegmentChunksRequest
  | BuildPolygonTessellationRequest
  | RegisterSourceSnapshotRequest
  | RegisterPolygonMaskRequest
  | BuildPolygonChunkRequest
  | ClearRetainedGeometryRequest;

const sourceSnapshots = new Map<string, {
  shapes: any[];
  vertexData: WebGLArcChunkWorkerVertexData;
}>();
const polygonMasks = new Map<string, Uint8Array>();

function postMessageToMain(message: unknown, transferList?: Transferable[]): void {
  (self as unknown as Worker).postMessage(message, transferList ?? []);
}

self.onmessage = (event: MessageEvent<GeometryWorkerRequest>) => {
  const req = event.data;
  if (!req) return;

  try {
    if (req.type === 'build-point-geometry') {
      const geometry = buildPointGeometry(req.shapes, req.origin);
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'point',
        positions: geometry.positions,
        vertexCount: geometry.vertexCount,
        origin: geometry.origin,
      }, [geometry.positions.buffer]);
      return;
    }

    if (req.type === 'build-arc-segment-chunks') {
      const chunks = buildArcSegmentChunks(req);
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'arc-chunks',
        chunks,
      }, collectChunkTransferList(chunks));
      return;
    }

    if (req.type === 'build-polygon-tessellation') {
      const geometry = buildPolygonTessellationFromVertexData(
        req.shapes,
        req.vertexData,
        req.flags,
        req.origin,
      );
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'polygon',
        geometry,
      }, [geometry.positions.buffer, geometry.indices.buffer]);
      return;
    }

    if (req.type === 'register-source-snapshot') {
      sourceSnapshots.set(req.snapshot.id, {
        shapes: req.snapshot.shapes,
        vertexData: req.snapshot.vertexData,
      });
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'ack',
      });
      return;
    }

    if (req.type === 'clear-retained-geometry') {
      sourceSnapshots.clear();
      polygonMasks.clear();
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'ack',
      });
      return;
    }

    if (req.type === 'register-polygon-mask') {
      polygonMasks.set(req.mask.id, req.mask.flags);
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'ack',
      });
      return;
    }

    if (req.type === 'build-polygon-chunk') {
      const snapshot = sourceSnapshots.get(req.snapshotId);
      if (!snapshot) {
        throw new Error(`WebGL geometry worker: source snapshot not registered: ${req.snapshotId}`);
      }
      const flags = req.flagsId ? polygonMasks.get(req.flagsId) : req.flags;
      if (req.flagsId && !flags) {
        throw new Error(`WebGL geometry worker: polygon mask not registered: ${req.flagsId}`);
      }
      const shapes = Array.from(req.featureIds, featureId => snapshot.shapes[featureId])
        .filter(Boolean);
      const geometry = buildPolygonTessellationFromVertexData(
        shapes,
        snapshot.vertexData,
        flags,
        req.origin,
      );
      postMessageToMain({
        id: req.id,
        type: 'ok',
        geometryType: 'polygon',
        geometry,
      }, [geometry.positions.buffer, geometry.indices.buffer]);
    }
  } catch (err: any) {
    postMessageToMain({
      id: req.id,
      type: 'error',
      message: err?.message ?? String(err),
    });
  }
};

function buildPolygonTessellationFromVertexData(
  shapes: any[],
  vertexData: WebGLArcChunkWorkerVertexData,
  flags: Uint8Array | null | undefined,
  origin: WebGLCoordinateOrigin,
): WebGLPolygonTessellatedGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const shape of shapes) {
    if (!shape) continue;
    const polygonPositions: number[] = [];
    const holeIndices: number[] = [];

    for (const part of shape) {
      if (flags && !part.some((arcId: number) => flags[arcId >= 0 ? arcId : ~arcId] === 1)) {
        continue;
      }

      const ringStart = polygonPositions.length / 2;
      appendPartPoints(polygonPositions, vertexData, part, origin);
      closeRing(polygonPositions, ringStart);

      const ringEnd = polygonPositions.length / 2;
      if (ringEnd - ringStart < 4) {
        polygonPositions.length = ringStart * 2;
        continue;
      }

      modifyPolygonWindingDirection(
        polygonPositions,
        holeIndices.length === 0 ? WINDING.CLOCKWISE : WINDING.COUNTER_CLOCKWISE,
        { start: ringStart * 2, end: ringEnd * 2, size: 2, isClosed: true },
      );
      if (ringStart > 0) holeIndices.push(ringStart);
    }

    if (polygonPositions.length < 8) continue;
    const vertexOffset = positions.length / 2;
    appendNumbers(positions, polygonPositions);
    for (const index of earcut(polygonPositions, holeIndices, 2)) {
      indices.push(index + vertexOffset);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: indices.length,
    origin,
  };
}

function appendPartPoints(
  target: number[],
  vertexData: WebGLArcChunkWorkerVertexData,
  part: number[],
  origin: WebGLCoordinateOrigin,
): void {
  for (let partIndex = 0; partIndex < part.length; partIndex++) {
    const signedArcId = part[partIndex];
    const arcId = signedArcId >= 0 ? signedArcId : ~signedArcId;
    const start = vertexData.ii[arcId];
    const count = vertexData.nn[arcId];
    if (signedArcId >= 0) {
      for (let i = partIndex === 0 ? 0 : 1; i < count; i++) {
        const pointIndex = start + i;
        target.push(vertexData.xx[pointIndex] - origin[0], vertexData.yy[pointIndex] - origin[1]);
      }
    } else {
      for (let i = partIndex === 0 ? count - 1 : count - 2; i >= 0; i--) {
        const pointIndex = start + i;
        target.push(vertexData.xx[pointIndex] - origin[0], vertexData.yy[pointIndex] - origin[1]);
      }
    }
  }
}

function closeRing(coords: number[], ringStart: number): void {
  const start = ringStart * 2;
  const end = coords.length - 2;
  if (end < start) return;
  if (coords[start] !== coords[end] || coords[start + 1] !== coords[end + 1]) {
    coords.push(coords[start], coords[start + 1]);
  }
}

function appendNumbers(target: number[], source: number[]): void {
  const offset = target.length;
  target.length += source.length;
  for (let i = 0; i < source.length; i++) {
    target[offset + i] = source[i];
  }
}

function buildArcSegmentChunks(
  req: BuildArcSegmentChunksRequest,
): WebGLArcSegmentChunk[] {
  const sorted = Array.from(req.arcIds)
    .map(arcId => ({ arcId, bbox: getArcBbox(req.vertexData, arcId) }))
    .sort((a, b) => {
      const ax = (a.bbox[0] + a.bbox[2]) / 2;
      const bx = (b.bbox[0] + b.bbox[2]) / 2;
      if (ax !== bx) return ax - bx;
      return (a.bbox[1] + a.bbox[3]) - (b.bbox[1] + b.bbox[3]);
    });
  const chunks: WebGLArcSegmentChunk[] = [];
  for (let i = 0; i < sorted.length; i += req.targetChunkArcCount) {
    const group = sorted.slice(i, i + req.targetChunkArcCount);
    const arcIds = group.map(item => item.arcId);
    chunks.push({
      id: `${req.idPrefix}:${chunks.length}`,
      bbox: unionBboxes(group.map(item => item.bbox)),
      arcIds: new Uint32Array(arcIds),
      geometry: buildArcSegmentGeometryFromVertexData(req.vertexData, arcIds, req.origin),
    });
  }
  return chunks;
}

function buildArcSegmentGeometryFromVertexData(
  vertexData: WebGLArcChunkWorkerVertexData,
  arcIds: number[],
  origin: WebGLCoordinateOrigin,
): WebGLArcSegmentGeometry {
  let segmentCount = 0;
  for (const arcId of arcIds) {
    segmentCount += Math.max(0, vertexData.nn[arcId] - 1);
  }

  const leftPositions = new Float32Array(segmentCount * 2);
  const startPositions = new Float32Array(segmentCount * 2);
  const endPositions = new Float32Array(segmentCount * 2);
  const rightPositions = new Float32Array(segmentCount * 2);
  const segmentTypes = new Uint8Array(segmentCount);
  const segmentTypesFloat = new Float32Array(segmentCount);
  const segmentArcIds = new Uint32Array(segmentCount);
  const arcSegmentStarts = new Uint32Array(arcIds.length);
  const arcSegmentCounts = new Uint32Array(arcIds.length);
  let segment = 0;

  for (let arcIndex = 0; arcIndex < arcIds.length; arcIndex++) {
    const arcId = arcIds[arcIndex];
    const start = vertexData.ii[arcId];
    const count = vertexData.nn[arcId];
    const firstSegment = segment;
    for (let i = 0; i < count - 1; i++) {
      const leftPoint = start + Math.max(0, i - 1);
      const startPoint = start + i;
      const endPoint = start + i + 1;
      const rightPoint = start + Math.min(count - 1, i + 2);
      writePoint(leftPositions, segment, vertexData, leftPoint, origin);
      writePoint(startPositions, segment, vertexData, startPoint, origin);
      writePoint(endPositions, segment, vertexData, endPoint, origin);
      writePoint(rightPositions, segment, vertexData, rightPoint, origin);

      let type = 0;
      if (i === 0) type |= 1;
      if (i === count - 2) type |= 2;
      segmentTypes[segment] = type;
      segmentTypesFloat[segment] = type;
      segmentArcIds[segment] = arcId;
      segment++;
    }
    arcSegmentStarts[arcIndex] = firstSegment;
    arcSegmentCounts[arcIndex] = segment - firstSegment;
  }

  return {
    leftPositions,
    startPositions,
    endPositions,
    rightPositions,
    segmentTypes,
    segmentTypesFloat,
    arcIds: segmentArcIds,
    arcSegmentStarts,
    arcSegmentCounts,
    segmentCount,
    origin,
  };
}

function writePoint(
  target: Float32Array,
  segment: number,
  vertexData: WebGLArcChunkWorkerVertexData,
  pointIndex: number,
  origin: WebGLCoordinateOrigin,
): void {
  const offset = segment * 2;
  target[offset] = vertexData.xx[pointIndex] - origin[0];
  target[offset + 1] = vertexData.yy[pointIndex] - origin[1];
}

function getArcBbox(
  vertexData: WebGLArcChunkWorkerVertexData,
  arcId: number,
): [number, number, number, number] {
  const bb = vertexData.bb;
  if (bb && bb.length >= arcId * 4 + 4) {
    const i = arcId * 4;
    return [bb[i], bb[i + 1], bb[i + 2], bb[i + 3]];
  }
  const start = vertexData.ii[arcId];
  const count = vertexData.nn[arcId];
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < count; i++) {
    const pointIndex = start + i;
    const x = vertexData.xx[pointIndex];
    const y = vertexData.yy[pointIndex];
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  if (xmin === Infinity) return [0, 0, 0, 0];
  return [xmin, ymin, xmax, ymax];
}

function unionBboxes(
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

function collectChunkTransferList(chunks: WebGLArcSegmentChunk[]): Transferable[] {
  const transferList: Transferable[] = [];
  for (const chunk of chunks) {
    transferList.push(chunk.arcIds.buffer);
    transferList.push(chunk.geometry.leftPositions.buffer);
    transferList.push(chunk.geometry.startPositions.buffer);
    transferList.push(chunk.geometry.endPositions.buffer);
    transferList.push(chunk.geometry.rightPositions.buffer);
    transferList.push(chunk.geometry.segmentTypes.buffer);
    transferList.push(chunk.geometry.segmentTypesFloat.buffer);
    transferList.push(chunk.geometry.arcIds.buffer);
    transferList.push(chunk.geometry.arcSegmentStarts.buffer);
    transferList.push(chunk.geometry.arcSegmentCounts.buffer);
  }
  return transferList;
}
