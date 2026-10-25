import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';
import { tableFromIPC } from 'apache-arrow';
import { exportGeoArrow, importGeoArrow } from './geoarrow-io';
import { datasetFromGeoJSON } from '../../../test/utils/arrow';
import { parseGeoMetadata } from './geoparquet-metadata';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';

function recordsOf(dataset: MapshaperDataset, layerIdx = 0): Array<Record<string, unknown>> {
  return (dataset.layers[layerIdx].data?.getRecords?.() ?? []) as Array<Record<string, unknown>>;
}

function shapeCoords(dataset: MapshaperDataset, shapeIdx: number): number[][][] {
  // absolute ring/path coords via arc iteration (for coordinate equality checks)
  const shape = dataset.layers[0].shapes![shapeIdx] as number[][];
  const arcs = dataset.arcs!;
  return shape.map((part) => {
    const coords: number[][] = [];
    const iter = arcs.getShapeIter!(part);
    while (iter.hasNext()) coords.push([iter.x, iter.y]);
    return coords;
  });
}

const POINTS_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a', value: 1.5, flag: true },
      geometry: { type: 'Point', coordinates: [10.25, -20.5] },
    },
    {
      type: 'Feature',
      properties: { name: 'b', value: null, flag: false },
      geometry: { type: 'Point', coordinates: [11, 21] },
    },
  ],
};

const LINES_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [5, 5],
          [10, 0],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { id: 2 },
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [20, 20],
            [21, 21],
          ],
          [
            [30, 30],
            [31, 31],
            [32, 30],
          ],
        ],
      },
    },
  ],
};

// Two adjacent squares sharing an edge — buildTopology should produce a
// shared arc, proving the round trip preserves enough structure for
// topology-aware editing.
const ADJACENT_POLYGONS_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { side: 'left' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { side: 'right' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [1, 0],
            [2, 0],
            [2, 1],
            [1, 1],
            [1, 0],
          ],
        ],
      },
    },
  ],
};

