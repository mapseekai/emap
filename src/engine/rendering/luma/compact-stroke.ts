import type { AffineTransform } from '../../../domain/geo/transform';
import { perspectiveActive } from '../../../domain/geo/perspective-transform';
import type { GeometryBuffer } from '../../../integrations/luma/types';
import { PATH_STRIDE } from './path-geometry';

/** Two hi/lo endpoints and two (outer miter xy, inner limit, turn/cap) records.
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
  const separated = split && exact > 0 && exact < valid;
  const xyOnly = exact === valid;
  const floats = separated ? exact * 12 + (valid - exact) * 16 : valid * (xyOnly ? 12 : 16);
  if (!valid || floats > src.length * maxExpansion) return [g];
  const make = (count: number, xy: boolean): GeometryBuffer => ({
    kind: 'path',
    compactStroke: true,
    compactStrokeXY: xy,
    count,
    segmentCount: count,
    vertices: new Float32Array(count * (xy ? COMPACT_STROKE_XY_STRIDE : COMPACT_STROKE_STRIDE)),
  });
  const parts = separated ? [make(exact, true), make(valid - exact, false)] : [make(valid, xyOnly)];
  const cursors = [0, 0];
  let data = parts[0].vertices;
  const xy = (i: number, axis: number) =>
    src[i * PATH_STRIDE + axis] + src[i * PATH_STRIDE + axis + 2];
  const join = (
    prev: number,
    curr: number,
    next: number,
    end: boolean,
    cap: boolean,
    at: number,
  ) => {
    let ax = xy(curr, 0) - xy(prev, 0),
      ay = xy(curr, 1) - xy(prev, 1);
    let bx = xy(next, 0) - xy(curr, 0),
      by = xy(next, 1) - xy(curr, 1);
    const la = Math.hypot(ax, ay),
      lb = Math.hypot(bx, by);
    if (cap || (end ? lb === 0 : la === 0)) {
      data[at + 3] = 0;
      return;
    }
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
    const mx = -ty,
      my = tx,
      nx = end ? -ay : -by,
      ny = end ? ax : bx;
    const sine = Math.abs(mx * nx + my * ny),
      cosine = Math.abs(ax * mx + ay * my);
    const size = 1 / Math.max(sine, 0.001);
    data[at] = mx * size;
    data[at + 1] = my * size;
    data[at + 2] = Math.max(la, lb) / (Math.max(cosine, 0.001) * size);
    data[at + 3] = ax * by >= ay * bx ? -1 : 1;
  };
  for (let i = 0; i < g.count; i++) {
    const flags = src[(i + 1) * PATH_STRIDE + 6];
    if (flags >= 4) continue;
    const which = separated && !zeroLow(i) ? 1 : 0;
    const target = parts[which];
    data = target.vertices;
    const stride = target.compactStrokeXY ? COMPACT_STROKE_XY_STRIDE : COMPACT_STROKE_STRIDE;
    const at = cursors[which]++ * stride,
      dimensions = target.compactStrokeXY ? 2 : 4;
    for (let axis = 0; axis < dimensions; axis++) {
      data[at + axis] = src[(i + 1) * PATH_STRIDE + axis];
      data[at + dimensions + axis] = src[(i + 2) * PATH_STRIDE + axis];
    }
    join(i, i + 1, i + 2, false, (flags & 1) !== 0, at + dimensions * 2);
    join(i + 1, i + 2, i + 3, true, (flags & 2) !== 0, at + dimensions * 2 + 4);
  }
  if (parts.some((p) => p.vertices.some((value) => !Number.isFinite(value)))) return [g];
  return parts;
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
