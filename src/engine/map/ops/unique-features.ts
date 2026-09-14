// uniqueFeatures — drop duplicate features by an id expression via
// mapshaper's `-uniq`. Pass `'JSON.stringify(this.properties)'` for
// full-record dedupe.

import { Err } from '../op-result';
import type { UniqueFeaturesOptions } from '../types';
import { defineLayerOp } from './_define';

export const uniqueFeatures = defineLayerOp<UniqueFeaturesOptions>({
  name: 'uniqueFeatures',
  command: 'uniq',
  label: (o) => `Uniq ${o.target}`,
  preGate: (o) => {
    if ((o.expression ?? '').trim().length === 0) {
      return Err.validation('expression', 'must be a non-empty expression');
    }
  },
  expressions: (o) => [(o.expression ?? '').trim()],
  validate: (o) => {
    if (o.maxCount !== undefined && !(typeof o.maxCount === 'number' && o.maxCount > 0)) {
      return Err.validation('maxCount', 'must be a positive number');
    }
  },
  options: (o) => {
    const options: Record<string, unknown> = { expression: (o.expression ?? '').trim() };
    if (o.maxCount !== undefined) options.max_count = o.maxCount;
    if (o.invert) options.invert = true;
    return options;
  },
});
