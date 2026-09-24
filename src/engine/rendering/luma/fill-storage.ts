import type { GeometryBuffer, Rect } from '../../../integrations/luma/types';
import { buildFillRanges } from './fill-ranges';

/** Stable source-space upload coverage, wider than the viewport. Small pans
 * within the same cells reuse buffers; the authoritative topology is untouched. */
export function fillStorageBounds(view: Rect, source: Rect): Rect | undefined {
  const width = view[2] - view[0],
    height = view[3] - view[1];
  if (![...view].every(Number.isFinite) || !(width > 0) || !(height > 0))
    throw new Error('Invalid fill upload bounds');
  const stepX = 2 ** (Math.floor(Math.log2(width)) - 6);
  const stepY = 2 ** (Math.floor(Math.log2(height)) - 6);
  const coverage: Rect =
    stepX > 0 && stepY > 0
      ? [
          Math.floor((view[0] - width / 64) / stepX) * stepX,
          Math.floor((view[1] - height / 64) / stepY) * stepY,
          Math.ceil((view[2] + width / 64) / stepX) * stepX,
          Math.ceil((view[3] + height / 64) / stepY) * stepY,
        ]
      : view;
  return coverage[0] <= source[0] &&
    coverage[1] <= source[1] &&
    coverage[2] >= source[2] &&
    coverage[3] >= source[3]
    ? undefined
    : coverage;
}

/** Keep complete conservative triangle ranges, then compact their vertex storage.
 * No clipping, interpolation, simplification, feature truncation or winding changes.
 * Called in the Worker before transfer/upload; cached source tessellations stay intact. */
export function compactFillStorage(
  geometry: GeometryBuffer,
  coverage: Rect,
): GeometryBuffer | null {
  if (geometry.kind !== 'fill' || !geometry.indices) return geometry;
  const ranges = geometry.fillRanges ?? buildFillRanges(geometry);
  const selected: number[] = [];
  let count = 0;
  for (let block = 0; block < ranges.bounds.length / 4; block++) {
    const p = block * 4,
      b = ranges.bounds;
    if (
      b[p + 2] < coverage[0] ||
      b[p + 3] < coverage[1] ||
      b[p] > coverage[2] ||
      b[p + 1] > coverage[3]
    )
      continue;
    selected.push(block);
    count += Math.min(ranges.blockSize, geometry.count - block * ranges.blockSize);
  }
  if (!count) return null;
  if (count === geometry.count) return geometry;
  const ids = new Int32Array(geometry.vertices.length / 4);
  ids.fill(-1);
  const vertices = new Float32Array(Math.min(count, ids.length) * 4),
    indices =
      geometry.indices instanceof Uint16Array ? new Uint16Array(count) : new Uint32Array(count);
  let cursor = 0,
    vertexCount = 0;
  for (const block of selected) {
    for (
      let i = block * ranges.blockSize, end = Math.min(geometry.count, i + ranges.blockSize);
      i < end;
      i++
    ) {
      const original: number = geometry.indices[i];
      let local: number = ids[original];
      if (local < 0) {
        local = vertexCount++;
        ids[original] = local;
        const from = original * 4,
          to = local * 4;
        vertices[to] = geometry.vertices[from];
        vertices[to + 1] = geometry.vertices[from + 1];
        vertices[to + 2] = geometry.vertices[from + 2];
        vertices[to + 3] = geometry.vertices[from + 3];
      }
      indices[cursor++] = local;
    }
  }
  const result: GeometryBuffer = {
    kind: 'fill',
    vertices: vertexCount * 4 === vertices.length ? vertices : vertices.slice(0, vertexCount * 4),
    indices,
    count,
  };
  result.fillRanges = buildFillRanges(result);
  return result;
}
