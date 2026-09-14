// dropLayer — delete a single layer from the source dataset via
// mapshaper's `-drop`. mapshaper's `-drop` is multi-modal (layer /
// geometry / holes / fields); this op wraps only the "drop the entire
// layer" mode. Use `filterFields` for the field-drop case.

import type { DropLayerOptions } from '../types';
import { defineLayerOp } from './_define';

export const dropLayer = defineLayerOp<DropLayerOptions>({
  name: 'dropLayer',
  command: 'drop',
  label: (o) => `Drop ${o.target}`,
  options: () => ({}),
});
