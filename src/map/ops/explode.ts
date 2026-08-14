// explodeLayer — divide multi-part features into single-part features via
// mapshaper's `-explode`. Each part inherits the original record's
// attributes; useful for unpacking multipolygon islands, multipart
// polylines, or multipoint clusters into individually-pickable features.

import type { ExplodeOptions } from '../types';
import { defineLayerOp } from './_define';

export const explodeLayer = defineLayerOp<ExplodeOptions>({
  name: 'explodeLayer',
  command: 'explode',
  label: (o) => `Explode ${o.target}`,
  options: () => ({}),
});
