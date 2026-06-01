// mergeLayers — combine two or more layers in the same source into one
// via mapshaper's `-merge-layers`. Targets are joined with commas inside
// one quoted `-target` argument (matching mapshaper's CLI grammar).
//
// Up-front geometry-type check: if targets disagree and the caller didn't
// pass `force: true`, returns a validation error rather than letting
// mapshaper throw an opaque mid-pipeline error.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { MergeLayersOptions } from '../types';
import type { OpContext } from './_context';

export async function mergeLayers(ctx: OpContext, opts: MergeLayersOptions): Promise<OpResult> {
  if (!opts.targets || opts.targets.length < 2) {
    return Err.validation('targets', 'must supply at least 2 target layers');
  }
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);

  // Targets are joined with commas inside the `-target` arg; reject names
  // that themselves contain `,` so we don't silently split into bogus
  // targets.
  for (const t of opts.targets) {
    if (typeof t !== 'string' || t.includes(',')) {
      return Err.validation('targets', `target name must not contain ',': ${String(t)}`);
    }
  }

  const layers = opts.targets.map((t) => resolveLayerInList(dataset.layers, t));
  for (let i = 0; i < layers.length; i++) {
    if (!layers[i]) return Err.notFound('layer', opts.targets[i]);
  }

  if (!opts.force) {
    const firstGeom = layers[0]?.geometry_type;
    const allSame = layers.every((l) => l?.geometry_type === firstGeom);
    if (!allSame) {
      return Err.validation(
        'targets',
        'targets have mixed geometry types; pass `force: true` to merge anyway',
      );
    }
  }

  const targetList = opts.targets.join(',');
  const mergeOpts: Record<string, unknown> = {};
  if (opts.name && opts.name.trim()) mergeOpts.name = opts.name;
  if (opts.force) mergeOpts.force = true;
  if (opts.flatten) mergeOpts.flatten = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: targetList } },
      { name: 'merge-layers', options: mergeOpts },
    ],
    `Merge ${targetList}`,
  );
}
