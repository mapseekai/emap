import type { GeometryBuffer } from '../../../integrations/luma/types';
/** Conservative contiguous stroke envelopes. Preserve record order: Morton
 * sorting regressed measured full-view WebGPU throughput. Extreme
 * miters remain drawable unconditionally instead of assuming a narrow footprint. */
export function spatialStrokeGeometry(g: GeometryBuffer, rawScreen = false): GeometryBuffer {
  if (g.kind !== 'path') return g;
  if (!g.compactStroke) return rawScreen ? rawStrokeRanges(g) : g;
  if (g.count < 512) return g;
  const xy = !!g.compactStrokeXY,
    stride = xy ? 12 : 16,
    dim = xy ? 2 : 4,
    source = g.vertices,
    n = g.count;
  if (source.length !== n * stride) throw new Error('Invalid compact stroke range layout');
  const blockSize = 128,
    blocks = Math.ceil(n / blockSize),
    bounds = new Float64Array(blocks * 4),
    segments = new Uint32Array(blocks),
    uncullable = new Uint8Array(blocks);
  for (let b = 0; b < blocks; b++) bounds.set([Infinity, Infinity, -Infinity, -Infinity], b * 4);
  for (let i = 0; i < n; i++) {
    const from = i * stride,
      b = Math.floor(i / blockSize),
      at = b * 4;
    for (let end = 0; end < 2; end++) {
      const offset = from + end * dim,
        x = source[offset] + (xy ? 0 : source[offset + 2]),
        y = source[offset + 1] + (xy ? 0 : source[offset + 3]);
      bounds[at] = Math.min(bounds[at], x);
      bounds[at + 1] = Math.min(bounds[at + 1], y);
      bounds[at + 2] = Math.max(bounds[at + 2], x);
      bounds[at + 3] = Math.max(bounds[at + 3], y);
      const join = from + dim * 2 + end * 4;
      if (source[join + 3] !== 0 && Math.hypot(source[join], source[join + 1]) > 8)
        uncullable[b] = 1;
    }
    segments[b]++;
  }
  return { ...g, pathRanges: { blockSize, bounds, segments, uncullable, envelopeHalfWidths: 8 } };
}

/** Long strokes retain their shared-neighbor GPU ABI. Only add conservative
 * envelope metadata; unlike compact segments their source order is untouched. */
function rawStrokeRanges(g: GeometryBuffer): GeometryBuffer {
  const ranges = g.pathRanges;
  if (!ranges || !g.count) return g;
  const uncullable = new Uint8Array(ranges.segments.length),
    v = g.vertices,
    stride = g.solidPath === 'xy' ? 3 : g.solidPath ? 5 : 7;
  const coord = (i: number, a: number) =>
    v[i * stride + a] + (g.solidPath === 'xy' ? 0 : v[i * stride + a + 2]);
  const safeJoin = (a: number, b: number, c: number, end: boolean) => {
    let ax = coord(b, 0) - coord(a, 0),
      ay = coord(b, 1) - coord(a, 1);
    let bx = coord(c, 0) - coord(b, 0),
      by = coord(c, 1) - coord(b, 1);
    const la = Math.hypot(ax, ay),
      lb = Math.hypot(bx, by);
    if (!la || !lb) return true;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    const tx = ax + bx,
      ty = ay + by,
      len = Math.hypot(tx, ty);
    // Near a reversal arithmetic is ill-conditioned: preserve the whole range.
    if (len < 1e-5) return false;
    const sine = Math.abs((-ty * (end ? -ay : -by) + tx * (end ? ax : bx)) / len);
    return sine > 0.126; // margin beyond the exact 1/8 envelope threshold
  };
  for (let i = 0; i < g.count; i++) {
    const flags = v[(i + 2) * stride - 1],
      block = Math.floor(i / ranges.blockSize);
    if (flags >= 4 || uncullable[block]) continue;
    if (
      (!(flags & 1) && !safeJoin(i, i + 1, i + 2, false)) ||
      (!(flags & 2) && !safeJoin(i + 1, i + 2, i + 3, true))
    )
      uncullable[block] = 1;
  }
  return { ...g, pathRanges: { ...ranges, uncullable, envelopeHalfWidths: 8 } };
}
