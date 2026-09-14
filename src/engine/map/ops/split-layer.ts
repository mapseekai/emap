// splitLayer — partition a single layer into one output layer per
// distinct grouping value via mapshaper's `-split`. The `expression`
// argument may be a bare field name or a JS expression — mapshaper
// auto-detects.
//
// v1 omits the `apart` flag (which produces independent datasets); the
// one-source-one-dataset model in emap doesn't expose those. Use
// `loadSnapshot` with `defaultIds` if that workflow is needed.

import { Err } from '../op-result';
import type { SplitLayerOptions } from '../types';
import { defineLayerOp } from './_define';

export const splitLayer = defineLayerOp<SplitLayerOptions>({
  name: 'splitLayer',
  command: 'split',
  label: (o) => `Split ${o.target}`,
  preGate: (o) => {
    const expr = (o.expression ?? '').trim();
    if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
  },
  expressions: (o) => [(o.expression ?? '').trim()],
  options: (o) => {
    const splitOpts: Record<string, unknown> = { expression: (o.expression ?? '').trim() };
    if (o.noReplace) splitOpts.no_replace = true;
    return splitOpts;
  },
});
