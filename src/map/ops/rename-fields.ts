// renameFields — bulk-rename multiple attribute fields via mapshaper's
// `-rename-fields`. Mapping order is preserved (object iteration order).
// Both old and new names must be non-empty after trimming and free of
// `,` / `=`.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { RenameFieldsOptions } from '../types';
import type { OpContext } from './_context';

export async function renameFields(ctx: OpContext, opts: RenameFieldsOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!opts.mapping || typeof opts.mapping !== 'object') {
    return Err.validation('mapping', 'must be an object of { oldName: newName }');
  }
  const entries = Object.entries(opts.mapping);
  if (entries.length === 0)
    return Err.validation('mapping', 'must contain at least one rename pair');
  const pairs: string[] = [];
  for (const [oldName, newName] of entries) {
    const o = (oldName ?? '').trim();
    const n = (newName ?? '').trim();
    if (o.length === 0 || n.length === 0) {
      return Err.validation('mapping', `field names must be non-empty: ${oldName}=${newName}`);
    }
    if (o.includes(',') || o.includes('=') || n.includes(',') || n.includes('=')) {
      return Err.validation(
        'mapping',
        `field names must not contain ',' or '=': ${oldName}=${newName}`,
      );
    }
    pairs.push(`${o}=${n}`);
  }
  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'rename-fields', options: { fields: pairs } },
    ],
    `Rename fields ${opts.target}`,
  );
}
