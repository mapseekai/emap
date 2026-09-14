// divideLayer — cut a polyline `target` layer at the boundaries of a
// polygon `divider` layer in the same source via mapshaper's `-divide`.
// Each resulting line segment inherits the underlying polygon's
// attributes (subset by `fields` when supplied).

import { resolveLayerInList } from '../layer-registry';
import { Err } from '../op-result';
import type { DivideOptions } from '../types';
import { defineLayerOp } from './_define';
import { validateFieldList } from './_fields';

export const divideLayer = defineLayerOp<DivideOptions>({
  name: 'divideLayer',
  command: 'divide',
  geometry: 'polyline',
  label: (o) => `Divide ${o.target}`,
  validate: (o, _layer, dataset) => {
    const dividerLayer = resolveLayerInList(dataset.layers, o.divider);
    if (!dividerLayer) return Err.notFound('divider', o.divider);
    if (dividerLayer.geometry_type !== 'polygon') {
      return Err.validation(
        'divider',
        `expected polygon layer, got ${dividerLayer.geometry_type ?? 'unknown'}`,
      );
    }
    if (o.fields && o.fields.length > 0) {
      const fields = validateFieldList('fields', o.fields);
      if (!fields.ok) return fields;
    }
  },
  options: (o) => {
    const divideOpts: Record<string, unknown> = { source: o.divider };
    if (o.fields && o.fields.length > 0) {
      const fields = validateFieldList('fields', o.fields);
      if (fields.ok) divideOpts.fields = fields.value;
    }
    if (o.force) divideOpts.force = true;
    return divideOpts;
  },
});
