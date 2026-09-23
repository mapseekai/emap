import type {
  Emap,
  LayerSpecification,
  SymbolStyle,
  SymbolLayout,
  SymbolPaint,
  SymbolImage,
  SymbolLabeling,
  SymbolIconSettings,
} from '../../../src';
declare const map: Emap;
const image: SymbolImage = { url: '/marker.png', size: [24, 32] };
const layout: SymbolLayout = {
  'icon-image': 'marker',
  'icon-anchor': 'bottom',
  'text-field': ['get', 'name'],
  'text-offset': [0, 1.2],
};
const paint: SymbolPaint = { 'text-color': '#243447', 'text-halo-width': 1.5, 'icon-opacity': 1 };
const labeling: SymbolLabeling = { placement: 'auto', fontWeight: 700 };
const icon: SymbolIconSettings = { enabled: true };
const symbol: SymbolStyle = { images: { marker: image }, layout, paint, labeling, icon };
const layer: LayerSpecification = { id: 'poi', source: 'poi', type: 'circle', symbol };
map.addLayer(layer);
map.setLayerSymbol('poi', symbol);
map.setLayerSymbol('poi', null);
map.removeLayerSymbol('poi');
map.setSymbolLayoutProperty('poi', 'icon-size', 2);
map.setSymbolLayoutProperty('poi', 'text-offset', [0, 1.2]);
map.setSymbolPaintProperty('poi', 'text-color', '#456789');
map.setSymbolPaintProperty('poi', 'icon-color', null);
// @ts-expect-error sizes do not yet support per-feature expressions
map.setSymbolLayoutProperty('poi', 'icon-size', ['get', 'size']);
// @ts-expect-error text-size belongs in layout, not paint
map.setSymbolPaintProperty('poi', 'text-size', 18);
// @ts-expect-error icon-anchor uses named values, not native normalized tuples
map.setSymbolLayoutProperty('poi', 'icon-anchor', [0.5, 1]);
// @ts-expect-error attaching a symbol does not introduce a standalone symbol layer
map.addLayer({ id: 'text', source: 's', type: 'symbol' });
