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

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { AffineLayerOptions } from '../types';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';

export async function affineLayer(
  ctx: OpContext,
  opts: AffineLayerOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (opts.target !== undefined) {
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  }

  // At least one of shift / rotate / scale must be supplied; otherwise
  // the op is a no-op and shouldn't pollute history.
  const hasShift = Array.isArray(opts.shift);
  const hasRotate = typeof opts.rotate === 'number' && opts.rotate !== 0;
  const hasScale = opts.scale !== undefined
    && (typeof opts.scale === 'number' ? opts.scale !== 1 : Array.isArray(opts.scale));
  if (!hasShift && !hasRotate && !hasScale) {
    return Err.validation('shift', 'must supply at least one of `shift`, `rotate`, or `scale`');
  }

  if (hasShift) {
    const s = opts.shift!;
    if (s.length !== 2 || !s.every((n) => Number.isFinite(n))) {
      return Err.validation('shift', 'must be [dx, dy] of finite numbers');
    }
  }
  if (hasRotate && !Number.isFinite(opts.rotate)) {
    return Err.validation('rotate', 'must be a finite number (degrees)');
  }
  if (hasScale && Array.isArray(opts.scale)) {
    const s = opts.scale;
    if (s.length !== 2 || !s.every((n) => Number.isFinite(n) && n !== 0)) {
      return Err.validation('scale', 'must be [sx, sy] of nonzero finite numbers');
    }
  } else if (hasScale && typeof opts.scale === 'number'
    && (!Number.isFinite(opts.scale) || opts.scale === 0)) {
    return Err.validation('scale', 'must be a nonzero finite number');
  }
  if (opts.anchor !== undefined) {
    if (!Array.isArray(opts.anchor) || opts.anchor.length !== 2
      || !opts.anchor.every((n) => Number.isFinite(n))) {
      return Err.validation('anchor', 'must be [x, y] of finite numbers');
    }
  }
  if (!ctx.host._allowExpressionEvaluation([opts.where], 'affineLayer')) {
    return Err.expressionDisabled('affineLayer');
  }

  const o: Record<string, unknown> = {};
  if (hasShift) o.shift = [String(opts.shift![0]), String(opts.shift![1])];
  if (hasRotate) o.rotate = opts.rotate!;
  if (hasScale) {
    o.scale = typeof opts.scale === 'number' ? opts.scale : (opts.scale as [number, number]);
  }
  if (opts.anchor) o.anchor = [opts.anchor[0], opts.anchor[1]];
  if (opts.where && opts.where.trim()) o.where = opts.where;

  const commands: ParsedCommand[] = [];
  if (opts.target) commands.push({ name: 'target', options: { target: opts.target } });
  commands.push({ name: 'affine', options: o });

  const label = `Affine ${opts.target ?? opts.source}`;
  return ctx.runDatasetCommandParsed(opts.source, commands, label);
}
