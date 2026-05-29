import earcut from 'earcut';
import { modifyPolygonWindingDirection, WINDING } from '@math.gl/polygon';
import { normalizePointShape } from '../../source/layer-utils';
import type { ArcCollection } from '../../types/mapshaper-types';

export interface WebGLPositionGeometry {
  positions: Float32Array;
  vertexCount: number;
}

export interface WebGLPointGeometry extends WebGLPositionGeometry {
  origin: WebGLCoordinateOrigin;
}

export interface WebGLPolygonRingGeometry extends WebGLPositionGeometry {
  ringStarts: number[];
  ringCounts: number[];
}

export interface WebGLPolygonTessellatedGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  origin: WebGLCoordinateOrigin;
}

export type WebGLCoordinateOrigin = [number, number];

export interface WebGLArcSegmentGeometry {
  leftPositions: Float32Array;
  startPositions: Float32Array;
  endPositions: Float32Array;
  rightPositions: Float32Array;
  segmentTypes: Uint8Array;
  segmentTypesFloat: Float32Array;
  arcIds: Uint32Array;
  arcSegmentStarts: Uint32Array;
  arcSegmentCounts: Uint32Array;
  segmentCount: number;
  origin: WebGLCoordinateOrigin;
}

export interface LineExpansionTransform {
  mx: number;
  my: number;
}

const START_CAP = 1;
const END_CAP = 2;

export function buildArcLineGeometry(
  arcs: ArcCollection,
  filter?: (i: number) => boolean,
): WebGLPositionGeometry {
  const coords: number[] = [];
  for (let arcId = 0; arcId < arcs.size(); arcId++) {
    if (filter && !filter(arcId)) continue;
    const iter = arcs.getArcIter(arcId);
    let prev: [number, number] | null = null;
    while (iter.hasNext()) {
      const curr: [number, number] = [iter.x, iter.y];
      if (prev) coords.push(prev[0], prev[1], curr[0], curr[1]);
      prev = curr;
    }
  }
  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
  };
}

export function buildArcSegmentGeometry(
  arcs: ArcCollection,
  filter?: (i: number) => boolean,
  origin: WebGLCoordinateOrigin = [0, 0],
): WebGLArcSegmentGeometry {
  const left: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const right: number[] = [];
  const segmentTypes: number[] = [];
  const segmentArcIds: number[] = [];
  const arcSegmentStarts: number[] = [];
  const arcSegmentCounts: number[] = [];

  for (let arcId = 0; arcId < arcs.size(); arcId++) {
    const firstSegment = segmentTypes.length;
    if (filter && !filter(arcId)) {
      arcSegmentStarts.push(firstSegment);
      arcSegmentCounts.push(0);
      continue;
    }
    const points: Array<[number, number]> = [];
    const iter = arcs.getArcIter(arcId);
    while (iter.hasNext()) points.push([iter.x, iter.y]);

    for (let i = 0; i < points.length - 1; i++) {
      const leftPoint = points[Math.max(0, i - 1)];
      const startPoint = points[i];
      const endPoint = points[i + 1];
      const rightPoint = points[Math.min(points.length - 1, i + 2)];

      left.push(leftPoint[0] - origin[0], leftPoint[1] - origin[1]);
      start.push(startPoint[0] - origin[0], startPoint[1] - origin[1]);
      end.push(endPoint[0] - origin[0], endPoint[1] - origin[1]);
      right.push(rightPoint[0] - origin[0], rightPoint[1] - origin[1]);

      let type = 0;
      if (i === 0) type |= START_CAP;
      if (i === points.length - 2) type |= END_CAP;
      segmentTypes.push(type);
      segmentArcIds.push(arcId);
    }

    arcSegmentStarts.push(firstSegment);
    arcSegmentCounts.push(segmentTypes.length - firstSegment);
  }

  return {
    leftPositions: new Float32Array(left),
    startPositions: new Float32Array(start),
    endPositions: new Float32Array(end),
    rightPositions: new Float32Array(right),
    segmentTypes: new Uint8Array(segmentTypes),
    segmentTypesFloat: new Float32Array(segmentTypes),
    arcIds: new Uint32Array(segmentArcIds),
    arcSegmentStarts: new Uint32Array(arcSegmentStarts),
    arcSegmentCounts: new Uint32Array(arcSegmentCounts),
    segmentCount: segmentTypes.length,
    origin,
  };
}

