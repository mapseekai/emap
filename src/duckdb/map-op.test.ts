import { tableFromArrays, type Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import {
  duckDbBufferLayer,
  duckDbGeoParquetQueryLayer,
  duckDbGeometryLayer,
  duckDbOverlayLayer,
  duckDbQueryLayer,
  duckDbRelationLayer,
  type DuckDbMapOpContext,
  type DuckDbMapOpSource,
} from './map-op';
import { buildBufferSql } from './duckdb-sql';

const POLYGON_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a' },
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

async function polygonDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

class FakeSource implements DuckDbMapOpSource {
  constructor(
    private readonly dataset: MapshaperDataset | null | undefined,
    private readonly bytes?: Uint8Array | ArrayBuffer | null,
  ) {}

  getDataset(): MapshaperDataset | null | undefined {
    return this.dataset;
  }

  getBytes(): Uint8Array | ArrayBuffer | null | undefined {
    return this.bytes;
  }
}

class FakeContext implements DuckDbMapOpContext {
  readonly sources = new Map<string, DuckDbMapOpSource>();
  readonly outputDatasets = new Map<string, MapshaperDataset>();

  getSource(id: string): DuckDbMapOpSource | null | undefined {
    return this.sources.get(id);
  }

  setSourceDataset(id: string, dataset: MapshaperDataset): void {
    this.outputDatasets.set(id, dataset);
  }
}

class FakeConnection implements DuckDbConnection {
  readonly queries: string[] = [];
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];

  constructor(
    private readonly resultTable: Table,
    private readonly queryError?: unknown,
  ) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (this.queryError) throw this.queryError;
    return this.resultTable;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;

  constructor(resultTable: Table, queryError?: unknown) {
    this.connection = new FakeConnection(resultTable, queryError);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {}

  async registerFileBuffer(): Promise<void> {}

  async dropFile(): Promise<void> {}
}

function makeContext(sourceId: string, dataset: MapshaperDataset | null | undefined): FakeContext {
  const ctx = new FakeContext();
  ctx.sources.set(sourceId, new FakeSource(dataset));
  return ctx;
}

function makeByteContext(
  sourceId: string,
  bytes: Uint8Array | ArrayBuffer | null | undefined,
): FakeContext {
  const ctx = new FakeContext();
  ctx.sources.set(sourceId, new FakeSource(undefined, bytes));
  return ctx;
}

describe('duckDbBufferLayer', () => {
  it('reads a source dataset and creates a new output source after success', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    const result = await duckDbBufferLayer(ctx, {
      src: 'src',
      distance: 5,
      output: { sourceId: 'buffered' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('buffered')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('buffered');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('buffered'));
    }
  });

  it('does not create output source when buffer processing fails', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(
      toArrowTable(dataset, { encoding: 'wkb' }),
      new Error('query exploded'),
    );

    const result = await duckDbBufferLayer(ctx, {
      src: 'src',
      distance: 5,
      output: { sourceId: 'buffered' },
      runtime,
    });

    expect(result.ok).toBe(false);
    expect(ctx.outputDatasets.has('buffered')).toBe(false);
  });

  it('returns validation error when source has no dataset', async () => {
    const ctx = makeContext('src', null);

    const result = await duckDbBufferLayer(ctx, {
      src: 'src',
      distance: 5,
      output: { sourceId: 'buffered' },
      runtime: new FakeRuntime(toArrowTable(await polygonDataset(), { encoding: 'wkb' })),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'src',
        reason: "Source 'src' does not have a loaded dataset",
      },
    });
  });

  it('passes layer and distance options to bufferDatasetWithDuckDb', async () => {
    const dataset = await polygonDataset();
    dataset.layers[0]!.name = 'parcels';
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(toArrowTable(dataset, { layer: 'parcels', encoding: 'wkb' }));

    const result = await duckDbBufferLayer(ctx, {
      src: 'src',
      layer: 'parcels',
      distance: 12.5,
      output: { sourceId: 'buffered' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(runtime.connection.inserted).toHaveLength(1);
    const inputTableName = runtime.connection.inserted[0]!.opts.name;
    expect(runtime.connection.queries).toEqual([
      buildBufferSql({
        tableName: inputTableName,
        geometryColumn: 'geometry',
        distance: 12.5,
      }),
      `DROP TABLE IF EXISTS ${inputTableName}`,
    ]);
  });
});

describe('duckDbGeometryLayer', () => {
  it('runs a unary geometry operation and creates a new output source', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    const result = await duckDbGeometryLayer(ctx, {
      src: 'src',
      operation: 'centroid',
      output: { sourceId: 'centroids' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('centroids')).toBe(true);
    expect(runtime.connection.queries[0]).toContain('ST_Centroid("geometry")');
  });

  it('returns not-found when the input source is missing', async () => {
    const ctx = new FakeContext();

    const result = await duckDbGeometryLayer(ctx, {
      src: 'missing',
      operation: 'centroid',
      output: { sourceId: 'centroids' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns validation when output source id is missing', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);

    const result = await duckDbGeometryLayer(ctx, {
      src: 'src',
      operation: 'centroid',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
  });

  it('returns validation for an unknown operation', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);

    const result = await duckDbGeometryLayer(ctx, {
      src: 'src',
      operation: 'unknown',
      output: { sourceId: 'out' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'operation',
        reason: "Unknown DuckDB geometry operation 'unknown'",
      },
    });
    expect(ctx.outputDatasets.has('out')).toBe(false);
  });

  it('does not create output source when processing fails', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(
      toArrowTable(dataset, { encoding: 'wkb' }),
      new Error('query failed'),
    );

    const result = await duckDbGeometryLayer(ctx, {
      src: 'src',
      operation: 'centroid',
      output: { sourceId: 'centroids' },
      runtime,
    });

    expect(result.ok).toBe(false);
    expect(ctx.outputDatasets.has('centroids')).toBe(false);
  });
});

describe('duckDbQueryLayer', () => {
  it('writes an output source dataset after a successful SELECT query', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(tableFromArrays({ __emap_rowid: [0], name: ['a'] }));

    const result = await duckDbQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT name FROM input',
      output: { sourceId: 'query' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('query')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('query');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('query'));
      expect(result.value.dataset.layers[0]!.data?.getRecords()).toEqual([{ name: 'a' }]);
    }
  });

  it('returns not-found when the input source is missing', async () => {
    const ctx = new FakeContext();

    const result = await duckDbQueryLayer(ctx, {
      src: 'missing',
      sql: 'SELECT name FROM input',
      output: { sourceId: 'query' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns validation when output source id is missing', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);

    const result = await duckDbQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT name FROM input',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
  });

  it('maps SQL validation errors to validation results', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);

    const result = await duckDbQueryLayer(ctx, {
      src: 'src',
      sql: 'DELETE FROM input',
      output: { sourceId: 'query' },
      runtime: new FakeRuntime(tableFromArrays({ __emap_rowid: [0], name: ['a'] })),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'sql' },
    });
    expect(ctx.outputDatasets.has('query')).toBe(false);
  });

  it('does not create output source when query processing fails', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    const runtime = new FakeRuntime(
      tableFromArrays({ __emap_rowid: [0], name: ['a'] }),
      new Error('query failed'),
    );

    const result = await duckDbQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT name FROM input',
      output: { sourceId: 'query' },
      runtime,
    });

    expect(result.ok).toBe(false);
    expect(ctx.outputDatasets.has('query')).toBe(false);
  });
});

