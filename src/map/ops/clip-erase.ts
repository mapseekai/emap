// clipLayer / eraseLayer — clip / erase a target polygon layer either
// against a polygon mask layer in the same source OR against a fixed
// rectangular bbox. Uses mapshaper's `-clip` / `-erase` pipelines.
//
// Region selectors (mutually exclusive — caller must supply exactly one):
//   - `mask`: name of a polygon layer in the same source.
//   - `bbox`: `[xmin, ymin, xmax, ymax]` rectangle in source coords.
//
// Optional post-processing flags `cleanup` and `removeSlivers` map
// 1:1 onto mapshaper's `-clip cleanup` / `-clip remove-slivers`.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { ClipEraseOptions } from '../types';
import type { OpContext } from './_context';

export async function clipLayer(ctx: OpContext, opts: ClipEraseOptions): Promise<OpResult> {
  return _runClipErase(ctx, opts, 'clip');
}

export async function eraseLayer(ctx: OpContext, opts: ClipEraseOptions): Promise<OpResult> {
  return _runClipErase(ctx, opts, 'erase');
}

async function _runClipErase(
  ctx: OpContext,
  opts: ClipEraseOptions,
  op: 'clip' | 'erase',
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  // Validate target up-front so mapshaper doesn't error opaquely.
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  // Region: exactly one of `mask` or `bbox`.
  const hasMask = typeof opts.mask === 'string' && opts.mask.length > 0;
  const hasBbox = Array.isArray(opts.bbox);
  if (hasMask === hasBbox) {
    return Err.validation(
      hasMask ? 'mask' : 'bbox',
      'must supply exactly one of `mask` or `bbox`',
    );
  }
  if (hasMask) {
    if (!resolveLayerInList(dataset.layers, opts.mask!)) return Err.notFound('mask', opts.mask!);
  } else {
    const b = opts.bbox!;
    if (b.length !== 4 || !b.every((n) => Number.isFinite(n))) {
      return Err.validation('bbox', 'must be [xmin, ymin, xmax, ymax] of finite numbers');
    }
    if (b[0] >= b[2] || b[1] >= b[3]) {
      return Err.validation('bbox', 'must satisfy xmin<xmax and ymin<ymax');
    }
  }

  const opOpts: Record<string, unknown> = hasMask
    ? { source: opts.mask! }
    : { bbox: opts.bbox! };
  if (opts.cleanup) opOpts.cleanup = true;
  if (opts.removeSlivers) opOpts.remove_slivers = true;

  const verb = op === 'clip' ? 'Clip' : 'Erase';
  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: op, options: opOpts },
    ],
    `${verb} ${opts.target}`,
  );
}