export function buildArcSegmentGeometryForArcIds(
  arcs: ArcCollection,
  arcIds: ArrayLike<number>,
  origin: WebGLCoordinateOrigin = [0, 0],
): WebGLArcSegmentGeometry {
  const left: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const right: number[] = [];
  const segmentTypes: number[] = [];
  const segmentArcIds: number[] = [];
  const arcSegmentStarts: number[] = [];
  const arcSegmentCounts: number[] = [];

  for (let arcIndex = 0; arcIndex < arcIds.length; arcIndex++) {
    const arcId = arcIds[arcIndex];
    const firstSegment = segmentTypes.length;
    const points: Array<[number, number]> = [];
    const iter = arcs.getArcIter(arcId);
    while (iter.hasNext()) points.push([iter.x, iter.y]);

    for (let i = 0; i < points.length - 1; i++) {
      const leftPoint = points[Math.max(0, i - 1)];
      const startPoint = points[i];
      const endPoint = points[i + 1];
      const rightPoint = points[Math.min(points.length - 1, i + 2)];

      left.push(leftPoint[0] - origin[0], leftPoint[1] - origin[1]);
      start.push(startPoint[0] - origin[0], startPoint[1] - origin[1]);
      end.push(endPoint[0] - origin[0], endPoint[1] - origin[1]);
      right.push(rightPoint[0] - origin[0], rightPoint[1] - origin[1]);

      let type = 0;
      if (i === 0) type |= START_CAP;
      if (i === points.length - 2) type |= END_CAP;
      segmentTypes.push(type);
      segmentArcIds.push(arcId);
    }

    arcSegmentStarts.push(firstSegment);
    arcSegmentCounts.push(segmentTypes.length - firstSegment);
  }

  return {
    leftPositions: new Float32Array(left),
    startPositions: new Float32Array(start),
    endPositions: new Float32Array(end),
    rightPositions: new Float32Array(right),
    segmentTypes: new Uint8Array(segmentTypes),
    segmentTypesFloat: new Float32Array(segmentTypes),
    arcIds: new Uint32Array(segmentArcIds),
    arcSegmentStarts: new Uint32Array(arcSegmentStarts),
    arcSegmentCounts: new Uint32Array(arcSegmentCounts),
    segmentCount: segmentTypes.length,
    origin,
  };
}

export function filterArcSegmentGeometry(
  base: WebGLArcSegmentGeometry,
  filter: (i: number) => boolean,
): WebGLArcSegmentGeometry {
  const left: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const right: number[] = [];
  const segmentTypes: number[] = [];
  const arcIds: number[] = [];
  const arcSegmentStarts: number[] = [];
  const arcSegmentCounts: number[] = [];

  for (let arcId = 0; arcId < base.arcSegmentStarts.length; arcId++) {
    const firstSegment = segmentTypes.length;
    const sourceStart = base.arcSegmentStarts[arcId];
    const sourceCount = base.arcSegmentCounts[arcId];

    if (filter(arcId)) {
      for (let i = 0; i < sourceCount; i++) {
        const sourceSegment = sourceStart + i;
        pushPair(left, base.leftPositions, sourceSegment);
        pushPair(start, base.startPositions, sourceSegment);
        pushPair(end, base.endPositions, sourceSegment);
        pushPair(right, base.rightPositions, sourceSegment);
        segmentTypes.push(base.segmentTypes[sourceSegment]);
        arcIds.push(arcId);
      }
    }

    arcSegmentStarts.push(firstSegment);
    arcSegmentCounts.push(segmentTypes.length - firstSegment);
  }

  return {
    leftPositions: new Float32Array(left),
    startPositions: new Float32Array(start),
    endPositions: new Float32Array(end),
    rightPositions: new Float32Array(right),
    segmentTypes: new Uint8Array(segmentTypes),
    segmentTypesFloat: new Float32Array(segmentTypes),
    arcIds: new Uint32Array(arcIds),
    arcSegmentStarts: new Uint32Array(arcSegmentStarts),
    arcSegmentCounts: new Uint32Array(arcSegmentCounts),
    segmentCount: segmentTypes.length,
    origin: base.origin,
  };
}

function pushPair(target: number[], source: Float32Array, index: number): void {
  target.push(source[index * 2], source[index * 2 + 1]);
}

