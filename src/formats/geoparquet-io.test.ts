import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportGeoParquet, importGeoParquet } from './geoparquet-io';
import { setParquetWasm } from './parquet-wasm-loader';
import { datasetFromGeoJSON, injectParquetWasmForTests } from './test-utils';
import { tableFromIPC } from 'apache-arrow';
import { parseGeoMetadata } from './geoparquet-metadata';
import type { ParquetWasmModule } from './parquet-wasm-loader';

let wasm: ParquetWasmModule;

beforeAll(async () => {
  wasm = await injectParquetWasmForTests();
}, 30000);

afterAll(() => setParquetWasm(null));

const FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'alpha', pop: 1200 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'beta', pop: 3400 },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [10, 10],
              [12, 10],
              [12, 12],
              [10, 12],
              [10, 10],
            ],
          ],
          [
            [
              [20, 20],
              [22, 20],
              [22, 22],
              [20, 22],
              [20, 20],
            ],
          ],
        ],
      },
    },
  ],
};

describe('GeoParquet round trip', () => {
  it('round-trips polygons via WKB encoding (default)', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    const bytes = await exportGeoParquet(dataset);
    expect(bytes.length).toBeGreaterThan(0);
    // parquet magic
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('PAR1');

    const back = await importGeoParquet(bytes);
    const layer = back.layers[0];
    expect(layer.geometry_type).toBe('polygon');
    expect(layer.shapes).toHaveLength(2);
    expect(layer.shapes![1]).toHaveLength(2); // multipolygon kept both parts
    const recs = layer.data!.getRecords!() as Array<Record<string, unknown>>;
    expect(recs.map((r) => r.name)).toEqual(['alpha', 'beta']);
    expect(recs.map((r) => r.pop)).toEqual([1200, 3400]);
  });

  it('round-trips via native encoding option', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    const bytes = await exportGeoParquet(dataset, { encoding: 'native' });
    const back = await importGeoParquet(bytes);
    expect(back.layers[0].shapes).toHaveLength(2);
    expect(back.layers[0].geometry_type).toBe('polygon');
  });

  it('preserves geo metadata through the parquet container', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
    const bytes = await exportGeoParquet(dataset);

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes]));
    try {
      const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
      expect(typeof fileGeo).toBe('string');
      expect(parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.primary_column).toBe('geometry');
    } finally {
      file.free?.();
    }

    // Inspect the raw arrow table parquet-wasm yields
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const geo = parseGeoMetadata(table.schema.metadata);
    expect(geo?.version).toBe('1.1.0');
    expect(geo?.primary_column).toBe('geometry');
    expect(geo?.columns.geometry.encoding).toBe('WKB');
    expect(geo?.columns.geometry.geometry_types).toEqual(['MultiPolygon']);
    expect(geo?.columns.geometry.bbox).toEqual([0, 0, 22, 22]);
    expect(geo?.columns.geometry.crs).toMatchObject({
      type: 'ProjectedCRS',
      name: 'WGS 84 / Pseudo-Mercator',
      id: { authority: 'EPSG', code: 3857 },
    });
    expect(geo?.columns.geometry.crs).toHaveProperty('base_crs');
    expect(geo?.columns.geometry.crs).toHaveProperty('coordinate_system');

    const back = await importGeoParquet(bytes);
    expect(back.info?.crs_string).toBe('EPSG:3857');
  });

  it('writes full PROJJSON CRS metadata for EPSG codes from epsg-index', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4490' };
    const bytes = await exportGeoParquet(dataset);

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes]));
    try {
      const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
      const fileCrs = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry
        .crs as Record<string, unknown>;

      expect(fileCrs).toMatchObject({
        type: 'GeographicCRS',
        name: 'China Geodetic Coordinate System 2000',
        id: { authority: 'EPSG', code: 4490 },
      });
      expect(fileCrs).toHaveProperty('datum');
      expect(fileCrs).toHaveProperty('coordinate_system');
    } finally {
      file.free?.();
    }

    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const geo = parseGeoMetadata(table.schema.metadata);
    expect(geo?.columns.geometry.crs).toMatchObject({
      type: 'GeographicCRS',
      id: { authority: 'EPSG', code: 4490 },
    });

    const back = await importGeoParquet(bytes);
    expect(back.info?.crs_string).toBe('EPSG:4490');
  });

  it('omits CRS metadata for GeoParquet default WGS84 lon/lat data', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry as Record<
      string,
      unknown
    >;

    expect(column).not.toHaveProperty('crs');
    expect((await importGeoParquet(bytes)).info?.crs_string).toBe('EPSG:4326');
  });

  it('writes unknown CRS metadata when the source has no explicit CRS', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    delete dataset.info?.crs_string;
    delete dataset.info?.prj;
    delete dataset.info?.wkt1;
    delete dataset.info?.crs;
    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry as Record<
      string,
      unknown
    >;

    expect(column.crs).toBeNull();
    expect((await importGeoParquet(bytes)).info?.crs_string).toBe('EPSG:4326');
  });

  it('supports compression options', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    for (const compression of ['snappy', 'gzip', 'zstd', 'none'] as const) {
      const bytes = await exportGeoParquet(dataset, { compression });
      const back = await importGeoParquet(bytes);
      expect(back.layers[0].shapes).toHaveLength(2);
    }
    await expect(exportGeoParquet(dataset, { compression: 'bogus' as never })).rejects.toThrow(
      /compression/i,
    );
  });

  it('reads duckdb-style tables: plain Binary geometry column, BigInt ids', async () => {
    // Simulate a duckdb-wasm result: WKB Binary column named `geometry`
    // with no geo metadata at all, plus an Int64 column.
    const dataset = await datasetFromGeoJSON(FC);
    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());

    // Strip schema + field metadata to force the heuristic path
    const {
      Schema,
      Field,
      Table: ArrowTable,
      RecordBatch,
      makeData,
      Struct,
    } = await import('apache-arrow');
    const bareFields = table.schema.fields.map((f) => new Field(f.name, f.type, f.nullable));
    const bareSchema = new Schema(bareFields);
    const batch = table.batches[0];
    const structData = makeData({
      type: new Struct(bareFields),
      children: bareFields.map((_, i) => batch.data.children[i]),
      length: batch.numRows,
      nullCount: 0,
    });
    const bare = new ArrowTable(bareSchema, [new RecordBatch(bareSchema, structData)]);

    const { fromArrowTable } = await import('./table-to-dataset');
    const back = fromArrowTable(bare);
    expect(back.layers[0].geometry_type).toBe('polygon');
    expect(back.layers[0].shapes).toHaveLength(2);
    expect(back.info?.crs_string).toBeUndefined();
  });
});
