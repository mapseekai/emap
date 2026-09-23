import type { Emap, LabelOptions, LayerSpecification } from '../../../src';
declare const map: Emap;
const label: LabelOptions = {
  field: 'name',
  fontSize: 16,
  fontUrl: '/fonts/custom.woff',
  color: '#222222',
  haloWidth: 2,
  placement: 'auto',
  priority: ['get', 'rank'],
};
const layer: LayerSpecification = { id: 'roads', source: 'roads', type: 'line', label };
map.addLayer(layer);
map.setLayerLabel('roads', label);
map.setLayerLabel('roads', null);
// @ts-expect-error labels are not a separate render layer type
const wrong: LayerSpecification = { id: 'text', source: 'roads', type: 'text' };
void wrong;
// @ts-expect-error arbitrary code callbacks are not a label expression
map.setLayerLabel('roads', { text: (record: unknown) => String(record) });
