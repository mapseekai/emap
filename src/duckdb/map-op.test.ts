import { tableFromArrays, type Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../arrow/dataset-to-table';
import { parseGeoMetadata } from '../arrow/geoparquet-metadata';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import { DuckDbOperationError } from './duckdb-errors';
import type { DuckDbGeoParquetQuerySource } from './duckdb-geoparquet-query-op';
import {
  duckDbBufferLayer,
  duckDbGeoParquetQueryLayer,
  duckDbGeometryLayer,
  duckDbOverlayLayer,
  duckDbQueryLayer,
  duckDbRelationLayer,
  duckDbSpatialAggregateJoinLayer,
  type DuckDbMapOpContext,
  type DuckDbMapOpSource,
  type DuckDbSpatialAggregateJoinLayerOptions,
  type DuckDbSpatialAggregateJoinLayerResult,
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

const WEB_MERCATOR_WKT = 'PROJCS["Web Mercator",AUTHORITY["EPSG","3857"]]';

async function polygonDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

async function polygonJoinDataset(): Promise<MapshaperDataset> {
  const dataset = await polygonDataset();
  const records = dataset.layers[0]!.data?.getRecords();
  if (!records?.[0]) throw new Error('Expected polygon fixture record');
  records[0].sales = 12;
  return dataset;
}

class FakeSource implements DuckDbMapOpSource {
  constructor(
    private readonly dataset: MapshaperDataset | null | undefined,
    private readonly bytes?: Uint8Array | ArrayBuffer | null,
    private readonly querySource?: DuckDbGeoParquetQuerySource | null,
  ) {}

  getDataset(): MapshaperDataset | null | undefined {
    return this.dataset;
  }

  getBytes(): Uint8Array | ArrayBuffer | null | undefined {
    return this.bytes;
  }

  getGeoParquetQuerySource(): DuckDbGeoParquetQuerySource | null | undefined {
    return this.querySource;
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

function makeGeoParquetQuerySourceContext(
  sourceId: string,
  querySource: DuckDbGeoParquetQuerySource,
): FakeContext {
  const ctx = new FakeContext();
  ctx.sources.set(sourceId, new FakeSource(undefined, null, querySource));
  return ctx;
}

function makeSelectableLayerDataset(
  dataset: MapshaperDataset,
  selectedLayerName: string,
): MapshaperDataset {
  const baseLayer = dataset.layers[0]!;
  const defaultLayer = { ...baseLayer, name: 'default' };
  delete defaultLayer.data;
  dataset.layers = [defaultLayer, { ...baseLayer, name: selectedLayerName }];
  return dataset;
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
    dataset.info = { prj: WEB_MERCATOR_WKT };
    const originalCoordinates = Array.from(dataset.arcs?.getVertexData?.().xx ?? []);
    const ctx = makeContext('src', dataset);
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    resultTable.schema.metadata.clear();
    resultTable.schema.fields.at(-1)!.metadata.clear();
    const runtime = new FakeRuntime(resultTable);

    const result = await duckDbGeometryLayer(ctx, {
      src: 'src',
      operation: 'centroid',
      output: { sourceId: 'centroids' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('centroids')).toBe(true);
    expect(runtime.connection.queries[0]).toContain('ST_Centroid("geometry")');
    if (result.ok) {
      const outputTable = toArrowTable(result.value.dataset, { encoding: 'wkb' });
      const outputCrs = parseGeoMetadata(outputTable.schema.metadata)?.columns.geometry.crs as {
        id?: { authority?: string; code?: number };
      };
      const extensionCrs = JSON.parse(
        outputTable.schema.fields.at(-1)!.metadata.get('ARROW:extension:metadata')!,
      ).crs as { id?: { authority?: string; code?: number } };
      expect(result.value.dataset.info?.crs_string).toBe('EPSG:3857');
      expect(outputCrs.id).toEqual({ authority: 'EPSG', code: 3857 });
      expect(extensionCrs.id).toEqual({ authority: 'EPSG', code: 3857 });
    }
    expect(dataset.info).toEqual({ prj: WEB_MERCATOR_WKT });
    expect(Array.from(dataset.arcs?.getVertexData?.().xx ?? [])).toEqual(originalCoordinates);
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

  it('returns DuckDB validation for an unknown operation', async () => {
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
        kind: 'duckdb',
        operation: 'duckdb-unknown',
        duckDbKind: 'validation',
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

  it('maps SQL validation errors to DuckDB results', async () => {
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
      error: {
        kind: 'duckdb',
        operation: 'duckdb-query',
        duckDbKind: 'validation',
        field: 'sql',
      },
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

  it('queries a reusable GeoParquet query source instead of re-registering bytes', async () => {
    const dataset = await polygonDataset();
    const calls: unknown[] = [];
    const querySource = {
      async query(opts) {
        calls.push(opts);
        return dataset;
      },
      async close() {
        throw new Error('map-op should not own query source cleanup');
      },
    } satisfies DuckDbGeoParquetQuerySource;
    const ctx = makeGeoParquetQuerySourceContext('src', querySource);

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry, name FROM input',
      output: { sourceId: 'query' },
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sql: 'SELECT geometry, name FROM input' });
    expect(ctx.outputDatasets.get('query')).toBe(dataset);
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

  it('returns DuckDB validation and leaves output empty for invalid GeoParquet SQL', async () => {
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
      expect(result.error).toMatchObject({
        kind: 'duckdb',
        operation: 'duckdb-geoparquet-query',
        duckDbKind: 'validation',
        field: 'sql',
      });
    }
    expect(ctx.outputDatasets.has('query')).toBe(false);
  });

  it('returns DuckDB failure and leaves output empty when GeoParquet query fails', async () => {
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
        kind: 'duckdb',
        operation: 'duckdb-geoparquet-query',
        duckDbKind: 'query-failed',
      });
    }
    expect(ctx.outputDatasets.has('query')).toBe(false);
  });
});

describe('duckDbRelationLayer', () => {
  it.each([
    ['overlaps', 'ST_Overlaps'],
    ['equals', 'ST_Equals'],
    ['crosses', 'ST_Crosses'],
    ['covers', 'ST_Covers'],
    ['coveredBy', 'ST_CoveredBy'],
    ['containsProperly', 'ST_ContainsProperly'],
  ] as const)('routes %s through filter and attribute relation modes', async (operation, fn) => {
    for (const mode of ['filter', 'attribute'] as const) {
      const input = await polygonDataset();
      const mask = await polygonDataset();
      const ctx = makeContext('src', input);
      ctx.sources.set('mask', new FakeSource(mask));
      const runtime = new FakeRuntime(toArrowTable(input, { encoding: 'wkb' }));
      const sourceId = `${operation}-${mode}`;

      const result = await duckDbRelationLayer(ctx, {
        src: 'src',
        mask: 'mask',
        mode,
        operation,
        output: { sourceId },
        runtime,
      });

      expect(result.ok).toBe(true);
      expect(ctx.outputDatasets.has(sourceId)).toBe(true);
      expect(runtime.connection.inserted).toHaveLength(2);
      expect(runtime.connection.queries.join('\n')).toContain(fn);
    }
  });

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

  it('returns DuckDB validation for an unknown relation operation', async () => {
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
      error: {
        kind: 'duckdb',
        operation: 'duckdb-relation-unknown',
        duckDbKind: 'validation',
        field: 'operation',
      },
    });
  });

  it('returns DuckDB validation when distance is requested in filter mode', async () => {
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
      error: {
        kind: 'duckdb',
        operation: 'duckdb-relation-distance',
        duckDbKind: 'validation',
        field: 'operation',
      },
    });
  });

  it('returns DuckDB validation for an unknown relation mode', async () => {
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
      error: {
        kind: 'duckdb',
        operation: 'duckdb-relation-intersects',
        duckDbKind: 'validation',
        field: 'mode',
      },
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

describe('duckDbSpatialAggregateJoinLayer', () => {
  const aggregationOptions = {
    predicate: 'contains',
    aggregations: [
      { operation: 'count', outputColumn: 'match_count' },
      { operation: 'sum', field: 'sales', outputColumn: 'sales_total' },
    ],
  } as const satisfies Omit<DuckDbSpatialAggregateJoinLayerOptions, 'src' | 'join'>;

  it('reads both datasets, forwards aggregate options, and writes the requested output', async () => {
    const target = makeSelectableLayerDataset(await polygonDataset(), 'target-selected');
    const join = makeSelectableLayerDataset(await polygonJoinDataset(), 'join-selected');
    const ctx = makeContext('target', target);
    ctx.sources.set('join', new FakeSource(join));
    const runtime = new FakeRuntime(
      tableFromArrays({ __emap_rowid: [0], match_count: [1], sales_total: [12] }),
    );

    const result: DuckDbSpatialAggregateJoinLayerResult = await duckDbSpatialAggregateJoinLayer(
      ctx,
      {
        src: 'target',
        join: 'join',
        ...aggregationOptions,
        joinType: 'inner',
        targetLayer: 'target-selected',
        joinLayer: 'join-selected',
        targetGeometryColumn: 'target geom',
        joinGeometryColumn: 'join geom',
        outputLayer: 'joined statistics',
        output: { sourceId: 'aggregate-output' },
        runtime,
      },
    );

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.get('aggregate-output')).toBe(
      result.ok ? result.value.dataset : undefined,
    );
    expect(result.ok && result.value.dataset.layers[0]!.name).toBe('joined statistics');
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.queries.join('\n')).toContain(
      'ON ST_Contains(t."target geom", j."join geom")',
    );
    expect(runtime.connection.queries.join('\n')).toContain('COUNT(*) AS "match_count"');
    expect(runtime.connection.queries.join('\n')).toContain('SUM(j."sales") AS "sales_total"');
  });

  it('returns not-found when the target source is missing', async () => {
    const ctx = new FakeContext();

    await expect(
      duckDbSpatialAggregateJoinLayer(ctx, {
        src: 'missing',
        join: 'join',
        ...aggregationOptions,
        output: { sourceId: 'out' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns not-found when the join source is missing', async () => {
    const ctx = makeContext('target', await polygonDataset());

    await expect(
      duckDbSpatialAggregateJoinLayer(ctx, {
        src: 'target',
        join: 'missing',
        ...aggregationOptions,
        output: { sourceId: 'out' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns join validation when the join source has no dataset', async () => {
    const ctx = makeContext('target', await polygonDataset());
    ctx.sources.set('join', new FakeSource(null));

    await expect(
      duckDbSpatialAggregateJoinLayer(ctx, {
        src: 'target',
        join: 'join',
        ...aggregationOptions,
        output: { sourceId: 'out' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'join',
        reason: "Source 'join' does not have a loaded dataset",
      },
    });
  });

  it('returns output validation before running the aggregate query', async () => {
    const target = await polygonDataset();
    const ctx = makeContext('target', target);
    ctx.sources.set('join', new FakeSource(await polygonDataset()));

    await expect(
      duckDbSpatialAggregateJoinLayer(ctx, {
        src: 'target',
        join: 'join',
        ...aggregationOptions,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
  });

  it('uses a collision-free aggregate row id from the dataset operation', async () => {
    const target = await polygonDataset();
    const targetRecords = target.layers[0]!.data?.getRecords();
    targetRecords![0]!.__emap_rowid = 'reserved';
    const ctx = makeContext('target', target);
    ctx.sources.set('join', new FakeSource(await polygonJoinDataset()));
    const runtime = new FakeRuntime(
      tableFromArrays({ __emap_rowid_1: [0], match_count: [1], sales_total: [2] }),
    );

    const result = await duckDbSpatialAggregateJoinLayer(ctx, {
      src: 'target',
      join: 'join',
      ...aggregationOptions,
      output: { sourceId: 'out' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(runtime.connection.queries.join('\n')).toContain('t."__emap_rowid_1"');
  });

  it('maps aggregate errors without writing an output dataset', async () => {
    const cause = new Error('aggregate query failed');
    const ctx = makeContext('target', await polygonDataset());
    ctx.sources.set('join', new FakeSource(await polygonJoinDataset()));
    const runtime = new FakeRuntime(
      tableFromArrays({ __emap_rowid: [] }),
      new DuckDbOperationError('validation', 'aggregate validation failed', {
        field: 'predicate',
        cause,
      }),
    );

    const result = await duckDbSpatialAggregateJoinLayer(ctx, {
      src: 'target',
      join: 'join',
      ...aggregationOptions,
      output: { sourceId: 'out' },
      runtime,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'duckdb',
        operation: 'duckdb-spatial-aggregate-join',
        duckDbKind: 'validation',
        field: 'predicate',
        reason: 'aggregate validation failed',
        cause,
      },
    });
    expect(ctx.outputDatasets.has('out')).toBe(false);
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

  it('forwards layer and geometry options independently from output source id', async () => {
    const input = makeSelectableLayerDataset(await polygonDataset(), 'parcels');
    const mask = makeSelectableLayerDataset(await polygonDataset(), 'clip_mask');
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(
      toArrowTable(input, {
        layer: 'parcels',
        geometryColumn: 'input_geom',
        encoding: 'wkb',
      }),
    );

    const result = await duckDbOverlayLayer(ctx, {
      src: 'src',
      mask: 'mask',
      operation: 'intersection',
      inputLayer: 'parcels',
      maskLayer: 'clip_mask',
      inputGeometryColumn: 'input_geom',
      maskGeometryColumn: 'mask_geom',
      output: { sourceId: 'overlay-source' },
      outputLayer: 'parcels_clip',
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('overlay-source')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('overlay-source');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('overlay-source'));
      expect(result.value.dataset.layers[0]?.name).toBe('parcels_clip');
    }

    const inputFields = runtime.connection.inserted[0]!.table.schema.fields.map(
      (field) => field.name,
    );
    const maskFields = runtime.connection.inserted[1]!.table.schema.fields.map(
      (field) => field.name,
    );
    expect(inputFields).toEqual(expect.arrayContaining(['name', 'input_geom']));
    expect(maskFields).toEqual(expect.arrayContaining(['name', 'mask_geom']));
    expect(runtime.connection.queries[0]).toContain('i."input_geom"');
    expect(runtime.connection.queries[0]).toContain('m."mask_geom"');
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

  it('returns DuckDB validation and does not write output for unsupported operations', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));

    const result = await duckDbOverlayLayer(ctx, {
      src: 'src',
      mask: 'mask',
      operation: 'union',
      output: { sourceId: 'overlay' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'duckdb',
        operation: 'duckdb-union-overlay',
        duckDbKind: 'validation',
        field: 'operation',
        reason: 'Unsupported DuckDB overlay operation: union',
      },
    });
    expect(ctx.outputDatasets.has('overlay')).toBe(false);
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
        kind: 'duckdb',
        operation: 'duckdb-difference-overlay',
        duckDbKind: 'query-failed',
      });
    }
    expect(ctx.outputDatasets.has('overlay')).toBe(false);
  });
});