describe('duckDbGeoParquetQueryLayer', () => {
  it('writes an output source dataset after a successful GeoParquet query', async () => {
    const dataset = await polygonDataset();
    const ctx = makeByteContext('src', new Uint8Array([80, 65, 82, 49]));
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry, name FROM input',
      output: { sourceId: 'query' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('query')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('query');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('query'));
    }
  });

  it('returns not-found when the byte source is missing', async () => {
    const result = await duckDbGeoParquetQueryLayer(new FakeContext(), {
      src: 'missing',
      sql: 'SELECT geometry FROM input',
      output: { sourceId: 'query' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns validation when the source does not expose bytes', async () => {
    const ctx = makeContext('src', await polygonDataset());

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry FROM input',
      output: { sourceId: 'query' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'src',
        reason: "Source 'src' does not expose GeoParquet bytes",
      },
    });
  });

  it('returns validation when output source id is missing', async () => {
    const ctx = makeByteContext('src', new Uint8Array([1]));

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry FROM input',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
  });

  it('returns validation and leaves output empty for invalid GeoParquet SQL', async () => {
    const dataset = await polygonDataset();
    const ctx = makeByteContext('src', new Uint8Array([80, 65, 82, 49]));
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: "SELECT geometry FROM read_parquet('other.parquet')",
      output: { sourceId: 'query' },
      runtime,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: 'validation', field: 'sql' });
    }
    expect(ctx.outputDatasets.has('query')).toBe(false);
  });

  it('returns mapshaper and leaves output empty when GeoParquet query fails', async () => {
    const dataset = await polygonDataset();
    const ctx = makeByteContext('src', new Uint8Array([80, 65, 82, 49]));
    const runtime = new FakeRuntime(
      toArrowTable(dataset, { encoding: 'wkb' }),
      new Error('query failed'),
    );

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry, name FROM input',
      output: { sourceId: 'query' },
      runtime,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        kind: 'mapshaper',
        operation: 'duckdb-geoparquet-query',
      });
    }
    expect(ctx.outputDatasets.has('query')).toBe(false);
  });
});

