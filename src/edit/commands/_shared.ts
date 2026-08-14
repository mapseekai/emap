import { bumpEditVersion, type ArcVertexData } from '../../types/mapshaper-types';
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
