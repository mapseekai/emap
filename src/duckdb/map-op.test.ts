import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import {
  duckDbBufferLayer,
  duckDbGeometryLayer,
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
  constructor(private readonly dataset: MapshaperDataset | null | undefined) {}

  getDataset(): MapshaperDataset | null | undefined {
    return this.dataset;
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
}

function makeContext(sourceId: string, dataset: MapshaperDataset | null | undefined): FakeContext {
  const ctx = new FakeContext();
  ctx.sources.set(sourceId, new FakeSource(dataset));
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
