// Strict path geometry + vertex/edge snapping for reshape and split.
// Single-feature ring/part editing keeps its weaker vertex-only selection-snap contract.

import type {
  ArcCollection,
  ArcVertexData,
  PathShape,
} from '../../../shared/types/mapshaper-types';
import type { EditHandlerHost } from './edit-handler-host';
import { projectPointOnSegment } from './draw-feature';
import type { SketchSnapTarget } from './sketch-session';

export interface PathSnapContext {
  arcs: ArcCollection;
  vertexData: ArcVertexData;
  arcIds: readonly number[];
}

/** Collect canonical arc IDs from a dense, nonempty path shape. */
export function collectPathShapeArcIds(
  shape: unknown,
  id: number,
  shapeCount: number,
  vertexData: ArcVertexData,
  arcIds: Set<number>,
): shape is PathShape {
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    id >= shapeCount ||
    !Array.isArray(shape) ||
    shape.length === 0
  )
    return false;
  for (let partIndex = 0; partIndex < shape.length; partIndex++) {
    if (!(partIndex in shape)) return false;
    const part: unknown = shape[partIndex];
    if (!Array.isArray(part) || part.length === 0) return false;
    for (let arcIndex = 0; arcIndex < part.length; arcIndex++) {
      if (!(arcIndex in part)) return false;
      const raw: unknown = part[arcIndex];
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) return false;
      const arcId = raw < 0 ? -raw - 1 : raw;
      if (arcId < 0 || arcId >= vertexData.nn.length) return false;
      arcIds.add(arcId);
    }
  }
  return true;
}

/** Require a complete arc with at least two finite vertices before snapping. */
export function isValidPathArc(arcId: number, vertexData: ArcVertexData): boolean {
  const start = vertexData.ii[arcId];
  const count = vertexData.nn[arcId];
  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 2) return false;
  if (start < 0 || start + count > vertexData.xx.length || vertexData.yy.length < start + count)
    return false;
  for (let index = start; index < start + count; index++) {
    if (!Number.isFinite(vertexData.xx[index]) || !Number.isFinite(vertexData.yy[index]))
      return false;
  }
  return true;
}

/**
 * Search validated, deduplicated arcs within a world-space bbox, then compare
 * distances in screen pixels. Strict improvement keeps vertices ahead of equal
 * edge hits. Without the segment API, vertex hits remain available.
 */
export function findPathSnapTarget(
  map: Pick<EditHandlerHost, 'project' | 'unproject'>,
  px: number,
  py: number,
  threshold: number,
  context: PathSnapContext,
): SketchSnapTarget | null {
  const c0 = map.unproject(px - threshold, py - threshold);
  const c1 = map.unproject(px + threshold, py + threshold);
  const minX = Math.min(c0[0], c1[0]);
  const maxX = Math.max(c0[0], c1[0]);
  const minY = Math.min(c0[1], c1[1]);
  const maxY = Math.max(c0[1], c1[1]);
  let bestDistance = threshold;
  let best: SketchSnapTarget | null = null;
  const { arcs, vertexData, arcIds } = context;
  for (const arcId of arcIds) {
    const start = vertexData.ii[arcId]!;
    const count = vertexData.nn[arcId]!;
    for (let index = start; index < start + count; index++) {
      const coord = [vertexData.xx[index]!, vertexData.yy[index]!] as [number, number];
      if (coord[0] < minX || coord[0] > maxX || coord[1] < minY || coord[1] > maxY) continue;
      const projected = map.project(coord[0], coord[1]);
      const distance = Math.hypot(projected[0] - px, projected[1] - py);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { coord, kind: 'vertex' };
      }
    }
  }
  if (!arcs.forEachArcSegment) return best;
  for (const arcId of arcIds) {
    arcs.forEachArcSegment(arcId, (i, j, xx, yy) => {
      const ax = xx[i];
      const ay = yy[i];
      const bx = xx[j];
      const by = yy[j];
      if (
        Math.max(ax, bx) < minX ||
        Math.min(ax, bx) > maxX ||
        Math.max(ay, by) < minY ||
        Math.min(ay, by) > maxY
      )
        return;
      const projected = projectPointOnSegment([px, py], map.project(ax, ay), map.project(bx, by));
      if (projected.dist >= bestDistance) return;
      bestDistance = projected.dist;
      best = { coord: map.unproject(projected.point[0], projected.point[1]), kind: 'edge' };
    });
  }
  return best;
}
