import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import { parseGeoMetadata } from '../arrow/geoparquet-metadata';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { processOverlayWithDuckDb, type DuckDbOverlayOperationSpec } from './overlay-executor';
import type { DuckDbConnection, DuckDbRuntime } from './runtime';
import { buildOverlaySql } from './sql';

const INPUT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'parcel-a', zone: 'A' },
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
        ],
      },
    },
  ],
};

const MASK_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'mask-a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [5, 5],
            [15, 5],
            [15, 15],
            [5, 15],
            [5, 5],
          ],
        ],
      },
    },
  ],
};

const EMPTY_MASK_FC = {
  type: 'FeatureCollection',
  features: [],
};

const INTERSECTION_SPEC = {
  id: 'intersection',
  duckDbFunction: 'ST_Intersection',
} as const satisfies DuckDbOverlayOperationSpec;

async function inputDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INPUT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function maskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(MASK_FC);
}

async function emptyMaskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(EMPTY_MASK_FC);
}

type FakeRuntimeOptions = {
  queryError?: unknown;
  dropError?: unknown;
  closeError?: unknown;
};

class FakeConnection implements DuckDbConnection {
  readonly events: string[];
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];

  constructor(
    private readonly resultTable: Table,
    events: string[],
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.events = events;
  }

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
    this.events.push(`insert:${opts.name}`);
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (sql.startsWith('DROP TABLE IF EXISTS')) {
      const tableName = sql.replace('DROP TABLE IF EXISTS ', '').replace(/^"|"$/g, '');
      this.events.push(`drop:${tableName}`);
      if (this.options.dropError) throw this.options.dropError;
      return this.resultTable;
    }

    this.events.push('query:overlay');
    if (this.options.queryError) throw this.options.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.events.push('close');
    if (this.options.closeError) throw this.options.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly events: string[] = [];
  readonly connection: FakeConnection;

  constructor(
    resultTable: Table,
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.connection = new FakeConnection(resultTable, this.events, options);
  }

  async ensureSpatial(): Promise<void> {
    this.events.push('ensureSpatial');
  }

  async connect(): Promise<DuckDbConnection> {
    this.events.push('connect');
    return this.connection;
  }
}

describe('buildOverlaySql', () => {
  it('builds intersection SQL that unions mask geometry once', () => {
    const sql = buildOverlaySql({
      duckDbFunction: 'ST_Intersection',
      inputGeometryColumn: 'geom',
      inputTableName: 'input table',
      maskGeometryColumn: 'mask geom',
      maskTableName: 'mask table',
    });

    expect(sql).toContain('ST_Union_Agg(m."mask geom") AS mask_geometry');
    expect(sql).toContain('FROM "mask table" AS m');
    expect(sql).toContain('FROM "input table" AS i');
    expect(sql).toContain('ST_Intersection(i."geom", mask_coverage.mask_geometry)');
    expect(sql).toContain('ST_AsWKB(overlay_geometry) AS "geom"');
    expect(sql).toContain('WHERE i."geom" IS NOT NULL');
    expect(sql).toContain('AND mask_coverage.mask_geometry IS NOT NULL');
    expect(sql).toContain('overlay_geometry IS NOT NULL');
  });

  it('builds difference SQL with fixed DuckDB Spatial function names', () => {
    const sql = buildOverlaySql({
      duckDbFunction: 'ST_Difference',
      inputGeometryColumn: 'geometry',
      inputTableName: 'input',
      maskGeometryColumn: 'geometry',
      maskTableName: 'mask',
    });

    expect(sql).toContain('ST_Difference(i."geometry", mask_coverage.mask_geometry)');
    expect(sql).toContain('i.* EXCLUDE ("geometry")');
    expect(sql).toContain('AND TRUE');
    expect(sql).toContain('NOT ST_IsEmpty(overlay.overlay_geometry)');
  });

  it('rejects unsafe overlay function names', () => {
    expect(() =>
      buildOverlaySql({
        duckDbFunction: 'ST_Intersection); DROP TABLE x; --' as never,
        inputGeometryColumn: 'geometry',
        inputTableName: 'input',
        maskGeometryColumn: 'geometry',
        maskTableName: 'mask',
      }),
    ).toThrow(/Unsafe DuckDB function name/);
  });
});

describe('processOverlayWithDuckDb', () => {
  it('registers input and mask tables, runs overlay SQL, cleans up, and preserves input CRS', async () => {
    const input = await inputDataset('EPSG:3857');
    input.info = { crs: { projName: 'merc', a: 6378137 } };
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    resultTable.schema.metadata.clear();
    resultTable.schema.fields.at(-1)!.metadata.clear();
    const runtime = new FakeRuntime(resultTable);

    const result = await processOverlayWithDuckDb(
      input,
      mask,
      { outputLayer: 'clipped_parcels' },
      INTERSECTION_SPEC,
      runtime,
    );

    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    const maskTableName = runtime.connection.inserted[1]!.opts.name;
    expect(inputTableName).toMatch(/^emap_duckdb_overlay_input_/);
    expect(maskTableName).toMatch(/^emap_duckdb_overlay_mask_/);
    const maskCrs = parseGeoMetadata(runtime.connection.inserted[1]!.table.schema.metadata)?.columns
      .geometry.crs as { id?: { authority?: string; code?: number } };
    expect(maskCrs.id).toEqual({ authority: 'EPSG', code: 3857 });
    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      `insert:${inputTableName}`,
      `insert:${maskTableName}`,
      'query:overlay',
      `drop:${inputTableName}`,
      `drop:${maskTableName}`,
      'close',
    ]);
    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
    expect(result.layers[0]?.name).toBe('clipped_parcels');
    expect(result.info?.crs_string).toBe('EPSG:3857');
  });

  it('wraps input conversion failures as conversion-failed', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await expect(
      processOverlayWithDuckDb(
        input,
        mask,
        { inputLayer: 'missing-layer' },
        INTERSECTION_SPEC,
        runtime,
      ),
    ).rejects.toMatchObject({
      kind: 'conversion-failed',
      message: 'DuckDB intersection input could not be converted to Arrow',
    });
    expect(runtime.events).toEqual([]);
  });

  it('converts an empty no-geometry mask as an empty mask table', async () => {
    const input = await inputDataset();
    const mask = await emptyMaskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);

    await processOverlayWithDuckDb(input, mask, {}, INTERSECTION_SPEC, runtime);

    expect(runtime.connection.inserted[1]?.table.numRows).toBe(0);
    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
  });

  it('preserves the primary query error when close also fails', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const queryError = new Error('query failed');
    const closeError = new Error('close failed');
    const runtime = new FakeRuntime(resultTable, { queryError, closeError });

    await expect(
      processOverlayWithDuckDb(input, mask, {}, INTERSECTION_SPEC, runtime),
    ).rejects.toMatchObject({
      kind: 'query-failed',
      message: 'DuckDB intersection query failed',
      cause: queryError,
    });
  });

  it('reports cleanup failure after successful overlay work', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const dropError = new Error('drop failed');
    const runtime = new FakeRuntime(resultTable, { dropError });

    await expect(
      processOverlayWithDuckDb(input, mask, {}, INTERSECTION_SPEC, runtime),
    ).rejects.toMatchObject({
      kind: 'query-failed',
      message: 'DuckDB intersection cleanup failed',
      cause: dropError,
    });
  });
});
