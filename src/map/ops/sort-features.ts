// sortFeatures — sort features within a layer by a JS expression via
// mapshaper's `-sort`. Bare field names work directly. Default order is
// ascending; pass `descending: true` for the reverse.

import { Err } from '../op-result';
import type { SortFeaturesOptions } from '../types';
import { defineLayerOp } from './_define';

export const sortFeatures = defineLayerOp<SortFeaturesOptions>({
  name: 'sortFeatures',
  command: 'sort',
  label: (o) => `Sort ${o.target}`,
  preGate: (o) => {
    if ((o.expression ?? '').trim().length === 0) {
      return Err.validation('expression', 'must be a non-empty expression');
    }
  },
  expressions: (o) => [(o.expression ?? '').trim()],
  options: (o) => {
    const options: Record<string, unknown> = { expression: (o.expression ?? '').trim() };
    if (o.descending) options.descending = true;
    return options;
  },
});
