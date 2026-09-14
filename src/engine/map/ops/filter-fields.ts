// filterFields — retain only the listed attribute fields via mapshaper's
// `-filter-fields`. Pass `invert: true` to drop the listed fields and
// keep the rest.

import { Err } from '../op-result';
import type { FilterFieldsOptions } from '../types';
import { defineLayerOp } from './_define';

export const filterFields = defineLayerOp<FilterFieldsOptions>({
  name: 'filterFields',
  command: 'filter-fields',
  label: (o) => `Filter fields ${o.target}`,
  validate: (o) => {
    if (!Array.isArray(o.fields) || o.fields.length === 0) {
      return Err.validation('fields', 'must be a non-empty array');
    }
    for (const field of o.fields) {
      if (typeof field !== 'string' || field.trim().length === 0) {
        return Err.validation('fields', `field name must be a non-empty string: ${String(field)}`);
      }
      if (field.includes(',')) {
        return Err.validation('fields', `field name must not contain ',': ${field}`);
      }
    }
  },
  options: (o) => ({ fields: o.fields.slice(), ...(o.invert ? { invert: true } : {}) }),
});
