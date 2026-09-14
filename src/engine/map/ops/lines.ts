// linesLayer — convert a polygon target into a polyline layer of its
// boundary arcs via mapshaper's `-lines`. Optional `fields` produces a
// hierarchy of boundaries (outer hull at the top, intra-region boundaries
// below). `fields` is mapshaper's positional default arg, emitted as a
// bare comma-joined token (no `fields=` prefix) to match the CLI norm.

import type { LinesOptions } from '../types';
import { defineLayerOp } from './_define';
import { validateFieldList } from './_fields';

export const linesLayer = defineLayerOp<LinesOptions>({
  name: 'linesLayer',
  command: 'lines',
  geometry: 'polygon',
  label: (o) => `Lines ${o.target}`,
  validate: (o) => {
    const fields = validateFieldList('fields', o.fields);
    if (!fields.ok) return fields;
  },
  options: (o) => {
    const linesOpts: Record<string, unknown> = {};
    const fields = validateFieldList('fields', o.fields);
    if (fields.ok && fields.value.length > 0) linesOpts.fields = fields.value;
    if (o.name && o.name.trim()) linesOpts.name = o.name;
    if (o.noReplace) linesOpts.no_replace = true;
    return linesOpts;
  },
});
