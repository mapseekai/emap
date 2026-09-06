import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './runtime';
import {
  DUCKDB_TOOLBOX,
  executeDuckDbTool,
  getDuckDbTool,
  listDuckDbTools,
  requireDuckDbTool,
  searchDuckDbTools,
} from './toolbox';
import {
  attributeJoin,
  densify,
  difference,
  dissolve,
  extractVertices,
  multipartToSinglepart,
  nearest,
  pointToLine,
  reproject,
  spatialFilter,
  spatialJoin,
  symmetricDifference,
  union,
} from './index';

const POLYGON_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, group: 'a' },
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

const POINT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, seq: 1 },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      properties: { id: 2, seq: 2 },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
  ],
};

class CaptureConnection implements DuckDbConnection {
  readonly queries: string[] = [];

  constructor(private readonly resultTable: Table) {}

  async insertArrowTable(): Promise<void> {}

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

async function polygonDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(POLYGON_FC, { crs: 'EPSG:3857' });
}

async function pointDataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(POINT_FC, { crs: 'EPSG:3857' });
}

function runtimeFor(dataset: MapshaperDataset): CaptureRuntime {
  return new CaptureRuntime(toArrowTable(dataset, { encoding: 'wkb' }));
}

function primarySql(runtime: CaptureRuntime): string {
  return runtime.connection.queries[0] ?? '';
}

describe('DuckDB toolbox metadata', () => {
  it('keeps ids unique and every tool self-describing for Agent/UI use', () => {
    const ids = DUCKDB_TOOLBOX.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of DUCKDB_TOOLBOX) {
      expect(tool.title.trim()).not.toBe('');
      expect(tool.description.trim()).not.toBe('');
      expect(tool.inputs.length).toBeGreaterThan(0);
      expect(
        tool.inputs.every((input) => input.name && input.description && input.geometry.length > 0),
      ).toBe(true);
      expect(['any', 'known', 'projected']).toContain(tool.crs);
      expect(['low', 'medium', 'high']).toContain(tool.cost);
      expect(tool.output.mutatesInput).toBe(false);
      expect(tool.agent.summary.trim()).not.toBe('');
      expect(tool.agent.whenToUse.length).toBeGreaterThan(0);
      expect(tool.agent.keywords.length).toBeGreaterThan(0);
      expect(tool.execute).toBeTypeOf('function');
    }
  });

  it('resolves ids and aliases and supports category listing', () => {
    expect(getDuckDbTool('intersection')?.id).toBe('intersect');
    expect(getDuckDbTool('makeValid')?.id).toBe('repairGeometry');
    expect(listDuckDbTools('overlay').map((tool) => tool.id)).toEqual([
      'clip',
      'intersect',
      'difference',
      'union',
      'symmetricDifference',
    ]);
    expect(() => requireDuckDbTool('not-a-tool')).toThrow(/Unknown DuckDB processing tool/);
  });

  it('supports lightweight semantic discovery for agents', () => {
    expect(searchDuckDbTools('count points polygon')[0]?.id).toBe('spatialSummaryJoin');
    expect(searchDuckDbTools('repair invalid geometry')[0]?.id).toBe('repairGeometry');
    expect(searchDuckDbTools('closest feature')[0]?.id).toBe('nearest');
  });

  it('describes spatial summary aggregations for agent callers', () => {
    const aggregations = getDuckDbTool('spatialSummaryJoin')?.parameters.find(
      (parameter) => parameter.name === 'aggregations',
    );
    expect(aggregations).toMatchObject({ type: 'object[]', required: true, minItems: 1 });
    expect(aggregations?.itemProperties?.map((property) => property.name)).toEqual([
      'operation',
      'field',
      'outputColumn',
    ]);
    expect(getDuckDbTool('spatialSummaryJoin')?.output.cardinality).toBe('variable');
  });
});

