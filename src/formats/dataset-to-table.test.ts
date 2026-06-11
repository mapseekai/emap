import { describe, expect, it, vi, afterEach } from 'vitest';
import { toArrowTable } from './dataset-to-table';
import { parseGeoMetadata } from './geoparquet-metadata';
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
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry as Record<
      string,
      unknown
    >;
    expect(column.crs).toBeNull();
    expect(JSON.parse(table.schema.fields.at(-1)!.metadata.get('ARROW:extension:metadata')!)).toEqual(
      { crs: null },
    );
  });

  it('writes crs:null when source data has no explicit CRS metadata', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    delete dataset.info?.crs_string;
    delete dataset.info?.prj;
    delete dataset.info?.wkt1;
    delete dataset.info?.crs;

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry as Record<
      string,
      unknown
    >;
    expect(column.crs).toBeNull();
  });

  it('omits CRS for GeoParquet default WGS84 lon/lat data', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };

    const table = toArrowTable(dataset, { encoding: 'wkb' });
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry as Record<
      string,
      unknown
    >;
    expect(column).not.toHaveProperty('crs');
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
