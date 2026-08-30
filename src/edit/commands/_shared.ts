import {
  bumpEditVersion,
  type ArcCollection,
  type ArcVertexData,
} from '../../types/mapshaper-types';
import type { AppendedArc, MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { asMutableTopologySource, type TopologySource } from '../../source/source';

export function findArcIdForVertex(vertexId: number, data: ArcVertexData): number {
  let low = 0;
  let high = data.ii.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = data.ii[mid];
    const end = start + data.nn[mid];
    if (vertexId < start) high = mid - 1;
    else if (vertexId >= end) low = mid + 1;
    else return mid;
  }
  return -1;
}

export function markSourceChanged(source: TopologySource): void {
  const mutableSource = asMutableTopologySource(source);
  mutableSource.markDisplayArcsDirty?.();
  bumpEditVersion(mutableSource.getDataset?.());
}

/**
 * Append via the adapter's batch fast-path when available, otherwise preserve
 * compatibility with adapters that only implement the established
 * single-arc API.
 */
export function appendArcsCompat(
  adapter: MapshaperAdapter,
  arcs: ArcCollection,
  arcsToAppend: AppendedArc[],
): number {
  if (adapter.appendArcs) return adapter.appendArcs(arcs, arcsToAppend);

  for (const [index, arc] of arcsToAppend.entries()) {
    if (arc.yy.length !== arc.xx.length || (arc.zz && arc.zz.length !== arc.xx.length)) {
      throw new Error(
        `appendArcs: arc at index ${index} has mismatched buffer lengths (xx=${arc.xx.length}, yy=${arc.yy.length}, zz=${arc.zz?.length ?? 'none'})`,
      );
    }
  }
  if (
    !(arcs.isFlat?.() ?? true) &&
    arcsToAppend.some((arc) => arc.zz !== null && arc.zz !== undefined)
  ) {
    throw new Error(
      'appendArcs: legacy adapter without appendArcs cannot preserve simplification thresholds; implement appendArcs/truncateArcs or flatten the collection',
    );
  }

  const firstArcId = arcs.size();
  for (const arc of arcsToAppend) {
    const points: [number, number][] = new Array(arc.xx.length);
    for (let index = 0; index < arc.xx.length; index++) {
      points[index] = [arc.xx[index]!, arc.yy[index]!];
    }
    adapter.appendArc(arcs, points);
  }
  return firstArcId;
}

/**
 * Truncate via the adapter's batch fast-path when available, otherwise
 * remove tail arcs through the established single-arc API.
 */
export function truncateArcsCompat(
  adapter: MapshaperAdapter,
  arcs: ArcCollection,
  targetArcCount: number,
): void {
  if (adapter.truncateArcs) {
    adapter.truncateArcs(arcs, targetArcCount);
    return;
  }

  const currentArcCount = arcs.size();
  if (currentArcCount < targetArcCount) {
    throw new Error(
      `truncateArcs: target ${targetArcCount} exceeds current arc count ${currentArcCount}`,
    );
  }
  while (arcs.size() > targetArcCount) adapter.deleteLastArc(arcs);
}
