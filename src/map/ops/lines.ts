// linesLayer — convert a polygon target into a polyline layer of its
// boundary arcs via mapshaper's `-lines`. Optional `fields` produces a
// hierarchy of boundaries (outer hull at the top, intra-region boundaries
// below). `fields` is mapshaper's positional default arg, emitted as a
// bare comma-joined token (no `fields=` prefix) to match the CLI norm.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { LinesOptions } from '../types';
import type { OpContext } from './_context';

export async function linesLayer(ctx: OpContext, opts: LinesOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);
  if (layer.geometry_type !== 'polygon') {
    return Err.validation('target', `expected polygon layer, got ${layer.geometry_type ?? 'unknown'}`);
  }

  const safeFields = opts.fields?.filter((f) => typeof f === 'string' && !f.includes(','));
  const linesToken = safeFields && safeFields.length > 0
    ? `-lines ${safeFields.join(',')}`
    : '-lines';

  const parts: string[] = [
    `-target ${quoteCliArg(opts.target)}`,
    linesToken,
  ];
  if (opts.name && opts.name.trim()) {
    parts.push(`name=${quoteCliArg(opts.name)}`);
  }
  if (opts.noReplace) parts.push('no-replace');
  return ctx.runDatasetCommand(opts.source, parts.join(' '), `Lines ${opts.target}`);
}
