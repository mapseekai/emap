import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';
import { difference, intersect } from './index';
import { OVERLAY_OPERATIONS } from './_shared';

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

describe('DuckDB overlay operations', () => {
  it('defines the canonical intersect and difference descriptors', () => {
    expect(OVERLAY_OPERATIONS).toEqual({
      intersect: { id: 'intersect', duckDbFunction: 'ST_Intersection' },
      difference: { id: 'difference', duckDbFunction: 'ST_Difference' },
    });
  });

  it('runs intersection SQL and preserves the output layer name', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = await runtimeFor(input);

    const result = await intersect(input, mask, { outputLayer: 'clipped' }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
    expect(result.layers[0]?.name).toBe('clipped');
  });

  it('runs difference SQL', async () => {
    const input = await inputDataset();
    const mask = await maskDataset();
    const runtime = await runtimeFor(input);

    await difference(input, mask, {}, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Difference');
  });
});
