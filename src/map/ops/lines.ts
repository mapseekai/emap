// linesLayer — convert a polygon target into a polyline layer of its
// boundary arcs via mapshaper's `-lines`. Optional `fields` produces a
// hierarchy of boundaries (outer hull at the top, intra-region boundaries
// below). `fields` is mapshaper's positional default arg, emitted as a
// bare comma-joined token (no `fields=` prefix) to match the CLI norm.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { LinesOptions } from '../types';
import type { OpContext } from './_context';
import { validateFieldList } from './_fields';

export async function linesLayer(ctx: OpContext, opts: LinesOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);
  if (layer.geometry_type !== 'polygon') {
    return Err.validation(
      'target',
      `expected polygon layer, got ${layer.geometry_type ?? 'unknown'}`,
    );
  }

  const linesOpts: Record<string, unknown> = {};
  const fields = validateFieldList('fields', opts.fields);
  if (!fields.ok) return fields;
  if (fields.value.length > 0) linesOpts.fields = fields.value;
  if (opts.name && opts.name.trim()) linesOpts.name = opts.name;
  if (opts.noReplace) linesOpts.no_replace = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'lines', options: linesOpts },
    ],
    `Lines ${opts.target}`,
  );
}
