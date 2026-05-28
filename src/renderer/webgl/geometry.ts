import { normalizePointShape } from '../../source/layer-utils';
import type { ArcCollection } from '../../types/mapshaper-types';

export interface WebGLPositionGeometry {
  positions: Float32Array;
  vertexCount: number;
}

export interface WebGLPolygonRingGeometry extends WebGLPositionGeometry {
  ringStarts: number[];
  ringCounts: number[];
}

export interface LineExpansionTransform {
  mx: number;
  my: number;
}

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

export function buildExpandedLineGeometry(
  lineListPositions: Float32Array,
  width: number,
  transform?: LineExpansionTransform,
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
  return {
    positions: new Float32Array(out),
    vertexCount: out.length / 2,
  };
}

export function buildPointGeometry(shapes: any[]): WebGLPositionGeometry {
  const coords: number[] = [];
  for (const shape of shapes) {
    if (!shape) continue;
    const points = normalizePointShape(shape);
    for (const point of points) {
      coords.push(point[0], point[1]);
    }
  }
  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
  };
}

export function buildPolygonRingGeometry(
  shapes: any[],
  arcs: ArcCollection & { getShapeIter?: (part: number[]) => { x: number; y: number; hasNext(): boolean } },
  filter?: (i: number) => boolean,
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
        coords.push(iter.x, iter.y);
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
