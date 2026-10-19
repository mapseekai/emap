import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';
import { repairGeometry } from './repair-geometry';

const POLYGON_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
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

class CaptureConnection implements DuckDbConnection {
  readonly queries: string[] = [];

  constructor(private readonly result: Table) {}

  async insertArrowTable(): Promise<void> {}

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    return this.result;
  }

  async close(): Promise<void> {}
}

class CaptureRuntime implements DuckDbRuntime {
  readonly connection: CaptureConnection;

  constructor(result: Table) {
    this.connection = new CaptureConnection(result);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {}
}

describe('repairGeometry', () => {
  it('runs ST_MakeValid through the shared geometry runner', async () => {
    const dataset = await datasetFromGeoJSON(POLYGON_FC);
    const runtime = new CaptureRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    const result = await repairGeometry(dataset, { outputLayer: 'repaired' }, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_MakeValid("geometry")');
    expect(result.layers[0]?.name).toBe('repaired');
    expect(result.info?.crs_string).toBe('EPSG:4326');
  });
});
