import type { Emap, IconOptions, LayerSpecification } from '../../../src';
declare const map: Emap;
const icon: IconOptions = {
  url: '/pin.png',
  size: 32,
  anchor: [0.5, 1],
  offset: [0, -2],
  opacity: 0.8,
};
map.addLayer({ id: 'poi', type: 'circle', source: 'poi', icon, label: { field: 'name' } });
map.setLayerIcon('poi', icon);
map.setLayerIcon('poi', null);
// @ts-expect-error images belong to point symbols, not a separate icon layer
const wrong: LayerSpecification = { id: 'icons', type: 'icon', source: 'poi' };
// @ts-expect-error polygon layers cannot have icon symbols
const polygon: LayerSpecification = { id: 'p', type: 'fill', source: 'poi', icon };
void wrong;
void polygon;
