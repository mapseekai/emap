import type { Emap, SplitSelectedOptions } from '../index';

declare const map: Emap;

const point = { cutter: { type: 'point', coordinates: [5, 0] } } satisfies SplitSelectedOptions;
const polyline = {
  cutter: {
    type: 'polyline',
    coordinates: [
      [0, 0],
      [10, 10],
    ],
  },
} satisfies SplitSelectedOptions;

map.ops.splitSelected(point);
map.ops.splitSelected(polyline);
// @ts-expect-error polygon is not a cutter type
map.ops.splitSelected({ cutter: { type: 'polygon', coordinates: [] } });
// @ts-expect-error point coordinate needs two numbers
map.ops.splitSelected({ cutter: { type: 'point', coordinates: [1] } });
