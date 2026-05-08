// bufferLayer — generate buffer polygons for a layer via mapshaper's
// `-buffer` pipeline. Radius is in source-CRS units; either a constant
// number or a per-record expression string.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { BufferOptions } from '../types';
import type { OpContext } from './_context';

export async function bufferLayer(ctx: OpContext, opts: BufferOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  // Validate numeric radius up-front: 0 silently produces empty buffers,
  // negative values throw inside mapshaper. Expression-string radii are
  // forwarded as-is — mapshaper evaluates per-feature and there's no
  // sound way to validate them without parsing JS.
  if (typeof opts.radius === 'number') {
    if (!Number.isFinite(opts.radius) || opts.radius <= 0) {
      return Err.validation('radius', 'must be a positive finite number');
    }
  } else if (typeof opts.radius !== 'string' || opts.radius.trim().length === 0) {
    return Err.validation('radius', 'must be a positive number or non-empty expression');
  }
  if (typeof opts.radius === 'string' && !ctx.host._allowExpressionEvaluation([opts.radius], 'bufferLayer')) {
    return Err.expressionDisabled('bufferLayer');
  }

  const bufferOptions: Record<string, unknown> = { radius: String(opts.radius) };
  if (opts.capStyle) bufferOptions.cap_style = opts.capStyle;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'buffer', options: bufferOptions },
    ],
    `Buffer ${opts.target}`,
  );
}
