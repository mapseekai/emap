import type { AffineTransform } from '../../../domain/geo/transform';
import { perspectiveActive } from '../../../domain/geo/perspective-transform';
import type { GeometryBuffer } from '../../../integrations/luma/types';
import { PATH_STRIDE } from './path-geometry';

/** Two hi/lo endpoints and two (outer miter xy, inner limit, turn/cap/reversal) records.
 * Only source-anchored affine opaque MSAA paths use this render-only format. */
export const COMPACT_STROKE_STRIDE = 16;
/** Lossless only when BOTH high/low endpoint low parts are exactly zero. */
export const COMPACT_STROKE_XY_STRIDE = 12;

/** Precompute width-independent joins and submit only valid segments. Long paths
 * with little padding retain the shared-neighbor format to avoid a memory penalty.
 * Neither authoritative coordinates nor the source path representation is changed. */
export function compactStrokeGeometry(g: GeometryBuffer, maxExpansion = 1.125): GeometryBuffer {
  return packCompactStrokes(g, maxExpansion, false)[0];
}
/** Opaque uniform strokes may separate exact XY and precise endpoints without
 * changing per-sample source-over order. Never use this on translucent strokes. */
export function compactStrokeParts(g: GeometryBuffer, maxExpansion = 1.125): GeometryBuffer[] {
  return packCompactStrokes(g, maxExpansion, true);
}
function packCompactStrokes(
  g: GeometryBuffer,
  maxExpansion: number,
  split: boolean,
): GeometryBuffer[] {
  if (g.kind !== 'path' || g.compactStroke || !g.count) return [g];
  const src = g.vertices;
  if (src.length < (g.count + 3) * PATH_STRIDE) throw new Error('Invalid path neighbor layout');
  const zeroLow = (i: number) => {
    const a = (i + 1) * PATH_STRIDE,
      b = (i + 2) * PATH_STRIDE;
    return src[a + 2] === 0 && src[a + 3] === 0 && src[b + 2] === 0 && src[b + 3] === 0;
  };
  let valid = 0,
    exact = 0;
  for (let i = 0; i < g.count; i++)
    if (src[(i + 1) * PATH_STRIDE + 6] < 4) {
      valid++;
      if (zeroLow(i)) exact++;
    }
  const parts = compactParts(valid, exact, src.length, maxExpansion, split);
  if (!parts) return [g];
  const separated = parts.length === 2;
  const cursors = [0, 0];
  const members = [[], []] as number[][];
  let memberAt = 0;
  let data = parts[0].vertices;
  const join = compactJoinWriter((i, axis) => src[i * PATH_STRIDE + axis]);
  for (let i = 0; i < g.count; i++) {
    const flags = src[(i + 1) * PATH_STRIDE + 6];
    if (flags >= 4) continue;
    const which = separated && !zeroLow(i) ? 1 : 0;
    const target = parts[which];
    data = target.vertices;
    const stride = target.compactStrokeXY ? COMPACT_STROKE_XY_STRIDE : COMPACT_STROKE_STRIDE;
    if (g.memberRanges) {
      const ranges = g.memberRanges;
      while (memberAt + 3 < ranges.length && ranges[memberAt + 1] + ranges[memberAt + 2] <= i)
        memberAt += 3;
      if (
        memberAt >= ranges.length ||
        i < ranges[memberAt + 1] ||
        i >= ranges[memberAt + 1] + ranges[memberAt + 2]
      )
        throw new Error('Missing valid path member range');
      const owner = ranges[memberAt],
        list = members[which];
      if (list.length && list[list.length - 3] === owner) list[list.length - 1]++;
      else list.push(owner, cursors[which], 1);
    }
    const at = cursors[which]++ * stride,
      dimensions = target.compactStrokeXY ? 2 : 4;
    for (let axis = 0; axis < dimensions; axis++) {
      data[at + axis] = src[(i + 1) * PATH_STRIDE + axis];
      data[at + dimensions + axis] = src[(i + 2) * PATH_STRIDE + axis];
    }
    join(data, i, i + 1, i + 2, false, (flags & 1) !== 0, at + dimensions * 2);
    join(data, i + 1, i + 2, i + 3, true, (flags & 2) !== 0, at + dimensions * 2 + 4);
  }
  if (parts.some((p) => p.vertices.some((value) => !Number.isFinite(value)))) return [g];
  if (g.memberRanges)
    for (let i = 0; i < parts.length; i++) parts[i].memberRanges = Uint32Array.from(members[i]);
  return parts;
}

