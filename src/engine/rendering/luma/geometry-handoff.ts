import { absArcId } from '../../../shared/types/mapshaper-types';
import {
  EMPTY_COMPONENT,
  geometryYield,
  type GeometryJob,
  type GeometryPartition,
} from './geometry-jobs';

export interface GeometryHandoffGroup {
  targets: number[];
  previous: number[];
}

/** Connect old meshes to their new LOD chunks by original IDs, never by a chunk
 * number from a different partition. Connected replacements commit together to
 * avoid holes and duplicate alpha; unrelated new coverage can still progress.
 * Only O(chunk count) temporary metadata is allocated, not another source index. */
export async function planGeometryHandoff(
  jobs: readonly GeometryJob[],
  previous: readonly GeometryJob[],
  partition: GeometryPartition,
  paths: boolean,
  signal: AbortSignal,
): Promise<GeometryHandoffGroup[]> {
  signal.throwIfAborted();
  const byChunk = new Map(jobs.map((job, i) => [job.chunk, i]));
  const parents = Uint32Array.from(jobs, (_, i) => i);
  const first = new Int32Array(previous.length).fill(-1);
  const root = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  let visited = 0,
    slice = performance.now();
  for (let i = 0; i < previous.length; i++) {
    for (const member of previous[i].members) {
      const id = paths ? absArcId(member) : member;
      const chunk = partition.membership[id];
      if (chunk !== undefined && chunk !== EMPTY_COMPONENT) {
        const target = byChunk.get(paths && partition.batchIds ? partition.batchIds[chunk] : chunk);
        if (target !== undefined) {
          if (first[i] < 0) first[i] = target;
          else parents[root(target)] = root(first[i]);
        }
      }
      if ((++visited & 4095) === 0 && performance.now() - slice >= 4) {
        await geometryYield(signal);
        slice = performance.now();
      }
    }
  }
  const groups = new Map<number, GeometryHandoffGroup>();
  for (let i = 0; i < jobs.length; i++) {
    const id = root(i);
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { targets: [], previous: [] }));
    group.targets.push(i);
  }
  for (let i = 0; i < previous.length; i++) {
    if (first[i] >= 0) groups.get(root(first[i]))!.previous.push(i);
  }
  signal.throwIfAborted();
  return [...groups.values()];
}
