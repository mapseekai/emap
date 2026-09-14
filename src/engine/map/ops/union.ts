// unionLayers — overlay two or more polygon layers from the same source
// via mapshaper's `-union`. Output is one flat mosaic where every
// intersection region is its own polygon, attributed by the union of
// input fields. mapshaper's `-target` for `-union` is a comma-separated
// layer list, so we join `targets` with commas inside one quoted arg.

import { Err, type OpResult } from '../op-result';
import type { UnionOptions } from '../types';
import type { OpContext } from './_context';
import { validateFieldList } from './_fields';
import { resolveCommaTargets } from './_targets';

export async function unionLayers(ctx: OpContext, opts: UnionOptions): Promise<OpResult> {
  if (!opts.targets || opts.targets.length < 2) {
    return Err.validation('targets', 'must supply at least 2 target layers');
  }
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const resolved = resolveCommaTargets(dataset, opts.targets);
  if (!resolved.ok) return resolved;
  const { targetList } = resolved.value;
  const unionOpts: Record<string, unknown> = {};
  if (opts.fields && opts.fields.length > 0) {
    const fields = validateFieldList('fields', opts.fields);
    if (!fields.ok) return fields;
    unionOpts.fields = fields.value;
  }
  if (opts.name && opts.name.trim()) unionOpts.name = opts.name;
  if (opts.noReplace) unionOpts.no_replace = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: targetList } },
      { name: 'union', options: unionOpts },
    ],
    `Union ${targetList}`,
  );
}
