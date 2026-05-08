// renameLayer — rename one layer in a source dataset via mapshaper's
// `-rename-layers`. The new name is trimmed and validated for
// non-emptiness and absence of collision with any other existing layer
// in the same dataset.

import { resolveLayerInList } from '../layer-registry';
import { quoteCliArg } from '../command-args';
import { Err, type OpResult } from '../op-result';
import type { RenameLayerOptions } from '../types';
import type { OpContext } from './_context';

export async function renameLayer(
  ctx: OpContext,
  opts: RenameLayerOptions,
): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  const newName = (opts.name ?? '').trim();
  if (newName.length === 0) return Err.validation('name', 'must be a non-empty string');
  // mapshaper's -rename-layers DEFAULT is `names` (comma-list). A name
  // containing `,` would silently split into N rename pairs.
  if (newName.includes(',')) return Err.validation('name', 'must not contain `,`');
  // Allow renaming to the same name (no-op-ish), but reject if another
  // layer in this dataset already owns it.
  if (newName !== opts.target) {
    const collision = dataset.layers.some(
      (l: any) => (l?.name ?? '') === newName,
    );
    if (collision) return Err.validation('name', `another layer already named '${newName}'`);
  }
  const cmd = `-target ${quoteCliArg(opts.target)} -rename-layers ${quoteCliArg(newName)}`;
  return ctx.runDatasetCommand(opts.source, cmd, `Rename ${opts.target} → ${newName}`);
}
