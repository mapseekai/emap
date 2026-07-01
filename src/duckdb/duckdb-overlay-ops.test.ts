import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import {
  differenceDatasetWithDuckDb,
  getDuckDbOverlayOperationSpec,
  intersectionDatasetWithDuckDb,
} from './duckdb-overlay-ops';

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

async function inputDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(INPUT_FC);
}

async function maskDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(MASK_FC);
}

class CaptureConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {}
}

class CaptureRuntime implements DuckDbRuntime {
  readonly connection: CaptureConnection;

  constructor(resultTable: Table) {
    this.connection = new CaptureConnection(resultTable);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {}
}

async function runtimeFor(dataset: MapshaperDataset): Promise<CaptureRuntime> {
  return new CaptureRuntime(toArrowTable(dataset, { encoding: 'wkb' }));
}

describe('DuckDB named overlay dataset helpers', () => {
  it('returns the intersection operation spec', () => {
    expect(getDuckDbOverlayOperationSpec('intersection')).toEqual({
      id: 'intersection',
      duckDbFunction: 'ST_Intersection',
    });
  });

  it('returns the difference operation spec', () => {
    expect(getDuckDbOverlayOperationSpec('difference')).toEqual({
      id: 'difference',
      duckDbFunction: 'ST_Difference',
    });
  });

  it.each([
    'union',
    'toString',
    'constructor',
    '__proto__',
  ])('rejects unsupported overlay operation %s', (operation) => {
    let caught: unknown;
    try {
      getDuckDbOverlayOperationSpec(operation);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DuckDbOperationError);
    expect(caught).toMatchObject({
      kind: 'validation',
      message: `Unsupported DuckDB overlay operation: ${operation}`,
    });
  });

  it('runs intersection SQL and preserves the output layer name', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = await runtimeFor(input);

    const result = await intersectionDatasetWithDuckDb(
      input,
      mask,
      { outputLayer: 'clipped' },
      runtime,
    );

    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
    expect(result.layers[0]?.name).toBe('clipped');
  });

  it('runs difference SQL', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = await runtimeFor(input);

    await differenceDatasetWithDuckDb(input, mask, {}, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Difference');
  });
});
