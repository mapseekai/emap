import { describe, expect, it, vi, afterEach } from 'vitest';
import { toArrowTable } from './dataset-to-table';
import { fromArrowTable } from './table-to-dataset';
import { parseGeoMetadata } from './geoparquet-metadata';
import { decodeWkb } from './wkb';
import { datasetFromGeoJSON } from './test-utils';

const TWO_LAYER_INPUT = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 7, label: 'x', ok: true, when: null },
      geometry: { type: 'Point', coordinates: [3, 4] },
    },
  ],
};

describe('toArrowTable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds nullable attribute columns with inferred types', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    const table = toArrowTable(dataset);
    expect(table.numRows).toBe(1);
    const names = table.schema.fields.map((f) => f.name);
    expect(names).toEqual(['id', 'label', 'ok', 'when', 'geometry']);
    const row = table.get(0)!;
    expect(row.id).toBe(7);
    expect(row.label).toBe('x');
    expect(row.ok).toBe(true);
    expect(row.when).toBeNull();
  });

  it('marks null shapes as Arrow nulls', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        { type: 'Feature', properties: { id: 2 }, geometry: null },
      ],
    });
    for (const encoding of ['native', 'wkb'] as const) {
      const table = toArrowTable(dataset, { encoding });
      const geomVector = table.getChild('geometry')!;
      expect(geomVector.isValid(0)).toBe(true);
      expect(geomVector.isValid(1)).toBe(false);
    }
  });

  it('selects layers by name and rejects unknown selectors', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.layers[0].name = 'mylayer';
    expect(toArrowTable(dataset, { layer: 'mylayer' }).numRows).toBe(1);
    expect(() => toArrowTable(dataset, { layer: 'nope' })).toThrow(/not found/);
    expect(() => toArrowTable(dataset, { layer: 3 })).toThrow(/out of range/);
  });

  it('warns when exporting layer 0 of a multi-layer dataset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.layers.push({ ...dataset.layers[0], name: 'copy' });
    toArrowTable(dataset);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 layers'));
  });

  it('rejects attribute-only layers', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.layers[0].geometry_type = undefined;
    expect(() => toArrowTable(dataset)).toThrow(/no geometry/i);
  });

  it('uses a custom geometry column name', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    const table = toArrowTable(dataset, { geometryColumn: 'geom' });
    expect(table.schema.fields.at(-1)!.name).toBe('geom');
    const meta = JSON.parse(table.schema.metadata.get('geo')!);
    expect(meta.primary_column).toBe('geom');
  });

  it('exports CRS resolved from dataset metadata, not only crs_string', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.info = {
      ...dataset.info,
      prj: 'PROJCS["Web Mercator",AUTHORITY["EPSG","3857"]]',
    };

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const crs = parseGeoMetadata(table.schema.metadata)?.columns.geometry.crs as {
      id: { authority: string; code: number };
    };
    expect(crs.id).toEqual({ authority: 'EPSG', code: 3857 });

    const extMeta = JSON.parse(
      table.schema.fields.at(-1)!.metadata.get('ARROW:extension:metadata')!,
    );
    expect(extMeta.crs.id).toEqual({ authority: 'EPSG', code: 3857 });
  });

  it('writes crs:null for unknown CRS labels instead of implying CRS84', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.info = { ...dataset.info, crs_string: '+proj=utm +zone=10' };

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.crs).toBeNull();
    expect(
      JSON.parse(table.schema.fields.at(-1)!.metadata.get('ARROW:extension:metadata')!),
    ).toEqual({ crs: null });
  });

  it('writes crs:null when source data has no explicit CRS metadata', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    delete dataset.info?.crs_string;
    delete dataset.info?.prj;
    delete dataset.info?.wkt1;
    delete dataset.info?.crs;

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.crs).toBeNull();
  });

  it('omits CRS for GeoParquet default WGS84 lon/lat data', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column).not.toHaveProperty('crs');
  });

  it('uses a unique bbox covering column name when attributes already contain bbox', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { bbox: 'kept', id: 1 },
          geometry: { type: 'Point', coordinates: [3, 4] },
        },
      ],
    });

    const table = toArrowTable(dataset, { bboxColumn: 'bbox' });
    const names = table.schema.fields.map((field) => field.name);
    expect(names).toContain('bbox');
    expect(names).toContain('bbox_1');
    expect(table.getChild('bbox')!.get(0)).toBe('kept');
    expect(table.getChild('bbox_1')!.get(0)?.toJSON()).toEqual({
      xmin: 3,
      ymin: 4,
      xmax: 3,
      ymax: 4,
    });

    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.covering?.bbox).toEqual({
      xmin: ['bbox_1', 'xmin'],
      ymin: ['bbox_1', 'ymin'],
      xmax: ['bbox_1', 'xmax'],
      ymax: ['bbox_1', 'ymax'],
    });
  });

  it('omits bbox covering metadata when bboxColumn is false', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    const table = toArrowTable(dataset, { bboxColumn: false });
    const names = table.schema.fields.map((field) => field.name);
    expect(names).not.toContain('bbox');
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.covering).toBeUndefined();
  });

  it('writes null bbox struct rows for null geometries', async () => {
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

    const table = toArrowTable(dataset, { bboxColumn: 'bbox' });
    const bbox = table.getChild('bbox')!;
    expect(bbox.isValid(0)).toBe(true);
    expect(bbox.isValid(1)).toBe(false);
  });

  it('writes complete EPSG:3857 PROJJSON metadata without datum ensembles', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    const crs = column?.crs;
    const crsJson = JSON.stringify(crs);

    expect(crs).toMatchObject({
      $schema: 'https://proj.org/schemas/v0.7/projjson.schema.json',
      type: 'ProjectedCRS',
      id: { authority: 'EPSG', code: 3857 },
    });
    expect(crsJson).not.toContain('datum_ensemble');
    expect(crs).toHaveProperty('base_crs.datum.name', 'World Geodetic System 1984');
    expect(crs).toHaveProperty('coordinate_system.axis', [
      expect.objectContaining({ abbreviation: 'X', direction: 'east', unit: 'metre' }),
      expect.objectContaining({ abbreviation: 'Y', direction: 'north', unit: 'metre' }),
    ]);
  });

  it('includes every observed polygon geometry type in metadata', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
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
          properties: { id: 2 },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2],
                ],
              ],
              [
                [
                  [4, 4],
                  [5, 4],
                  [5, 5],
                  [4, 5],
                  [4, 4],
                ],
              ],
            ],
          },
        },
      ],
    });

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;

    expect(column?.geometry_types).toEqual(['Polygon', 'MultiPolygon']);
  });

  it('writes optional GeoParquet bbox covering metadata and values', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [2, -1],
                [4, -1],
                [4, 3],
                [2, 3],
                [2, -1],
              ],
            ],
          },
        },
        { type: 'Feature', properties: { id: 2 }, geometry: null },
      ],
    });

    const table = toArrowTable(dataset, { encoding: 'wkb', bboxColumn: 'bbox' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.covering?.bbox).toEqual({
      xmin: ['bbox', 'xmin'],
      ymin: ['bbox', 'ymin'],
      xmax: ['bbox', 'xmax'],
      ymax: ['bbox', 'ymax'],
    });
    expect(table.schema.fields.map((field) => field.name)).toEqual(['id', 'bbox', 'geometry']);
    expect(table.getChild('bbox')!.isValid(0)).toBe(true);
    expect(table.getChild('bbox')!.isValid(1)).toBe(false);
    expect(table.getChild('bbox')!.get(0)?.toJSON()).toEqual({
      xmin: 2,
      ymin: -1,
      xmax: 4,
      ymax: 3,
    });
  });

  it('can reproject EPSG:3857 output to GeoParquet default WGS84 lon/lat', async () => {
    const lon = 120;
    const lat = 30;
    const radius = 6378137;
    const x = radius * ((lon * Math.PI) / 180);
    const y = radius * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
          geometry: { type: 'Point', coordinates: [x, y] },
        },
      ],
    });
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };

    const table = toArrowTable(dataset, {
      encoding: 'wkb',
      bboxColumn: 'bbox',
      reprojectToWgs84: true,
    });
    expect(parseGeoMetadata(table.schema.metadata)?.columns.geometry).not.toHaveProperty('crs');

    const decoded = decodeWkb(table.getChild('geometry')!.get(0) as Uint8Array);
    expect(decoded?.type).toBe('point');
    const point = decoded?.type === 'point' ? decoded.points[0] : null;
    expect(point?.[0]).toBeCloseTo(lon, 8);
    expect(point?.[1]).toBeCloseTo(lat, 8);
    const bbox = table.getChild('bbox')!.get(0)?.toJSON() as Record<string, number>;
    expect(bbox.xmin).toBeCloseTo(lon, 8);
    expect(bbox.ymin).toBeCloseTo(lat, 8);
    expect(bbox.xmax).toBeCloseTo(lon, 8);
    expect(bbox.ymax).toBeCloseTo(lat, 8);

    const back = fromArrowTable(table);
    expect(back.info?.crs_string).toBe('EPSG:4326');
    const importedPoint = back.layers[0].shapes?.[0]?.[0];
    if (!Array.isArray(importedPoint)) throw new Error('Expected imported point coordinates');
    expect(importedPoint?.[0]).toBeCloseTo(lon, 8);
    expect(importedPoint?.[1]).toBeCloseTo(lat, 8);
  });

  it('degrades mixed-type attribute columns to strings', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { v: 1 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          properties: { v: 'two' },
          geometry: { type: 'Point', coordinates: [1, 1] },
        },
      ],
    });
    const table = toArrowTable(dataset);
    expect(table.getChild('v')!.get(0)).toBe('1');
    expect(table.getChild('v')!.get(1)).toBe('two');
  });
});