function compactParts(
  valid: number,
  exact: number,
  capacityFloats: number,
  maxExpansion: number,
  split = true,
): GeometryBuffer[] | undefined {
  const separated = split && exact > 0 && exact < valid;
  const xyOnly = exact === valid;
  const floats = separated ? exact * 12 + (valid - exact) * 16 : valid * (xyOnly ? 12 : 16);
  if (!valid || floats > capacityFloats * maxExpansion) return undefined;
  const make = (count: number, xy: boolean): GeometryBuffer => ({
    kind: 'path',
    compactStroke: true,
    compactStrokeXY: xy,
    count,
    segmentCount: count,
    vertices: new Float32Array(count * (xy ? COMPACT_STROKE_XY_STRIDE : COMPACT_STROKE_STRIDE)),
  });
  return separated ? [make(exact, true), make(valid - exact, false)] : [make(valid, xyOnly)];
}

/** Both packers use the stored Float32 words, not the unquantized Float64 input. */
function compactJoinWriter(word: (vertex: number, axis: number) => number) {
  const xy = (i: number, axis: number) => word(i, axis) + word(i, axis + 2);
  // A segment's end and the next segment's start share the same source vertex.
  let joined = -1,
    ax = 0,
    ay = 0,
    bx = 0,
    by = 0,
    la = 0,
    lb = 0,
    mx = 0,
    my = 0,
    cosine = 0;
  return (
    data: Float32Array,
    prev: number,
    curr: number,
    next: number,
    end: boolean,
    cap: boolean,
    at: number,
  ) => {
    if (cap) {
      data[at + 3] = 0;
      return;
    }
    if (joined !== curr) {
      joined = curr;
      ax = xy(curr, 0) - xy(prev, 0);
      ay = xy(curr, 1) - xy(prev, 1);
      bx = xy(next, 0) - xy(curr, 0);
      by = xy(next, 1) - xy(curr, 1);
      la = Math.hypot(ax, ay);
      lb = Math.hypot(bx, by);
      if (la > 0) {
        ax /= la;
        ay /= la;
      }
      if (lb > 0) {
        bx /= lb;
        by /= lb;
      }
      let tx = ax + bx,
        ty = ay + by;
      const len = Math.hypot(tx, ty);
      if (len > 0) {
        tx /= len;
        ty /= len;
      } else {
        tx = -ay;
        ty = ax;
      }
      mx = -ty;
      my = tx;
      cosine = Math.abs(ax * mx + ay * my);
    }
    if (end ? lb === 0 : la === 0) {
      data[at + 3] = 0;
      return;
    }
    // Exact stored backtracks use a whole-segment capsule; near reversals keep their joins.
    if (
      word(prev, 0) === word(next, 0) &&
      word(prev, 1) === word(next, 1) &&
      word(prev, 2) === word(next, 2) &&
      word(prev, 3) === word(next, 3)
    ) {
      data[at + 3] = 2;
      return;
    }
    const nx = end ? -ay : -by,
      ny = end ? ax : bx;
    const sine = Math.abs(mx * nx + my * ny);
    const size = 1 / Math.max(sine, 0.001);
    data[at] = mx * size;
    data[at + 1] = my * size;
    data[at + 2] = Math.max(la, lb) / (Math.max(cosine, 0.001) * size);
    data[at + 3] = ax * by >= ay * bx ? -1 : 1;
  };
}

