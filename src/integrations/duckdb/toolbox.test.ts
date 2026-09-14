import { tableToIPC, type Table } from 'apache-arrow';
import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm/blocking';
import { toArrowTable } from '../arrow/dataset-to-table';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './runtime';
import { duckDbToolbox } from './toolbox';
import {
  attributeJoin,
  collect,
  densify,
  difference,
  dissolve,
  extractVertices,
  lineToPolygon,
  merge,
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
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  return dataset;
}

async function pointDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POINT_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  return dataset;
}

function runtimeFor(dataset: MapshaperDataset): CaptureRuntime {
  return new CaptureRuntime(toArrowTable(dataset, { encoding: 'wkb' }));
}

function primarySql(runtime: CaptureRuntime): string {
  return runtime.connection.queries[0] ?? '';
}

describe('DuckDB toolbox metadata', () => {
  it('keeps ids unique and every tool self-describing for Agent/UI use', () => {
    const ids = duckDbToolbox.tools.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of duckDbToolbox.tools) {
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
    expect(duckDbToolbox.get('intersection')?.id).toBe('intersect');
    expect(duckDbToolbox.get('makeValid')?.id).toBe('repairGeometry');
    expect(duckDbToolbox.list('overlay').map((tool) => tool.id)).toEqual([
      'clip',
      'intersect',
      'difference',
      'union',
      'symmetricDifference',
    ]);
    expect(() => duckDbToolbox.require('not-a-tool')).toThrow(/Unknown DuckDB processing tool/);
  });

  it('supports lightweight semantic discovery for agents', () => {
    expect(duckDbToolbox.search('count points polygon')[0]?.id).toBe('spatialSummaryJoin');
    expect(duckDbToolbox.search('repair invalid geometry')[0]?.id).toBe('repairGeometry');
    expect(duckDbToolbox.search('closest feature')[0]?.id).toBe('nearest');
  });

  it('describes spatial summary aggregations for agent callers', () => {
    const aggregations = duckDbToolbox
      .get('spatialSummaryJoin')
      ?.parameters.find((parameter) => parameter.name === 'aggregations');
    expect(aggregations).toMatchObject({ type: 'object[]', required: true, minItems: 1 });
    expect(aggregations?.itemProperties?.map((property) => property.name)).toEqual([
      'operation',
      'field',
      'outputColumn',
    ]);
    expect(duckDbToolbox.get('spatialSummaryJoin')?.output.cardinality).toBe('variable');
  });
});

describe('DuckDB toolbox execution', () => {
  it('validates agent parameters before executing tools', async () => {
    const dataset = await polygonDataset();

    await expect(
      duckDbToolbox.execute('buffer', { inputs: { input: dataset }, params: {} }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'distance' });

    await expect(
      duckDbToolbox.execute('spatialJoin', {
        inputs: { input: dataset, join: dataset },
        params: { predicate: 'not-a-predicate' },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'predicate' });

    await expect(
      duckDbToolbox.execute('spatialSummaryJoin', {
        inputs: { input: dataset, join: dataset },
        params: { predicate: 'intersects', aggregations: [] },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'aggregations' });

    await expect(
      duckDbToolbox.execute('spatialSummaryJoin', {
        inputs: { input: dataset, join: dataset },
        params: {
          predicate: 'intersects',
          aggregations: [{ operation: 'count', outputColumn: 'count', typo: true }],
        },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'aggregations[0].typo' });

    await expect(
      duckDbToolbox.execute('buffer', {
        inputs: { input: dataset },
        params: { distance: 1, unexpected: true },
      }),
    ).rejects.toMatchObject({ kind: 'validation', field: 'unexpected' });
  });

  it('applies toolbox defaults before execution', async () => {
    const left = await polygonDataset();
    const right = await polygonDataset();
    const runtime = runtimeFor(left);

    await duckDbToolbox.execute('spatialJoin', {
      inputs: { input: left, join: right },
      params: {},
      runtime,
    });

    expect(primarySql(runtime)).toContain('LEFT JOIN');
    expect(primarySql(runtime)).toContain('ST_Intersects');
  });

  it('exposes a normalized category/tool registry without duplicate ids', () => {
    const ids = duckDbToolbox.tools.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(duckDbToolbox.tools.some((tool) => tool.id === 'extractVertices')).toBe(true);
    expect(
      duckDbToolbox.tools.filter((tool) => tool.category === 'selection').map((tool) => tool.id),
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

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const require = createRequire(import.meta.url);
let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const duckdb = await import('@duckdb/duckdb-wasm/blocking');
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: '',
    },
    eh: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker: '',
    },
  } satisfies DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | null = null;

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as unknown as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable(table, opts) {
        conn.insertArrowFromIPCStream(tableToIPC(table, 'stream'), { ...opts, create: true });
      },
      async query(sql) {
        return conn.query(sql);
      },
      async close() {
        conn.close();
      },
    };
  }

  return {
    async connect() {
      return wrapConnection();
    },
    ensureSpatial() {
      const ready =
        spatialReady ??
        (async () => {
          const conn = wrapConnection();
          try {
            await conn.query('INSTALL spatial; LOAD spatial;');
          } finally {
            await conn.close?.();
          }
        })();
      spatialReady = ready;
      ready.catch(() => {
        if (spatialReady === ready) spatialReady = null;
      });
      return ready;
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

async function getRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

afterAll(async () => {
  await runtime?.close?.();
});

async function dataset(fc: unknown, crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const result = await datasetFromGeoJSON(fc);
  result.info = { ...result.info, crs_string: crs };
  return result;
}

const POLYGONS = {
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
    {
      type: 'Feature',
      properties: { id: 2, group: 'a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [10, 0],
            [20, 0],
            [20, 10],
            [10, 10],
            [10, 0],
          ],
        ],
      },
    },
  ],
};

const MASK = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 10 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [5, -5],
            [15, -5],
            [15, 15],
            [5, 15],
            [5, -5],
          ],
        ],
      },
    },
  ],
};

