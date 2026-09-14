// applyExpression / filterFeatures — both run a JS expression per feature
// via mapshaper's `-each` (mutate) or `-filter` (drop). Grouped because
// they share expression-policy gating + similar option shape.

import { Err } from '../op-result';
import type { ApplyExpressionOptions, FilterOptions } from '../types';
import { defineLayerOp } from './_define';

export const applyExpression = defineLayerOp<ApplyExpressionOptions>({
  name: 'applyExpression',
  command: 'each',
  label: (o) => `Update ${o.target}`,
  preResolve: (o) => {
    if (!o.expression || !o.expression.trim()) {
      return Err.validation('expression', 'must be a non-empty expression');
    }
  },
  expressions: (o) => [o.expression, o.where],
  options: (o) => {
    const options: Record<string, unknown> = { expression: o.expression };
    if (o.where && o.where.trim()) options.where = o.where;
    return options;
  },
});

export const filterFeatures = defineLayerOp<FilterOptions>({
  name: 'filterFeatures',
  command: 'filter',
  label: (o) => `Filter ${o.target}`,
  preResolve: (o) => {
    if (!(o.expression && o.expression.trim()) && !o.removeEmpty) {
      return Err.validation('expression', 'must supply `expression` or `removeEmpty: true`');
    }
  },
  expressions: (o) => [o.expression],
  options: (o) => {
    const options: Record<string, unknown> = {};
    if (o.expression && o.expression.trim()) options.expression = o.expression;
    if (o.invert) options.invert = true;
    if (o.removeEmpty) options.remove_empty = true;
    return options;
  },
});