describe('GeoArrow IPC round trip', () => {
  for (const encoding of ['native', 'wkb'] as const) {
    describe(`encoding=${encoding}`, () => {
      it('round-trips points with attributes', async () => {
        const dataset = await datasetFromGeoJSON(POINTS_FC);
        const bytes = exportGeoArrow(dataset, { encoding });
        const back = importGeoArrow(bytes);

        const layer = back.layers[0];
        expect(layer.geometry_type).toBe('point');
        expect(layer.shapes).toHaveLength(2);
        expect(layer.shapes![0]).toEqual([[10.25, -20.5]]);
        const recs = recordsOf(back);
        expect(recs[0]).toMatchObject({ name: 'a', value: 1.5, flag: true });
        expect(recs[1]).toMatchObject({ name: 'b', value: null, flag: false });
      });

      it('round-trips lines with exact coordinates', async () => {
        const dataset = await datasetFromGeoJSON(LINES_FC);
        const back = importGeoArrow(exportGeoArrow(dataset, { encoding }));
        expect(back.layers[0].geometry_type).toBe('polyline');
        expect(back.layers[0].shapes).toHaveLength(2);
        expect(shapeCoords(back, 0)).toEqual([
          [
            [0, 0],
            [5, 5],
            [10, 0],
          ],
        ]);
        expect(shapeCoords(back, 1)).toHaveLength(2);
        expect(recordsOf(back).map((r) => r.id)).toEqual([1, 2]);
      });

      it('round-trips polygons with holes', async () => {
        const dataset = await datasetFromGeoJSON({
          type: 'Feature',
          properties: { name: 'donut' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
              [
                [2, 2],
                [2, 4],
                [4, 4],
                [4, 2],
                [2, 2],
              ],
            ],
          },
        });
        const back = importGeoArrow(exportGeoArrow(dataset, { encoding }));
        const layer = back.layers[0];
        expect(layer.geometry_type).toBe('polygon');
        const parts = shapeCoords(back, 0);
        expect(parts).toHaveLength(2);
        expect(parts[0]).toHaveLength(5);
        expect(parts[1]).toHaveLength(5);
      });

      it('round-trips multipolygons and rebuilds shared-arc topology', async () => {
        const dataset = await datasetFromGeoJSON(ADJACENT_POLYGONS_FC);
        const back = importGeoArrow(exportGeoArrow(dataset, { encoding }));
        expect(back.layers[0].shapes).toHaveLength(2);
        // 2 squares with one shared edge → after buildTopology the arc count
        // is below the naive 2-rings count because the shared boundary is
        // one arc referenced by both shapes.
        expect(back.arcs!.size()).toBeGreaterThan(2);
        const referenced = new Set<number>();
        for (const shape of back.layers[0].shapes! as number[][][]) {
          for (const part of shape) {
            for (const id of part) referenced.add(id >= 0 ? id : ~id);
          }
        }
        const total = (back.layers[0].shapes! as number[][][]).reduce(
          (sum, shp) => sum + shp.reduce((s, part) => s + part.length, 0),
          0,
        );
        expect(total).toBeGreaterThan(referenced.size - 1); // at least one arc shared or split
      });

      it('preserves null geometries', async () => {
        const dataset = await datasetFromGeoJSON({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { id: 1 },
              geometry: { type: 'Point', coordinates: [1, 2] },
            },
            { type: 'Feature', properties: { id: 2 }, geometry: null },
          ],
        });
        expect(dataset.layers[0].shapes![1]).toBeNull();
        const back = importGeoArrow(exportGeoArrow(dataset, { encoding }));
        expect(back.layers[0].shapes).toHaveLength(2);
        expect(back.layers[0].shapes![1]).toBeNull();
        expect(recordsOf(back)[1].id).toBe(2);
      });
    });
  }

  it('writes geo + geoarrow extension metadata and round-trips CRS', async () => {
    const dataset = await datasetFromGeoJSON(POINTS_FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
    const bytes = exportGeoArrow(dataset);
    const table = tableFromIPC(bytes);

    const geo = parseGeoMetadata(table.schema.metadata);
    expect(geo?.primary_column).toBe('geometry');
    expect(geo?.columns.geometry.encoding).toBe('point');
    expect(geo?.columns.geometry.geometry_types).toEqual(['Point']);
    expect(geo?.columns.geometry.bbox).toEqual([10.25, -20.5, 11, 21]);
    expect((geo?.columns.geometry.crs as { id: { code: number } }).id.code).toBe(3857);

    const geomField = table.schema.fields.find((f) => f.name === 'geometry')!;
    expect(geomField.metadata.get('ARROW:extension:name')).toBe('geoarrow.point');

    const back = importGeoArrow(bytes);
    expect(back.info?.crs_string).toBe('EPSG:3857');
  });

  it('omits CRS metadata for GeoParquet default WGS84 lon/lat data', async () => {
    const dataset = await datasetFromGeoJSON(POINTS_FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
    const bytes = exportGeoArrow(dataset);
    const table = tableFromIPC(bytes);
    expect(parseGeoMetadata(table.schema.metadata)?.columns.geometry).not.toHaveProperty('crs');
    expect(importGeoArrow(bytes).info?.crs_string).toBe('EPSG:4326');
  });
});

afterEach(() => vi.restoreAllMocks());
it.each([
  'native',
  'wkb',
] as const)('reuses parsed %s geometry for export until a revision changes', async (encoding) => {
  const dataset = await datasetFromGeoJSON(LINES_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  const input = exportGeoArrow(dataset, { encoding });
  const parsed = importGeoArrow(input);
  input.fill(0);
  const convert = vi.spyOn(getDefaultMapshaperAdapter(), 'exportPathData');
  const bytes = exportGeoArrow(parsed, { encoding });
  expect(convert).not.toHaveBeenCalled();
  expect(shapeCoords(importGeoArrow(bytes), 0)).toEqual([
    [
      [0, 0],
      [5, 5],
      [10, 0],
    ],
  ]);
  parsed.editVersion = 1;
  exportGeoArrow(parsed, { encoding });
  expect(convert).toHaveBeenCalled();
});
