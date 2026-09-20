import { findArcIdForVertex } from '../../../domain/edit/commands/_shared';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';

/** Coordinate-only edit. IDs retain their native mapshaper meaning across undo/redo. */
export interface CoordinatePatch {
  revision: number;
  vertices: { id: number; x: number; y: number }[];
  points: { layer: number; feature: number; component: number; x: number; y: number }[];
}
/** Validate the complete patch before any mutation of the worker's render-only copy. */
export function applyCoordinatePatch(
  dataset: MapshaperDataset,
  patch: CoordinatePatch,
): {
  arcs: Set<number>;
  points: Set<readonly [number, number]>;
} {
  if (!Number.isSafeInteger(patch.revision) || patch.revision !== (dataset.editVersion ?? 0) + 1)
    throw new Error('Out-of-order geometry revision; reload the data before editing.');
  const data = dataset.arcs?.getVertexData?.();
  const arcs = new Set<number>();
  for (const v of patch.vertices) {
    if (
      !data ||
      !Number.isSafeInteger(v.id) ||
      v.id < 0 ||
      v.id >= data.xx.length ||
      !Number.isFinite(v.x) ||
      !Number.isFinite(v.y)
    )
      throw new Error('Invalid native vertex patch');
    const arc = findArcIdForVertex(v.id, data);
    if (arc < 0) throw new Error('Vertex has no owning arc');
    arcs.add(arc);
  }
  const targets = patch.points.map((p) => {
    if (
      ![p.layer, p.feature, p.component].every((id) => Number.isSafeInteger(id) && id >= 0) ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    )
      throw new Error('Invalid point patch');
    const layer = dataset.layers[p.layer];
    const shape = layer?.shapes?.[p.feature];
    const target =
      layer?.geometry_type === 'point' && shape ? normalizePointShape(shape)[p.component] : null;
    if (!target) throw new Error('Point component does not exist');
    return target;
  });
  for (const v of patch.vertices) {
    data!.xx[v.id] = v.x;
    data!.yy[v.id] = v.y;
  }
  for (const arc of arcs) dataset.arcs!.updateArcBounds?.(arc);
  patch.points.forEach((p, i) => {
    targets[i][0] = p.x;
    targets[i][1] = p.y;
  });
  dataset.editVersion = patch.revision;
  return { arcs, points: new Set(targets) };
}