const POINTS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, route: 'r', seq: 1 },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { id: 2, route: 'r', seq: 2 },
      geometry: { type: 'Point', coordinates: [9, 9] },
    },
    {
      type: 'Feature',
      properties: { id: 3, route: 'r', seq: 3 },
      geometry: { type: 'Point', coordinates: [19, 9] },
    },
  ],
};

const LINES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      },
    },
  ],
};

const MULTIPOLYGON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
              [0, 0],
            ],
          ],
          [
            [
              [6, 0],
              [10, 0],
              [10, 4],
              [6, 4],
              [6, 0],
            ],
          ],
        ],
      },
    },
  ],
};

describeDuckDbIntegration('DuckDB toolbox integration', () => {
  it('runs dissolve, collect, densify, multipart, and vertex extraction', async () => {
    const rt = await getRuntime();
    const polygons = await dataset(POLYGONS);

    const dissolved = await dissolve(polygons, { groupBy: ['group'] }, rt);
    expect(dissolved.layers[0]?.shapes?.length).toBe(1);

    const collected = await collect(polygons, { groupBy: ['group'] }, rt);
    expect(collected.layers[0]?.shapes?.length).toBe(1);

    const densified = await densify(polygons, { maxSegmentLength: 2 }, rt);
    expect(densified.layers[0]?.shapes?.length).toBe(2);

    const multipart = await dataset(MULTIPOLYGON);
    const singles = await multipartToSinglepart(multipart, {}, rt);
    expect(singles.layers[0]?.shapes?.length).toBe(2);

    const vertices = await extractVertices(polygons, {}, rt);
    expect(vertices.layers[0]?.shapes?.length).toBeGreaterThan(4);
  }, 30_000);

  it('runs point-to-line and line-to-polygon transforms', async () => {
    const rt = await getRuntime();
    const points = await dataset(POINTS);
    const lines = await pointToLine(points, { groupBy: ['route'], orderBy: 'seq' }, rt);
    expect(lines.layers[0]?.shapes?.length).toBe(1);

    const closedLines = await dataset(LINES);
    const polygons = await lineToPolygon(closedLines, {}, rt);
    expect(polygons.layers[0]?.shapes?.length).toBe(1);
  });

  it('runs overlay coverage union and symmetric difference', async () => {
    const rt = await getRuntime();
    const left = await dataset(POLYGONS);
    const right = await dataset(MASK);

    const unionResult = await union(left, right, {}, rt);
    expect(unionResult.layers[0]?.shapes?.length).toBe(1);

    const sym = await symmetricDifference(left, right, {}, rt);
    expect(sym.layers[0]?.shapes?.length).toBe(1);
  });

  it('runs attribute join, spatial join, spatial filter, and nearest', async () => {
    const rt = await getRuntime();
    const polygons = await dataset(POLYGONS);
    const points = await dataset(POINTS);

    const joinedById = await attributeJoin(
      polygons,
      points,
      { leftKey: 'id', rightKey: 'id', joinType: 'left' },
      rt,
    );
    expect(joinedById.layers[0]?.shapes?.length).toBe(2);

    const spatialJoined = await spatialJoin(
      polygons,
      points,
      { predicate: 'contains', joinType: 'left' },
      rt,
    );
    expect(spatialJoined.layers[0]?.shapes?.length).toBeGreaterThanOrEqual(2);

    const filtered = await spatialFilter(polygons, points, { predicate: 'contains' }, rt);
    expect(filtered.layers[0]?.shapes?.length).toBe(2);

    const nearestResult = await nearest(polygons, points, { nearestIdField: 'id' }, rt);
    const records = nearestResult.layers[0]?.data?.getRecords?.() ?? [];
    expect(records).toHaveLength(2);
    expect(records[0]?.nearest_id).toBeDefined();
    expect(records[0]?.nearest_distance).toBeDefined();
  });

  it.each([
    'mixed',
    'all-null',
    'empty',
  ] as const)('reproject preserves %s geometry rows and attributes', async (mode) => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const layer = input.layers[0]!;
    if (mode === 'mixed') layer.shapes![1] = null;
    if (mode === 'all-null') layer.shapes = layer.shapes!.map(() => null);
    if (mode === 'empty') {
      layer.shapes = [];
      layer.data!.getRecords().splice(0);
    }
    const before = structuredClone(layer.data!.getRecords());
    const result = await reproject(input, { targetCrs: 'EPSG:4326' }, rt);
    expect(result.layers[0]?.data?.getRecords() ?? []).toEqual(before);
    expect(result.layers[0]?.shapes ?? []).toHaveLength(layer.shapes!.length);
    expect(result.info?.crs_string).toBe('EPSG:4326');
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(input.info?.crs_string).toBe('EPSG:3857');
    if (mode === 'mixed') expect(result.layers[0]?.shapes?.[1]).toBeNull();
    if (mode === 'all-null') expect(result.layers[0]?.shapes).toEqual([null, null, null]);
  });

  it.each([
    'direct',
    'toolbox',
  ] as const)('nearest rejects geographic and unknown CRS through the %s entry point', async (entry) => {
    const rt = await getRuntime();
    for (const crs of ['EPSG:4326', 'EPSG:4490', undefined]) {
      const input = await dataset(POINTS);
      const reference = await dataset(POINTS);
      input.info = crs ? { crs_string: crs } : {};
      const run = () =>
        entry === 'direct'
          ? nearest(input, reference, {}, rt)
          : duckDbToolbox.execute('nearest', { inputs: { input, reference }, runtime: rt });
      await expect(Promise.resolve().then(run)).rejects.toMatchObject({
        kind: 'validation',
        field: 'crs',
      });
    }
  });

  it('nearest isolates generated IDs from user fields and breaks distance ties by row order', async () => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    reference.layers[0]!.data!.getRecords().forEach((record, index) => {
      record.__nearest_rowid = 777 + index;
      record.__NEAREST_ROWID_1 = 888 + index;
    });
    const result = await nearest(input, reference, {}, rt);
    expect(result.layers[0]?.data?.getRecords().map((record) => record.nearest_id)).toEqual([
      0, 1, 2,
    ]);
    expect(result.layers[0]?.data?.getRecords().map((record) => record.nearest_distance)).toEqual([
      0, 0, 0,
    ]);
    reference.layers[0]!.shapes![1] = reference.layers[0]!.shapes![0];
    const tied = await nearest(input, reference, {}, rt);
    expect(tied.layers[0]?.data?.getRecords()[0]?.nearest_id).toBe(0);
  });

  it('nearest rejects colliding output columns instead of overwriting input attributes', async () => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    input.layers[0]!.data!.getRecords()[0]!.NEAREST_ID = 123;
    await expect(
      Promise.resolve().then(() => nearest(input, reference, {}, rt)),
    ).rejects.toMatchObject({
      kind: 'validation',
      field: 'outputNearestIdColumn',
    });
    await expect(
      Promise.resolve().then(() =>
        nearest(
          input,
          reference,
          {
            outputNearestIdColumn: 'distance',
            outputDistanceColumn: 'DISTANCE',
          },
          rt,
        ),
      ),
    ).rejects.toMatchObject({ kind: 'validation', field: 'outputDistanceColumn' });
  });

  it('nearest leaves null geometry unmatched rather than assigning an arbitrary feature', async () => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    input.layers[0]!.shapes![1] = null;
    const result = await nearest(input, reference, {}, rt);
    expect(result.layers[0]?.data?.getRecords()[1]).toMatchObject({
      id: 2,
      nearest_id: null,
      nearest_distance: null,
    });
  });

  it.each([
    'all-null-input',
    'empty-reference',
    'null-reference',
  ] as const)('nearest handles %s without losing records or geometry type', async (mode) => {
    const rt = await getRuntime();
    const input = await dataset(POINTS);
    const reference = await dataset(POINTS);
    if (mode === 'all-null-input') input.layers[0]!.shapes = [null, null, null];
    if (mode === 'null-reference') reference.layers[0]!.shapes = [null, null, null];
    if (mode === 'empty-reference') {
      reference.layers[0]!.shapes = [];
      reference.layers[0]!.data!.getRecords().splice(0);
    }
    const result = await nearest(input, reference, {}, rt);
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(result.layers[0]?.shapes).toHaveLength(3);
    expect(
      result.layers[0]?.data
        ?.getRecords()
        .map((record) => [record.id, record.nearest_id, record.nearest_distance]),
    ).toEqual([
      [1, null, null],
      [2, null, null],
      [3, null, null],
    ]);
  });

  it('runs merge and reproject', async () => {
    const rt = await getRuntime();
    const left = await dataset(POLYGONS);
    const right = await dataset(MASK);

    const merged = await merge(left, right, {}, rt);
    expect(merged.layers[0]?.shapes?.length).toBe(3);

    const projected = await reproject(left, { sourceCrs: 'EPSG:3857', targetCrs: 'EPSG:4326' }, rt);
    expect(projected.layers[0]?.shapes?.length).toBe(2);
  });
});
