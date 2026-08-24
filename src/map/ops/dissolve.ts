// Whole-layer dissolve via mapshaper's `-dissolve` pipeline.

import { Err } from '../op-result';
import type { DissolveOptions } from '../types';
import { defineLayerOp } from './_define';
import { validateFieldList, validateFieldName } from './_fields';


export const dissolveLayer = defineLayerOp<DissolveOptions>({
  name: 'dissolveLayer',
  command: 'dissolve',
  label: (o) => `Dissolve ${o.target}`,
  preGate: (o) => {
    // `field` (single) and `fields` (multi) are mutually exclusive — both
    // set is a configuration error.
    const hasFields = Array.isArray(o.fields) && o.fields.length > 0;
    if (o.field !== undefined && hasFields) {
      return Err.validation('field', '`field` and `fields` are mutually exclusive');
    }

    // mapshaper's -dissolve DEFAULT option is `fields` (comma-list, type
    // strings). A field name containing `,` would silently group by N
    // imaginary fields; reject up-front instead.
    if (o.field !== undefined) {
      const field = validateFieldName('field', o.field);
      if (!field.ok) return field;
    }
  },
  expressions: (o) => [o.calc, o.where],
  validate: (o) => {
    const hasFields = Array.isArray(o.fields) && o.fields.length > 0;
    if (hasFields) {
      const fields = validateFieldList('fields', o.fields);
      if (!fields.ok) return fields;
    }

    const sumFields = validateFieldList('sumFields', o.sumFields);
    if (!sumFields.ok) return sumFields;

    const copyFields = validateFieldList('copyFields', o.copyFields);
    if (!copyFields.ok) return copyFields;
  },
  options: (o) => {
    // Group-by fields. When neither is set, dissolve collapses every
    // feature into one (mapshaper's default for -dissolve with no key).
    const dissolveOpts: Record<string, unknown> = {};
    const hasFields = Array.isArray(o.fields) && o.fields.length > 0;
    if (o.field) {
      dissolveOpts.fields = [o.field];
    } else if (hasFields) {
      const fields = validateFieldList('fields', o.fields);
      if (fields.ok) dissolveOpts.fields = fields.value;
    }

    const sumFields = validateFieldList('sumFields', o.sumFields);
    if (sumFields.ok && sumFields.value.length > 0) dissolveOpts.sum_fields = sumFields.value;

    const copyFields = validateFieldList('copyFields', o.copyFields);
    if (copyFields.ok && copyFields.value.length > 0) dissolveOpts.copy_fields = copyFields.value;

    if (o.calc && o.calc.trim()) dissolveOpts.calc = o.calc;
    if (o.where && o.where.trim()) dissolveOpts.where = o.where;
    if (o.multipart) dissolveOpts.multipart = true;
    if (o.name && o.name.trim()) dissolveOpts.name = o.name;
    if (o.noReplace) dissolveOpts.no_replace = true;
    return dissolveOpts;
  },
});

