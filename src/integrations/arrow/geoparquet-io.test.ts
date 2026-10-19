import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportGeoParquet, importGeoParquet } from './geoparquet-io';
import { setParquetWasm } from './parquet-wasm-loader';
import { datasetFromGeoJSON, injectParquetWasmForTests } from './test-utils';
import { tableFromIPC } from 'apache-arrow';
import { parseGeoMetadata } from './geoparquet-metadata';
import type { ParquetWasmModule } from './parquet-wasm-loader';
import { readFile } from 'node:fs/promises';

let wasm: ParquetWasmModule;

beforeAll(async () => {
  wasm = await injectParquetWasmForTests();
}, 30000);

afterAll(() => setParquetWasm(null));

const localEpsgIndexFetch: typeof fetch = async (input) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const match = /\/s\/([^/]+\.json)$/.exec(url.pathname);
  if (!match) return new Response(null, { status: 404 });
  const bytes = await readFile(
    new URL(`../../../node_modules/@zwishing/epsg-index/s/${match[1]}`, import.meta.url),
  );
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

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
    const bytes = await exportGeoParquet(dataset, { reprojectToWgs84: false });
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
    expect(recs[0]).not.toHaveProperty('bbox');
    expect(recs[1]).not.toHaveProperty('bbox');
  });

  it('writes GeoParquet bbox covering metadata by default', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    const bytes = await exportGeoParquet(dataset, { reprojectToWgs84: false });
    const file = await wasm.ParquetFile.fromFile(new Blob([bytes.slice()]));
    const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
    const column = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry;
    expect(column?.covering?.bbox).toEqual({
      xmin: ['bbox', 'xmin'],
      ymin: ['bbox', 'ymin'],
      xmax: ['bbox', 'xmax'],
      ymax: ['bbox', 'ymax'],
    });

    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    expect(table.schema.fields.map((field) => field.name)).toContain('bbox');
    expect(table.getChild('bbox')!.get(0)?.toJSON()).toEqual({
      xmin: 0,
      ymin: 0,
      xmax: 4,
      ymax: 4,
    });
  });

  it('keeps an existing bbox attribute and writes covering metadata to a suffixed bbox column', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { bbox: 'attribute', id: 1 },
          geometry: { type: 'Point', coordinates: [7, 8] },
        },
      ],
    });

    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    expect(table.schema.fields.map((field) => field.name)).toContain('bbox_1');
    expect(table.getChild('bbox')!.get(0)).toBe('attribute');
    expect(table.getChild('bbox_1')!.get(0)?.toJSON()).toEqual({
      xmin: 7,
      ymin: 8,
      xmax: 7,
      ymax: 8,
    });

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes.slice()]));
    try {
      const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
      const column = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry;
      expect(column?.covering?.bbox).toEqual({
        xmin: ['bbox_1', 'xmin'],
        ymin: ['bbox_1', 'ymin'],
        xmax: ['bbox_1', 'xmax'],
        ymax: ['bbox_1', 'ymax'],
      });
    } finally {
      file.free?.();
    }

    const back = await importGeoParquet(bytes);
    const records = back.layers[0].data!.getRecords!() as Array<Record<string, unknown>>;
    expect(records[0].bbox).toBe('attribute');
    expect(records[0]).not.toHaveProperty('bbox_1');
  });

  it('does not declare geoarrow extension types in the embedded arrow schema', async () => {
    // GDAL ≥ 3.11 (libarrow ≥ 21) rejects parquet columns typed as
    // `geoarrow.wkb` Arrow extensions unless the parquet column uses the
    // native GEOMETRY/GEOGRAPHY logical type, which parquet-wasm cannot
    // write — the column then loses its CRS ("coordinateSystem: null" in
    // ogrinfo). The parquet container must rely on `geo` metadata alone.
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
    const bytes = await exportGeoParquet(dataset, { reprojectToWgs84: false });

    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const geomField = table.schema.fields.find((f) => f.name === 'geometry');
    expect(geomField).toBeDefined();
    expect(geomField?.metadata.has('ARROW:extension:name')).toBe(false);
    expect(geomField?.metadata.has('ARROW:extension:metadata')).toBe(false);

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes.slice()]));
    try {
      const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
      expect(fileGeo).toEqual(expect.any(String));
      const column = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry;
      expect(column?.encoding).toBe('WKB');
      expect(column?.crs).toMatchObject({
        id: { authority: 'EPSG', code: 3857 },
      });
    } finally {
      file.free?.();
    }

    // Still a fully usable GeoParquet: geo metadata intact, CRS round-trips.
    expect(parseGeoMetadata(table.schema.metadata)?.columns.geometry.encoding).toBe('WKB');
    const back = await importGeoParquet(bytes);
    expect(back.layers[0].shapes).toHaveLength(2);
    expect(back.info?.crs_string).toBe('EPSG:3857');
  });

  it('round-trips via native encoding option', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    const bytes = await exportGeoParquet(dataset, { encoding: 'native' });
    const back = await importGeoParquet(bytes);
    expect(back.layers[0].shapes).toHaveLength(2);
    expect(back.layers[0].geometry_type).toBe('polygon');
  });

  it('can reproject EPSG:3857 exports to default WGS84 lon/lat when requested', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
    const bytes = await exportGeoParquet(dataset, { reprojectToWgs84: true });

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes.slice()]));
    try {
      const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
      expect(typeof fileGeo).toBe('string');
      expect(parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.primary_column).toBe(
        'geometry',
      );
    } finally {
      file.free?.();
    }

    // Inspect the raw arrow table parquet-wasm yields
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const geo = parseGeoMetadata(table.schema.metadata);
    expect(geo?.version).toBe('1.1.0');
    expect(geo?.primary_column).toBe('geometry');
    expect(geo?.columns.geometry.encoding).toBe('WKB');
    expect(geo?.columns.geometry.geometry_types).toEqual(['Polygon', 'MultiPolygon']);
    expect(geo?.columns.geometry).not.toHaveProperty('crs');
    expect(geo?.columns.geometry.bbox?.every((value) => Math.abs(value) <= 180)).toBe(true);

    const back = await importGeoParquet(bytes);
    expect(back.info?.crs_string).toBe('EPSG:4326');
  });

  it('preserves EPSG:3857 geo metadata by default', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const geo = parseGeoMetadata(table.schema.metadata);

    expect(geo?.columns.geometry.bbox).toEqual([0, 0, 22, 22]);
    expect(geo?.columns.geometry.crs).toMatchObject({
      type: 'ProjectedCRS',
      name: 'WGS 84 / Pseudo-Mercator',
      id: { authority: 'EPSG', code: 3857 },
    });
    expect(geo?.columns.geometry.crs).toHaveProperty('base_crs');
    expect(geo?.columns.geometry.crs).toHaveProperty('base_crs.datum');
    expect(geo?.columns.geometry.crs).toHaveProperty('coordinate_system');

    const back = await importGeoParquet(bytes);
    expect(back.info?.crs_string).toBe('EPSG:3857');
  });

  it('writes full PROJJSON CRS metadata for EPSG codes from epsg-index', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4490' };
    const bytes = await exportGeoParquet(dataset, { fetch: localEpsgIndexFetch });

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes.slice()]));
    try {
      const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
      const fileCrs = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry.crs;

      expect(fileCrs).toMatchObject({
        type: 'GeographicCRS',
        name: 'China Geodetic Coordinate System 2000',
        id: { authority: 'EPSG', code: 4490 },
      });
      expect(fileCrs).toHaveProperty(
        '$schema',
        'https://proj.org/schemas/v0.7/projjson.schema.json',
      );
      expect(fileCrs).toHaveProperty('datum');
      expect(fileCrs).toHaveProperty('coordinate_system');
      expect(fileCrs).toHaveProperty('coordinate_system.axis', [
        expect.objectContaining({ direction: 'north' }),
        expect.objectContaining({ direction: 'east' }),
      ]);
    } finally {
      file.free?.();
    }

    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const geo = parseGeoMetadata(table.schema.metadata);
    expect(geo?.columns.geometry.crs).toMatchObject({
      type: 'GeographicCRS',
      id: { authority: 'EPSG', code: 4490 },
    });
    expect(geo?.columns.geometry.crs).toHaveProperty(
      '$schema',
      'https://proj.org/schemas/v0.7/projjson.schema.json',
    );
    expect(
      (
        geo?.columns.geometry.crs as {
          coordinate_system: { axis: Array<{ direction: string }> };
        }
      ).coordinate_system.axis.map((axis) => axis.direction),
    ).toEqual(['north', 'east']);

    const back = await importGeoParquet(bytes);
    expect(back.info?.crs_string).toBe('EPSG:4490');
  });

  it('rejects export when a known EPSG CRS cannot resolve to PROJJSON', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4490' };

    await expect(
      exportGeoParquet(dataset, {
        baseUrl: 'https://export-epsg-failure.example/pkg/',
        fetch: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow('EPSG:4490 PROJJSON fetch failed with HTTP 404 Not Found');
  });

  it('rejects export for custom CRS labels instead of writing unknown CRS', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: '+proj=utm +zone=10' };

    await expect(exportGeoParquet(dataset)).rejects.toThrow(
      "GeoParquet export cannot express CRS '+proj=utm +zone=10' as PROJJSON",
    );
  });

  it('omits CRS metadata for GeoParquet default WGS84 lon/lat data', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;

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
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;

    expect(column?.crs).toBeNull();
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
