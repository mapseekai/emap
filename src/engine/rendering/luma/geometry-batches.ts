/** Assign stable, bounded render batches over consecutive logical chunks.
 * Selection still tests each logical chunk's own bounds before merging members.
 * Oversized single chunks remain isolated, never joined past the packet limit.
 */
export function geometryBatchIds(
  costs: Uint32Array,
  maxVertices: number,
  maxChunks = 4,
): Uint32Array {
  const groups = new Uint32Array(costs.length);
  let first = 0,
    count = 0,
    vertices = 0;
  for (let i = 0; i < costs.length; i++) {
    if (count && (count >= maxChunks || vertices + costs[i] > maxVertices)) {
      first = i;
      count = vertices = 0;
    }
    groups[i] = first;
    vertices += costs[i];
    count++;
  }
  return groups;
}
