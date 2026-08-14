// dataFill — fill missing values in an attribute field by adopting
// values from neighbouring features, via mapshaper's `-data-fill`.
//
// Common use case: an administrative dataset where a few polygons have
// `null` / `''` in their `region` / `name` field. `dataFill({field:'region'})`
// propagates non-null values to the gaps from adjacent neighbours.

import { Err } from '../op-result';
import type { DataFillOptions } from '../types';
import { defineLayerOp } from './_define';

export const dataFill = defineLayerOp<DataFillOptions>({
  name: 'dataFill',
  command: 'data-fill',
  label: (o) => `Data fill ${o.target}.${o.field}`,
  validate: (o) => {
    if (typeof o.field !== 'string' || o.field.trim().length === 0) {
      return Err.validation('field', 'must be a non-empty string');
    }
    if (o.field.includes(',') || o.field.includes('=')) {
      return Err.validation('field', 'must not contain `,` or `=`');
    }
    if (o.weightField !== undefined) {
      if (typeof o.weightField !== 'string' || o.weightField.trim().length === 0) {
        return Err.validation('weightField', 'must be a non-empty string when supplied');
      }
      if (o.weightField.includes(',') || o.weightField.includes('=')) {
        return Err.validation('weightField', 'must not contain `,` or `=`');
      }
    }
  },
  options: (o) => ({
    field: o.field,
    ...(o.weightField ? { weight_field: o.weightField } : {}),
    ...(o.contiguous ? { contiguous: true } : {}),
  }),
});
