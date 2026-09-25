import { absArcId } from '../../../shared/types/mapshaper-types';
import type { PathDrawRange } from '../../../integrations/luma/types';

/** Slice ownership metadata with the same instance offsets as a GPU mesh split. */
export function slicePathMembers(ranges: Uint32Array, first: number, count: number): Uint32Array {
  const result: number[] = [],
    end = first + count;
  for (let i = 0; i < ranges.length; i += 3) {
    if (ranges[i + 1] >= end) break;
    const a = Math.max(first, ranges[i + 1]);
    const b = Math.min(end, ranges[i + 1] + ranges[i + 2]);
    if (a < b) result.push(ranges[i], a - first, b - a);
  }
  return Uint32Array.from(result);
}

/** Select only boundaries owned by a presented polygon. Never return null (all)
 * when a selection is empty; viewport clipping intersects, rather than widens it. */
export function selectPathMembers(
  ranges: Uint32Array,
  members: Int32Array,
  selected: ReadonlySet<number>,
  viewport?: readonly PathDrawRange[] | null,
): PathDrawRange[] {
  const owned: PathDrawRange[] = [];
  let consecutive = false;
  for (let i = 0; i < ranges.length; i += 3) {
    if (!selected.has(absArcId(members[ranges[i]]))) {
      consecutive = false;
      continue;
    }
    const first = ranges[i + 1],
      count = ranges[i + 2],
      previous = owned.at(-1);
    // Every valid instance has an owner. Gaps between consecutive ownership rows
    // are only the raw ABI's degenerate neighbor padding, safe in the same draw.
    // Without this merge, a full outline would issue one draw for every source arc.
    if (consecutive && previous) previous.count = first + count - previous.firstInstance;
    else owned.push({ firstInstance: first, count });
    consecutive = true;
  }
  if (!viewport) return owned;
  const result: PathDrawRange[] = [];
  let cursor = 0;
  for (const range of owned) {
    const first = range.firstInstance,
      end = first + range.count;
    while (
      cursor < viewport.length &&
      viewport[cursor].firstInstance + viewport[cursor].count <= first
    )
      cursor++;
    for (let j = cursor; j < viewport.length && viewport[j].firstInstance < end; j++) {
      const a = Math.max(first, viewport[j].firstInstance);
      const b = Math.min(end, viewport[j].firstInstance + viewport[j].count);
      if (a < b) result.push({ firstInstance: a, count: b - a });
    }
  }
  return result;
}
