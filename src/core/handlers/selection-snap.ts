// Shared selection-context + vertex-snap helpers for the sketch-based path
// editors (ring-edit, part-edit). Both resolve the single selected path
// feature and snap sketched vertices onto that feature's own vertices.

import type { EditHandlerHost } from './edit-handler-host';
import type { FeatureRef } from '../../map/types';
import type {
  ArcCollection,
  ArcVertexData,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import type { SketchSnapTarget } from './sketch-session';

/** Snap context resolved best-effort from the current selection. */
export interface SnapSelectionContext {
  key: string;
  ref: FeatureRef;
  layer: PathLayer;
  arcs: ArcCollection | null;
}

export function isPathShape(shape: unknown): shape is PathShape {
  return (
    Array.isArray(shape) &&
    shape.length > 0 &&
    shape.every((part) => Array.isArray(part) && part.length > 0)
  );
}

/** Resolve the single selected polygon/polyline feature, or null. */
export function resolvePathSelectionContext(
  map: EditHandlerHost,
  geometryTypes: readonly ('polygon' | 'polyline')[],
): SnapSelectionContext | null {
  const selected = map.getSelection();
  if (!Array.isArray(selected) || selected.length !== 1 || !(0 in selected)) return null;
  const ref = selected[0];
  if (
    !ref ||
    typeof ref.source !== 'string' ||
    typeof ref.layer !== 'string' ||
    !Number.isInteger(ref.id) ||
    ref.id < 0
  )
    return null;
  const layer = map.layers.resolve(ref.source, ref.layer);
  if (
    !layer ||
    !isPathLayer(layer) ||
    !geometryTypes.includes(layer.geometry_type as 'polygon' | 'polyline') ||
    !layer.shapes ||
    !isPathShape(layer.shapes[ref.id])
  )
    return null;
  const arcs = map.getSource(ref.source)?.getArcs() as ArcCollection | undefined;
  return { key: JSON.stringify([ref.source, ref.layer, ref.id]), ref, layer, arcs: arcs ?? null };
}

/**
 * Nearest vertex of the context feature within `threshold` pixels, or null.
 * The world-space bbox rejects off-cursor arcs before paying project()/hypot().
 */
export function findVertexSnapTarget(
  map: EditHandlerHost,
  px: number,
  py: number,
  threshold: number,
  context: SnapSelectionContext,
): SketchSnapTarget | null {
  const vertexData = context.arcs?.getVertexData?.() as ArcVertexData | undefined;
  if (!vertexData) return null;
  const c0 = map.unproject(px - threshold, py - threshold);
  const c1 = map.unproject(px + threshold, py + threshold);
  const minX = Math.min(c0[0], c1[0]);
  const maxX = Math.max(c0[0], c1[0]);
  const minY = Math.min(c0[1], c1[1]);
  const maxY = Math.max(c0[1], c1[1]);
  let bestDistance = threshold;
  let best: SketchSnapTarget | null = null;
  for (const part of context.layer.shapes![context.ref.id]!) {
    for (const rawArcId of part) {
      const arcId = rawArcId < 0 ? -rawArcId - 1 : rawArcId;
      const start = vertexData.ii[arcId];
      const count = vertexData.nn[arcId];
      if (!Number.isInteger(start) || !Number.isInteger(count)) continue;
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
  }
  return best;
}
