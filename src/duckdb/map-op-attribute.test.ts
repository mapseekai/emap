import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { duckDbAttributeLayer, type DuckDbMapOpContext, type DuckDbMapOpSource } from './map-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

const POINT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'point-a' },
      geometry: { type: 'Point', coordinates: [3, 4] },
    },
  ],
};

async function pointDataset(crs = 'EPSG:4326'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POINT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

class FakeSource implements DuckDbMapOpSource {
  constructor(private readonly dataset: MapshaperDataset | null) {}

  getDataset(): MapshaperDataset | null {
    return this.dataset;
  }
}

class FakeContext implements DuckDbMapOpContext {
  readonly sources = new Map<string, MapshaperDataset>();

  constructor(sourceId: string, dataset: MapshaperDataset) {
    this.sources.set(sourceId, dataset);
  }

  getSource(id: string): DuckDbMapOpSource | null {
    return new FakeSource(this.sources.get(id) ?? null);
  }

  setSourceDataset(id: string, dataset: MapshaperDataset): void {
    this.sources.set(id, dataset);
  }
}

class FakeConnection implements DuckDbConnection {
  readonly queries: string[] = [];

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(): Promise<void> {}

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {}
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;

  constructor(resultTable: Table) {
    this.connection = new FakeConnection(resultTable);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {}
}

describe('duckDbAttributeLayer', () => {
  it('runs attribute operations and writes output datasets', async () => {
    const dataset = await pointDataset();
    const resultTable = toArrowTable(dataset, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);
    const ctx = new FakeContext('src', dataset);

    const result = await duckDbAttributeLayer(ctx, {
      src: 'src',
      output: { sourceId: 'out' },
      operation: 'centroidX',
      outputColumn: 'centroid_x',
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.sources.get('out')).toBeTruthy();
    expect(runtime.connection.queries[0]).toContain('ST_X(ST_Centroid("geometry")) AS "centroid_x"');
  });

  it('returns validation for unknown attribute operations', async () => {
    const dataset = await pointDataset();
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));
    const ctx = new FakeContext('src', dataset);

    const result = await duckDbAttributeLayer(ctx, {
      src: 'src',
      output: { sourceId: 'out' },
      operation: 'nope',
      runtime,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'operation',
        reason: "Unknown DuckDB attribute operation 'nope'",
      },
    });
  });
});