/** Pack already filtered paths without padded neighbors, distances or discarded bounds. */
export function flatCompactStrokeParts(
  xy: Float64Array,
  offsets: Uint32Array,
  trackMembers = false,
  maxExpansion = 1.125,
): { parts: GeometryBuffer[]; inputCount: number } | undefined {
  const word = (i: number, axis: number) => {
    const value = xy[i * 2 + (axis & 1)],
      high = Math.fround(value);
    return axis < 2 ? high : Math.fround(value - high);
  };
  const zeroLow = (i: number) =>
    word(i, 2) === 0 && word(i, 3) === 0 && word(i + 1, 2) === 0 && word(i + 1, 3) === 0;
  const validSegment = (i: number) =>
    Math.hypot(xy[(i + 1) * 2] - xy[i * 2], xy[(i + 1) * 2 + 1] - xy[i * 2 + 1]) !== 0;
  let capacity = 0,
    valid = 0,
    exact = 0;
  for (let r = 0; r + 1 < offsets.length; r++) {
    const a = offsets[r],
      b = offsets[r + 1];
    if (b - a < 2) continue;
    capacity += b - a + 2;
    for (let i = a; i + 1 < b; i++)
      if (validSegment(i)) {
        valid++;
        if (zeroLow(i)) exact++;
      }
  }
  const parts = compactParts(valid, exact, capacity * PATH_STRIDE, maxExpansion);
  if (!parts) return undefined;
  const cursors = [0, 0],
    members: number[][] = [[], []];
  // Global filtered vertex IDs keep the shared-join cache distinct across paths.
  const join = compactJoinWriter(word);
  for (let r = 0; r + 1 < offsets.length; r++) {
    const a = offsets[r],
      b = offsets[r + 1],
      n = b - a;
    if (n < 2) continue;
    const closed = n > 2 && xy[a * 2] === xy[(b - 1) * 2] && xy[a * 2 + 1] === xy[(b - 1) * 2 + 1];
    for (let i = a; i + 1 < b; i++) {
      if (!validSegment(i)) continue;
      const which = parts.length === 2 && !zeroLow(i) ? 1 : 0;
      const target = parts[which],
        dimensions = target.compactStrokeXY ? 2 : 4;
      const at = cursors[which] * (dimensions * 2 + 8),
        data = target.vertices;
      if (trackMembers) {
        const list = members[which];
        if (list.length && list[list.length - 3] === r) list[list.length - 1]++;
        else list.push(r, cursors[which], 1);
      }
      cursors[which]++;
      for (let axis = 0; axis < dimensions; axis++) {
        data[at + axis] = word(i, axis);
        data[at + dimensions + axis] = word(i + 1, axis);
      }
      join(
        data,
        i > a ? i - 1 : closed ? b - 2 : i,
        i,
        i + 1,
        false,
        !closed && i === a,
        at + dimensions * 2,
      );
      join(
        data,
        i,
        i + 1,
        i + 2 < b ? i + 2 : closed ? a + 1 : i + 1,
        true,
        !closed && i === b - 2,
        at + dimensions * 2 + 4,
      );
    }
  }
  if (parts.some((p) => p.vertices.some((value) => !Number.isFinite(value)))) return undefined;
  if (trackMembers)
    for (let i = 0; i < parts.length; i++) parts[i].memberRanges = Uint32Array.from(members[i]);
  return { parts, inputCount: Math.max(0, capacity - 3) };
}

/** Cached join directions require a positive uniform screen similarity. */
export function compactStrokeCompatible(
  view: AffineTransform,
  frame?: readonly [number, number, number, number],
): boolean {
  if (!frame || perspectiveActive(view)) return false;
  const x = view.mx / frame[0],
    y = view.my / frame[1];
  return x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x / y - 1) < 1e-10;
}
