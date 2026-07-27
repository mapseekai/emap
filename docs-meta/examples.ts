import { Emap, TopologySource, type LayerSpecification } from '@zwishing/emap';

export interface ExampleDefinition {
  id: string;
  category: string;
  title: { zh: string; en: string };
  docs: readonly string[];
  api: readonly string[];
  fixtures: readonly string[];
  success: string;
  load: () => Promise<void>;
}

type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, number | string>;
  geometry: {
    type: 'Point' | 'MultiPoint' | 'LineString' | 'Polygon';
    coordinates: unknown;
  };
};

type ExampleSeed = Omit<ExampleDefinition, 'load'> & {
  filename: string;
  geojson: {
    type: 'FeatureCollection';
    features: GeoJsonFeature[];
  };
  layer: Omit<LayerSpecification, 'source'>;
};

let activeMap: Emap | null = null;

const sourceId = 'example';
const docsIntro = '/docs/';

const seeds: readonly ExampleSeed[] = [
  {
    id: 'getting-started/geojson-viewer',
    category: 'getting-started',
    title: { zh: 'GeoJSON 查看器', en: 'GeoJSON viewer' },
    docs: [docsIntro],
    api: ['Emap'],
    fixtures: ['inline:geojson-viewer.geojson'],
    success: 'The map renders a small mixed GeoJSON scene and fits it in the viewport.',
    filename: 'geojson-viewer.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Harbor district' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.43, 37.77],
                [-122.39, 37.77],
                [-122.39, 37.8],
                [-122.43, 37.8],
                [-122.43, 37.77],
              ],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'geojson-viewer-fill',
      type: 'fill',
      paint: { 'fill-color': '#2f6f73', 'fill-opacity': 0.32, 'line-color': '#173e43' },
    },
  },
  {
    id: 'getting-started/points',
    category: 'getting-started',
    title: { zh: '点图层', en: 'Points' },
    docs: [docsIntro],
    api: ['TopologySource.fromBytes'],
    fixtures: ['inline:points.geojson'],
    success: 'Three point features render as circle marks with distinct attribute records.',
    filename: 'points.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'North', rank: 1 },
          geometry: { type: 'Point', coordinates: [-122.42, 37.81] },
        },
        {
          type: 'Feature',
          properties: { name: 'Central', rank: 2 },
          geometry: { type: 'Point', coordinates: [-122.41, 37.78] },
        },
        {
          type: 'Feature',
          properties: { name: 'South', rank: 3 },
          geometry: { type: 'Point', coordinates: [-122.39, 37.75] },
        },
      ],
    },
    layer: {
      id: 'points-circle',
      type: 'circle',
      paint: { 'circle-color': '#b3425f', 'circle-radius': 6 },
    },
  },
  {
    id: 'getting-started/lines',
    category: 'getting-started',
    title: { zh: '线图层', en: 'Lines' },
    docs: [docsIntro],
    api: ['LayerSpecification'],
    fixtures: ['inline:lines.geojson'],
    success: 'Two route features render as stroked line paths.',
    filename: 'lines.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { route: 'waterfront' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.45, 37.78],
              [-122.43, 37.8],
              [-122.4, 37.79],
              [-122.38, 37.81],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { route: 'market' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.44, 37.76],
              [-122.42, 37.765],
              [-122.4, 37.77],
              [-122.38, 37.775],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'lines-stroke',
      type: 'line',
      paint: { 'line-color': '#335c99', 'line-width': 2 },
    },
  },
  {
    id: 'getting-started/polygons',
    category: 'getting-started',
    title: { zh: '面边界', en: 'Polygons' },
    docs: [docsIntro],
    api: ['LinePaint'],
    fixtures: ['inline:polygons.geojson'],
    success: 'Two polygon boundaries render as linework while preserving topology.',
    filename: 'polygons.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { zone: 'A' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.45, 37.76],
                [-122.42, 37.76],
                [-122.42, 37.79],
                [-122.45, 37.79],
                [-122.45, 37.76],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { zone: 'B' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.41, 37.76],
                [-122.38, 37.76],
                [-122.38, 37.79],
                [-122.41, 37.79],
                [-122.41, 37.76],
              ],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'polygons-outline',
      type: 'line',
      paint: { 'line-color': '#5a5f33', 'line-width': 1.6 },
    },
  },
  {
    id: 'getting-started/polygon-fill',
    category: 'getting-started',
    title: { zh: '面填充', en: 'Polygon fill' },
    docs: [docsIntro],
    api: ['FillPaint'],
    fixtures: ['inline:polygon-fill.geojson'],
    success: 'The polygon layer renders with a translucent fill and visible outline.',
    filename: 'polygon-fill.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Park' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.44, 37.75],
                [-122.38, 37.75],
                [-122.37, 37.8],
                [-122.43, 37.82],
                [-122.46, 37.78],
                [-122.44, 37.75],
              ],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'polygon-fill',
      type: 'fill',
      paint: { 'fill-color': '#6b8f3d', 'fill-opacity': 0.42, 'line-color': '#324719' },
    },
  },
];

export const examples: readonly ExampleDefinition[] = seeds.map((seed) => ({
  id: seed.id,
  category: seed.category,
  title: seed.title,
  docs: seed.docs,
  api: seed.api,
  fixtures: seed.fixtures,
  success: seed.success,
  load: () => loadSeed(seed),
}));

async function loadSeed(seed: ExampleSeed): Promise<void> {
  const container = document.getElementById('example-map');
  if (!(container instanceof HTMLElement)) {
    throw new Error('Example map container #example-map was not found');
  }

  activeMap?.remove();
  activeMap = null;
  container.replaceChildren();

  const map = new Emap({ container });
  activeMap = map;

  const source = await TopologySource.fromBytes(sourceId, encodeGeoJson(seed), {
    filename: seed.filename,
  });
  map.addSource(sourceId, source);
  map.addLayer({ ...seed.layer, source: sourceId });

  const extent = source.getExtent();
  if (extent.hasBounds()) {
    map.fitBounds(extent, { padding: 48, duration: 0 });
  }
}

function encodeGeoJson(seed: ExampleSeed): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(seed.geojson));
}