describe('DuckDB toolbox execution', () => {
  it('validates agent parameters before executing tools', async () => {
    const dataset = await polygonDataset();

    await expect(
      executeDuckDbTool('buffer', { inputs: { input: dataset }, params: {} }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'distance' });

    await expect(
      executeDuckDbTool('spatialJoin', {
        inputs: { input: dataset, join: dataset },
        params: { predicate: 'not-a-predicate' },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'predicate' });

    await expect(
      executeDuckDbTool('spatialSummaryJoin', {
        inputs: { input: dataset, join: dataset },
        params: { predicate: 'intersects', aggregations: [] },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'aggregations' });

    await expect(
      executeDuckDbTool('spatialSummaryJoin', {
        inputs: { input: dataset, join: dataset },
        params: {
          predicate: 'intersects',
          aggregations: [{ operation: 'count', outputColumn: 'count', typo: true }],
        },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'aggregations[0].typo' });

    await expect(
      executeDuckDbTool('buffer', {
        inputs: { input: dataset },
        params: { distance: 1, unexpected: true },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'unexpected' });
  });

  it('applies toolbox defaults before execution', async () => {
    const left = await polygonDataset();
    const right = await polygonDataset();
    const runtime = runtimeFor(left);

    await executeDuckDbTool('spatialJoin', {
      inputs: { input: left, join: right },
      params: {},
      runtime,
    });

    expect(primarySql(runtime)).toContain('LEFT JOIN');
    expect(primarySql(runtime)).toContain('ST_Intersects');
  });

  it('exposes a normalized category/tool registry without duplicate ids', () => {
    const ids = DUCKDB_TOOLBOX.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DUCKDB_TOOLBOX.some((tool) => tool.id === 'extractVertices')).toBe(true);
    expect(
      DUCKDB_TOOLBOX.filter((tool) => tool.category === 'selection').map((tool) => tool.id),
    ).toEqual(['attributeFilter', 'spatialFilter', 'spatialRelation']);
  });

  it('builds dissolve SQL with grouping', async () => {
    const dataset = await polygonDataset();
    const runtime = runtimeFor(dataset);
    await dissolve(dataset, { groupBy: ['group'] }, runtime);
    expect(primarySql(runtime)).toContain('ST_Union_Agg("geometry")');
    expect(primarySql(runtime)).toContain('GROUP BY "group"');
  });

  it('builds densify and dump-based geometry transforms', async () => {
    const dataset = await polygonDataset();

    const densifyRuntime = runtimeFor(dataset);
    const beforePoints = dataset.arcs?.getPointCount?.() ?? 0;
    const densified = await densify(dataset, { maxSegmentLength: 5 }, densifyRuntime);
    expect(densified.arcs?.getPointCount?.()).toBeGreaterThan(beforePoints);
    expect(densifyRuntime.connection.queries).toHaveLength(0);

    const multipartRuntime = runtimeFor(dataset);
    await multipartToSinglepart(dataset, {}, multipartRuntime);
    expect(primarySql(multipartRuntime)).toContain('UNNEST(ST_Dump(i."geometry"))');

    const verticesRuntime = runtimeFor(dataset);
    await extractVertices(dataset, {}, verticesRuntime);
    expect(primarySql(verticesRuntime)).toContain('ST_Dump(ST_Points(i."geometry"))');
  });

  it('builds point-to-line aggregation SQL with ordering', async () => {
    const dataset = await pointDataset();
    const runtime = runtimeFor(dataset);
    await pointToLine(dataset, { orderBy: 'seq' }, runtime);
    expect(primarySql(runtime)).toContain('ST_MakeLine(list("geometry" ORDER BY "seq"))');
  });

  it('exposes canonical difference, spatial filter, and spatial join helpers', async () => {
    const left = await polygonDataset();
    const right = await polygonDataset();

    expect(difference).toBeTypeOf('function');

    const filterRuntime = runtimeFor(left);
    await spatialFilter(left, right, { predicate: 'intersects' }, filterRuntime);
    expect(primarySql(filterRuntime)).toContain('ST_Intersects');

    const joinRuntime = runtimeFor(left);
    await spatialJoin(left, right, { predicate: 'intersects' }, joinRuntime);
    expect(primarySql(joinRuntime)).toContain('LEFT JOIN');
    expect(primarySql(joinRuntime)).toContain('ST_Intersects');
  });

  it('builds union and symmetric difference coverage SQL', async () => {
    const left = await polygonDataset();
    const right = await polygonDataset();

    const unionRuntime = runtimeFor(left);
    await union(left, right, {}, unionRuntime);
    expect(primarySql(unionRuntime)).toContain('ST_Union(a.geom, b.geom)');

    const symRuntime = runtimeFor(left);
    await symmetricDifference(left, right, {}, symRuntime);
    expect(primarySql(symRuntime)).toContain('ST_Difference(a.geom, b.geom)');
    expect(primarySql(symRuntime)).toContain('ST_Difference(b.geom, a.geom)');
  });

  it('builds attribute and nearest join SQL', async () => {
    const left = await polygonDataset();
    const right = await polygonDataset();

    const attributeRuntime = runtimeFor(left);
    await attributeJoin(left, right, { leftKey: 'id', rightKey: 'id' }, attributeRuntime);
    expect(primarySql(attributeRuntime)).toContain('LEFT JOIN');
    expect(primarySql(attributeRuntime)).toContain('l."id" = r."id"');

    const nearestRuntime = runtimeFor(left);
    await nearest(left, right, { nearestIdField: 'id' }, nearestRuntime);
    expect(primarySql(nearestRuntime)).toContain('LEFT JOIN LATERAL');
    expect(primarySql(nearestRuntime)).toContain('ORDER BY ST_Distance');
  });

  it('builds ST_Transform reproject SQL', async () => {
    const dataset = await polygonDataset();
    const runtime = runtimeFor(dataset);
    await reproject(dataset, { sourceCrs: 'EPSG:3857', targetCrs: 'EPSG:4326' }, runtime);
    expect(primarySql(runtime)).toContain(
      "ST_Transform(\"geometry\", 'EPSG:3857', 'EPSG:4326', true)",
    );
  });
});