export function buildExpandedLineGeometry(
  lineListPositions: ArrayLike<number>,
  width: number,
  transform?: LineExpansionTransform,
  origin: WebGLCoordinateOrigin = [0, 0],
): WebGLPositionGeometry {
  const out: number[] = [];
  const half = width / 2;
  for (let i = 0; i < lineListPositions.length; i += 4) {
    const x1 = lineListPositions[i];
    const y1 = lineListPositions[i + 1];
    const x2 = lineListPositions[i + 2];
    const y2 = lineListPositions[i + 3];
    const dx = transform ? (x2 - x1) * transform.mx : x2 - x1;
    const dy = transform ? (y2 - y1) * transform.my : y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const screenNx = dy / len * half;
    const screenNy = -dx / len * half;
    const nx = transform && transform.mx !== 0 ? screenNx / transform.mx : screenNx;
    const ny = transform && transform.my !== 0 ? screenNy / transform.my : screenNy;
    out.push(
      x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny,
      x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny,
    );
  }
  if (origin[0] !== 0 || origin[1] !== 0) {
    for (let i = 0; i < out.length; i += 2) {
      out[i] -= origin[0];
      out[i + 1] -= origin[1];
    }
  }
  return {
    positions: new Float32Array(out),
    vertexCount: out.length / 2,
  };
}

export function buildPointGeometry(
  shapes: any[],
  origin: WebGLCoordinateOrigin = [0, 0],
): WebGLPointGeometry {
  const coords: number[] = [];
  for (const shape of shapes) {
    if (!shape) continue;
    const points = normalizePointShape(shape);
    for (const point of points) {
      coords.push(point[0] - origin[0], point[1] - origin[1]);
    }
  }
  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
    origin,
  };
}

export function buildPointQuadGeometry(): WebGLPositionGeometry {
  return {
    positions: new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]),
    vertexCount: 4,
  };
}

export function buildLineSegmentQuadGeometry(): WebGLPositionGeometry {
  return {
    positions: new Float32Array([
      0, -1,
      1, -1,
      1, 1,
      0, -1,
      1, 1,
      0, 1,
    ]),
    vertexCount: 6,
  };
}

export function buildPolygonRingGeometry(
  shapes: any[],
  arcs: ArcCollection & { getShapeIter?: (part: number[]) => { x: number; y: number; hasNext(): boolean } },
  filter?: (i: number) => boolean,
  origin: WebGLCoordinateOrigin = [0, 0],
): WebGLPolygonRingGeometry {
  const coords: number[] = [];
  const ringStarts: number[] = [];
  const ringCounts: number[] = [];
  if (!arcs.getShapeIter) {
    return { positions: new Float32Array(), vertexCount: 0, ringStarts, ringCounts };
  }

  for (const shape of shapes) {
    if (!shape) continue;
    for (const part of shape) {
      if (filter && !part.some((arcId: number) => filter(arcId >= 0 ? arcId : ~arcId))) {
        continue;
      }
      const iter = arcs.getShapeIter(part);
      const start = coords.length / 2;
      while (iter.hasNext()) {
        coords.push(iter.x - origin[0], iter.y - origin[1]);
      }
      const count = coords.length / 2 - start;
      if (count > 0) {
        ringStarts.push(start);
        ringCounts.push(count);
      }
    }
  }

  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
    ringStarts,
    ringCounts,
  };
}

export function buildPolygonTessellatedGeometry(
  shapes: any[],
  arcs: ArcCollection & { getShapeIter?: (part: number[]) => { x: number; y: number; hasNext(): boolean } },
  filter?: (i: number) => boolean,
  origin: WebGLCoordinateOrigin = [0, 0],
): WebGLPolygonTessellatedGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  if (!arcs.getShapeIter) {
    return { positions: new Float32Array(), indices: new Uint32Array(), vertexCount: 0, origin };
  }

  for (const shape of shapes) {
    if (!shape) continue;
    const polygonPositions: number[] = [];
    const holeIndices: number[] = [];

    for (const part of shape) {
      if (filter && !part.some((arcId: number) => filter(arcId >= 0 ? arcId : ~arcId))) {
        continue;
      }

      const ringStart = polygonPositions.length / 2;
      const iter = arcs.getShapeIter(part);
      while (iter.hasNext()) {
        polygonPositions.push(iter.x - origin[0], iter.y - origin[1]);
      }
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

function appendNumbers(target: number[], source: number[]): void {
  const offset = target.length;
  target.length = offset + source.length;
  for (let i = 0; i < source.length; i++) {
    target[offset + i] = source[i];
  }
}

function closeRing(positions: number[], ringStart: number): void {
  const ringEnd = positions.length / 2;
  if (ringEnd <= ringStart) return;
  const first = ringStart * 2;
  const last = (ringEnd - 1) * 2;
  if (positions[first] !== positions[last] || positions[first + 1] !== positions[last + 1]) {
    positions.push(positions[first], positions[first + 1]);
  }
}
