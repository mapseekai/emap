// dataFill — fill missing values in an attribute field by adopting
// values from neighbouring features, via mapshaper's `-data-fill`.
//
// Common use case: an administrative dataset where a few polygons have
// `null` / `''` in their `region` / `name` field. `dataFill({field:'region'})`
// propagates non-null values to the gaps from adjacent neighbours.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { DataFillOptions } from '../types';
import type { OpContext } from './_context';

export async function dataFill(ctx: OpContext, opts: DataFillOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

  if (typeof opts.field !== 'string' || opts.field.trim().length === 0) {
    return Err.validation('field', 'must be a non-empty string');
  }
  if (opts.field.includes(',') || opts.field.includes('=')) {
    return Err.validation('field', 'must not contain `,` or `=`');
  }
  if (opts.weightField !== undefined) {
    if (typeof opts.weightField !== 'string' || opts.weightField.trim().length === 0) {
      return Err.validation('weightField', 'must be a non-empty string when supplied');
    }
    if (opts.weightField.includes(',') || opts.weightField.includes('=')) {
      return Err.validation('weightField', 'must not contain `,` or `=`');
    }
  }

  const o: Record<string, unknown> = { field: opts.field };
  if (opts.weightField) o.weight_field = opts.weightField;
  if (opts.contiguous) o.contiguous = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'data-fill', options: o },
    ],
    `Data fill ${opts.target}.${opts.field}`,
  );
}
