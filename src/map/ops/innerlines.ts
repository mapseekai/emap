// innerlinesLayer — convert a polygon layer to a polyline layer along
// shared polygon edges via mapshaper's `-innerlines`. Useful for
// cartographic styling: render internal administrative borders as a
// separately-stylable line layer alongside the original polygons.

import type { InnerlinesOptions } from '../types';
import { defineLayerOp } from './_define';

export const innerlinesLayer = defineLayerOp<InnerlinesOptions>({
  name: 'innerlinesLayer',
  command: 'innerlines',
  label: (o) => `Innerlines ${o.target}`,
  expressions: (o) => [o.where],
  options: (o) => {
    const innerOpts: Record<string, unknown> = {};
    if (o.where && o.where.trim()) innerOpts.where = o.where;
    if (o.name && o.name.trim()) innerOpts.name = o.name;
    if (o.noReplace) innerOpts.no_replace = true;
    return innerOpts;
  },
});
