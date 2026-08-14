// affineLayer — apply an affine transform (translate / rotate / scale)
// to every vertex in a layer or whole dataset via mapshaper's `-affine`.
//
// Distinct from `editSession.beginAffineSession()`:
//   - Session = selection-driven, splits shared arcs first, builds an
//     interactive drag UI.
//   - This op = layer-wide one-shot, no split, no UI.
//
// Use the session for live editing; use this op for batch processing
// (move a whole imported layer to a known origin, etc.).

import { Err } from '../op-result';
import type { AffineLayerOptions } from '../types';
import { defineLayerOp } from './_define';

export const affineLayer = defineLayerOp<AffineLayerOptions>({
  name: 'affineLayer',
  command: 'affine',
  target: 'optional',
  label: (o) => `Affine ${o.target ?? o.source}`,
  preGate: (o) => {
    // At least one of shift / rotate / scale must be supplied; otherwise
    // the op is a no-op and shouldn't pollute history.
    const hasShift = Array.isArray(o.shift);
    const hasRotate = typeof o.rotate === 'number' && o.rotate !== 0;
    const hasScale =
      o.scale !== undefined &&
      (typeof o.scale === 'number' ? o.scale !== 1 : Array.isArray(o.scale));
    if (!hasShift && !hasRotate && !hasScale) {
      return Err.validation('shift', 'must supply at least one of `shift`, `rotate`, or `scale`');
    }

    if (hasShift) {
      const s = o.shift!;
      if (s.length !== 2 || !s.every((n) => Number.isFinite(n))) {
        return Err.validation('shift', 'must be [dx, dy] of finite numbers');
      }
    }
    if (hasRotate && !Number.isFinite(o.rotate)) {
      return Err.validation('rotate', 'must be a finite number (degrees)');
    }
    if (hasScale && Array.isArray(o.scale)) {
      const s = o.scale;
      if (s.length !== 2 || !s.every((n) => Number.isFinite(n) && n !== 0)) {
        return Err.validation('scale', 'must be [sx, sy] of nonzero finite numbers');
      }
    } else if (
      hasScale &&
      typeof o.scale === 'number' &&
      (!Number.isFinite(o.scale) || o.scale === 0)
    ) {
      return Err.validation('scale', 'must be a nonzero finite number');
    }
    if (o.anchor !== undefined) {
      if (
        !Array.isArray(o.anchor) ||
        o.anchor.length !== 2 ||
        !o.anchor.every((n) => Number.isFinite(n))
      ) {
        return Err.validation('anchor', 'must be [x, y] of finite numbers');
      }
    }
  },
  expressions: (o) => [o.where],
  options: (o) => {
    const hasShift = Array.isArray(o.shift);
    const hasRotate = typeof o.rotate === 'number' && o.rotate !== 0;
    const hasScale =
      o.scale !== undefined &&
      (typeof o.scale === 'number' ? o.scale !== 1 : Array.isArray(o.scale));
    const affineOptions: Record<string, unknown> = {};
    if (hasShift) affineOptions.shift = [String(o.shift![0]), String(o.shift![1])];
    if (hasRotate) affineOptions.rotate = o.rotate!;
    if (hasScale) {
      affineOptions.scale = typeof o.scale === 'number' ? o.scale : (o.scale as [number, number]);
    }
    if (o.anchor) affineOptions.anchor = [o.anchor[0], o.anchor[1]];
    if (o.where && o.where.trim()) affineOptions.where = o.where;
    return affineOptions;
  },
});