describe('duckDbRelationLayer', () => {
  it('writes an output source dataset in filter mode', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(toArrowTable(input, { encoding: 'wkb' }));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'filter',
      operation: 'intersects',
      output: { sourceId: 'filtered' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('filtered')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('filtered');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('filtered'));
    }
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.queries.join('\n')).toContain('ST_Intersects');
  });

  it('writes an output source dataset in attribute mode', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(toArrowTable(input, { encoding: 'wkb' }));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'attribute',
      operation: 'intersects',
      output: { sourceId: 'joined' },
      outputColumn: 'touches_mask',
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('joined')).toBe(true);
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.queries.join('\n')).toContain('touches_mask');
  });

  it('returns validation for an unknown relation operation', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    ctx.sources.set('mask', new FakeSource(dataset));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'filter',
      operation: 'unknown',
      output: { sourceId: 'out' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'operation' },
    });
  });

  it('returns validation when distance is requested in filter mode', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    ctx.sources.set('mask', new FakeSource(dataset));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'filter',
      operation: 'distance',
      output: { sourceId: 'out' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'operation' },
    });
  });

  it('returns validation for an unknown relation mode', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    ctx.sources.set('mask', new FakeSource(dataset));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'unknown',
      operation: 'intersects',
      output: { sourceId: 'out' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'mode' },
    });
  });

  it('returns not-found when the input source is missing', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('mask', dataset);

    const result = await duckDbRelationLayer(ctx, {
      src: 'missing',
      mask: 'mask',
      mode: 'filter',
      operation: 'intersects',
      output: { sourceId: 'out' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns not-found when the mask source is missing', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'missing',
      mode: 'filter',
      operation: 'intersects',
      output: { sourceId: 'out' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns validation with mask field when the mask source has no dataset', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    ctx.sources.set('mask', new FakeSource(null));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'filter',
      operation: 'intersects',
      output: { sourceId: 'out' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'mask',
        reason: "Source 'mask' does not have a loaded dataset",
      },
    });
  });

  it('returns validation when output source id is missing', async () => {
    const dataset = await polygonDataset();
    const ctx = makeContext('src', dataset);
    ctx.sources.set('mask', new FakeSource(dataset));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'filter',
      operation: 'intersects',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
  });

  it('passes distance through to distanceWithin', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(toArrowTable(input, { encoding: 'wkb' }));

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode: 'filter',
      operation: 'distanceWithin',
      distance: 12.5,
      output: { sourceId: 'nearby' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(runtime.connection.queries.join('\n')).toContain('12.5');
  });
});

describe('duckDbOverlayLayer', () => {
  it('writes overlay result to output source on success', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(toArrowTable(input, { encoding: 'wkb' }));

    const result = await duckDbOverlayLayer(ctx, {
      src: 'src',
      mask: 'mask',
      operation: 'intersection',
      output: { sourceId: 'overlay' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('overlay')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('overlay');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('overlay'));
    }
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.queries.join('\n')).toContain('ST_Intersection');
  });

  it('returns not-found and does not write output when mask source is missing', async () => {
    const input = await polygonDataset();
    const ctx = makeContext('src', input);

    const result = await duckDbOverlayLayer(ctx, {
      src: 'src',
      mask: 'missing',
      operation: 'intersection',
      output: { sourceId: 'overlay' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
    expect(ctx.outputDatasets.has('overlay')).toBe(false);
  });

  it('returns validation and does not write output when output source id is missing', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));

    const result = await duckDbOverlayLayer(ctx, {
      src: 'src',
      mask: 'mask',
      operation: 'intersection',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
    expect(ctx.outputDatasets.size).toBe(0);
  });

  it('returns failure and does not write output when DuckDB processing fails', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(
      toArrowTable(input, { encoding: 'wkb' }),
      new Error('query failed'),
    );

    const result = await duckDbOverlayLayer(ctx, {
      src: 'src',
      mask: 'mask',
      operation: 'difference',
      output: { sourceId: 'overlay' },
      runtime,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        kind: 'mapshaper',
        operation: 'duckdb-difference-overlay',
      });
    }
    expect(ctx.outputDatasets.has('overlay')).toBe(false);
  });
});
