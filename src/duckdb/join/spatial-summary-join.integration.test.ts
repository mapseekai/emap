import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type * as DuckDBBundles from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { recordsFromArrowTable } from '../../arrow/table-to-dataset';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';
import { spatialSummaryJoin, type SpatialSummaryJoinPredicate } from './spatial-summary-join';
import { buildSpatialAggregateJoinSql } from './_spatial-summary-sql';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const require = createRequire(import.meta.url);
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
  } satisfies DuckDBBundles.DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let spatialReady: Promise<void> | null = null;

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable(table, opts) {
        conn.insertArrowFromIPCStream(tableToIPC(table), { name: opts.name, create: true });
      },
      async query(sql) {
        return conn.query(sql);
      },
      async close() {
        conn.close();
      },
    };
  }

  function createSpatialReadyPromise(): Promise<void> {
    const ready = (async () => {
      const conn = wrapConnection();
      try {
        await conn.query('INSTALL spatial; LOAD spatial;');
      } finally {
        await conn.close?.();
      }
    })();
    ready.catch(() => {
      if (spatialReady === ready) spatialReady = null;
    });
    return ready;
  }

  return {
    async connect(): Promise<DuckDbConnection> {
      return wrapConnection();
    },
    async ensureSpatial(): Promise<void> {
      spatialReady ??= createSpatialReadyPromise();
      return spatialReady;
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

afterAll(async () => {
  await runtime?.close?.();
  runtime = undefined;
});

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

function square(id: string, minX: number, minY: number, maxX: number, maxY: number) {
  return {
    type: 'Feature',
    properties: { id },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
  };
}

function line(id: string, coordinates: number[][]) {
  return {
    type: 'Feature',
    properties: { id },
    geometry: { type: 'LineString', coordinates },
  };
}

function point(id: string, coordinates: number[]) {
  return {
    type: 'Feature',
    properties: { id },
    geometry: { type: 'Point', coordinates },
  };
}

async function fixtureDataset(features: unknown[]): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON({ type: 'FeatureCollection', features });
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  return dataset;
}

function records(dataset: MapshaperDataset): Array<Record<string, unknown>> {
  return dataset.layers[0]?.data?.getRecords?.() ?? [];
}

function emptyDataset(geometryType: MapshaperLayer['geometry_type']): MapshaperDataset {
  return {
    layers: [
      {
        geometry_type: geometryType,
        shapes: [],
        data: getDefaultMapshaperAdapter().createDataTable([]),
      },
    ],
    info: { crs_string: 'EPSG:3857' },
  };
}

function nullPointDataset(rows: Array<Record<string, unknown>>): MapshaperDataset {
  return {
    layers: [
      {
        geometry_type: 'point',
        shapes: rows.map(() => null),
        data: getDefaultMapshaperAdapter().createDataTable(rows),
      },
    ],
    info: { crs_string: 'EPSG:3857' },
  };
}

function datasetWithTargetRowIds(dataset: MapshaperDataset): MapshaperDataset {
  const layer = dataset.layers[0]!;
  return {
    ...dataset,
    layers: [
      {
        ...layer,
        data: getDefaultMapshaperAdapter().createDataTable(
          records(dataset).map((record, index) => ({ ...record, __emap_rowid: index })),
        ),
      },
    ],
  };
}

const PREDICATE_CASES: ReadonlyArray<{
  predicate: SpatialSummaryJoinPredicate;
  target: readonly ReturnType<typeof square | typeof line | typeof point>[];
  join: ReturnType<typeof square | typeof line | typeof point>;
}> = [
  {
    predicate: 'intersects',
    target: [square('positive', 0, 0, 10, 10), square('negative', 20, 20, 30, 30)],
    join: square('join', 5, 5, 15, 15),
  },
  {
    predicate: 'contains',
    target: [square('positive', 0, 0, 10, 10), square('negative', 20, 20, 30, 30)],
    join: point('join', [5, 5]),
  },
  {
    predicate: 'within',
    target: [point('positive', [5, 5]), point('negative', [20, 20])],
    join: square('join', 0, 0, 10, 10),
  },
  {
    predicate: 'touches',
    target: [square('positive', 0, 0, 10, 10), square('negative', 15, 0, 25, 10)],
    join: square('join', 10, 0, 20, 10),
  },
  {
    predicate: 'overlaps',
    target: [square('positive', 0, 0, 10, 10), square('negative', 0, 0, 20, 20)],
    join: square('join', 5, 5, 15, 15),
  },
  {
    predicate: 'equals',
    target: [square('positive', 0, 0, 10, 10), square('negative', 5, 5, 15, 15)],
    join: square('join', 0, 0, 10, 10),
  },
  {
    predicate: 'crosses',
    target: [
      line('positive', [
        [0, 5],
        [10, 5],
      ]),
      line('negative', [
        [0, 0],
        [5, 0],
      ]),
    ],
    join: line('join', [
      [5, 0],
      [5, 10],
    ]),
  },
  {
    predicate: 'covers',
    target: [square('positive', 0, 0, 10, 10), square('negative', 20, 20, 30, 30)],
    join: point('join', [0, 5]),
  },
  {
    predicate: 'coveredBy',
    target: [point('positive', [0, 5]), point('negative', [20, 20])],
    join: square('join', 0, 0, 10, 10),
  },
  {
    predicate: 'containsProperly',
    target: [square('positive', 0, 0, 10, 10), square('negative', 1, 0, 9, 10)],
    join: line('join', [
      [1, 5],
      [9, 5],
    ]),
  },
];

describeDuckDbIntegration('DuckDB-Wasm spatial summary join integration', () => {
  it.each(PREDICATE_CASES)('counts only the discriminating $predicate match', async ({
    predicate,
    target: targetFeatures,
    join: joinFeature,
  }) => {
    const duckDbRuntime = await getIntegrationRuntime();
    const result = await spatialSummaryJoin(
      await fixtureDataset([...targetFeatures]),
      await fixtureDataset([joinFeature]),
      {
        predicate,
        joinType: 'left',
        aggregations: [{ operation: 'count', outputColumn: 'match_count' }],
      },
      duckDbRuntime,
    );

    expect(records(result).map((record) => record.match_count)).toEqual([1, 0]);
  }, 60_000);

  it('aggregates matches while preserving target order, geometry, attributes, and CRS', async () => {
    const target = await fixtureDataset([
      square('A', 0, 0, 10, 10),
      square('B', 20, 0, 30, 10),
      square('C', 40, 0, 50, 10),
      { type: 'Feature', properties: { id: 'D' }, geometry: null },
    ]);
    const join = await fixtureDataset([
      {
        type: 'Feature',
        properties: { sales: 10, score: 2 },
        geometry: point('one', [1, 1]).geometry,
      },
      {
        type: 'Feature',
        properties: { sales: 20, score: 4 },
        geometry: point('two', [2, 2]).geometry,
      },
      {
        type: 'Feature',
        properties: { sales: null, score: null },
        geometry: point('three', [45, 5]).geometry,
      },
      { type: 'Feature', properties: { sales: 70, score: 7 }, geometry: null },
      {
        type: 'Feature',
        properties: { sales: 90, score: 9 },
        geometry: point('outside', [80, 5]).geometry,
      },
    ]);
    const duckDbRuntime = await getIntegrationRuntime();
    const aggregations = [
      { operation: 'count' as const, outputColumn: 'match_count' },
      { operation: 'sum' as const, field: 'sales', outputColumn: 'sales_total' },
      { operation: 'avg' as const, field: 'score', outputColumn: 'score_avg' },
      { operation: 'min' as const, field: 'sales', outputColumn: 'sales_min' },
      { operation: 'max' as const, field: 'sales', outputColumn: 'sales_max' },
    ];

    const left = await spatialSummaryJoin(
      target,
      join,
      { predicate: 'contains', joinType: 'left', aggregations },
      duckDbRuntime,
    );

    expect(records(left)).toEqual([
      { id: 'A', match_count: 2, sales_total: 30, score_avg: 3, sales_min: 10, sales_max: 20 },
      {
        id: 'B',
        match_count: 0,
        sales_total: null,
        score_avg: null,
        sales_min: null,
        sales_max: null,
      },
      {
        id: 'C',
        match_count: 1,
        sales_total: null,
        score_avg: null,
        sales_min: null,
        sales_max: null,
      },
      {
        id: 'D',
        match_count: 0,
        sales_total: null,
        score_avg: null,
        sales_min: null,
        sales_max: null,
      },
    ]);
    expect(left.layers[0]?.shapes).toEqual(target.layers[0]?.shapes);
    expect(left.layers[0]?.shapes).not.toBe(target.layers[0]?.shapes);
    expect(left.arcs).toBe(target.arcs);
    expect(left.info?.crs_string).toBe('EPSG:3857');
    expect(records(target)).toEqual([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]);

    const inner = await spatialSummaryJoin(
      target,
      join,
      { predicate: 'contains', joinType: 'inner', aggregations },
      duckDbRuntime,
    );
    expect(records(inner).map((record) => record.id)).toEqual(['A', 'C']);
  }, 120_000);

  it('defaults typed null-geometry joins and supports empty target and join datasets', async () => {
    const target = await fixtureDataset([square('A', 0, 0, 10, 10), square('B', 20, 0, 30, 10)]);
    const nullGeometryJoin = nullPointDataset([
      { sales: 10, score: 2 },
      { sales: 20, score: 4 },
    ]);
    const duckDbRuntime = await getIntegrationRuntime();
    const aggregates = [
      { operation: 'count' as const, outputColumn: 'match_count' },
      { operation: 'sum' as const, field: 'sales', outputColumn: 'sales_total' },
      { operation: 'avg' as const, field: 'score', outputColumn: 'score_avg' },
    ];

    const nullLeft = await spatialSummaryJoin(
      target,
      nullGeometryJoin,
      { predicate: 'contains', joinType: 'left', aggregations: aggregates },
      duckDbRuntime,
    );
    expect(
      records(nullLeft).map((record) => [record.match_count, record.sales_total, record.score_avg]),
    ).toEqual([
      [0, null, null],
      [0, null, null],
    ]);
    const nullInner = await spatialSummaryJoin(
      target,
      nullGeometryJoin,
      { predicate: 'contains', joinType: 'inner', aggregations: aggregates },
      duckDbRuntime,
    );
    expect(records(nullInner)).toEqual([]);

    const emptyTarget = emptyDataset('polygon');
    const emptyJoin = emptyDataset('point');
    const count = [{ operation: 'count' as const, outputColumn: 'match_count' }];
    const nonEmptyJoin = await fixtureDataset([point('join', [1, 1])]);
    const emptyTargetResult = await spatialSummaryJoin(
      emptyTarget,
      nonEmptyJoin,
      { predicate: 'contains', aggregations: count },
      duckDbRuntime,
    );
    expect(records(emptyTargetResult)).toEqual([]);
    const emptyJoinLeft = await spatialSummaryJoin(
      target,
      emptyJoin,
      { predicate: 'contains', joinType: 'left', aggregations: count },
      duckDbRuntime,
    );
    expect(records(emptyJoinLeft).map((record) => record.match_count)).toEqual([0, 0]);
    const emptyJoinInner = await spatialSummaryJoin(
      target,
      emptyJoin,
      { predicate: 'contains', joinType: 'inner', aggregations: count },
      duckDbRuntime,
    );
    expect(records(emptyJoinInner)).toEqual([]);
  }, 120_000);

  it('uses DuckDB SPATIAL_JOIN for the generated aggregate join plan', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const target = datasetWithTargetRowIds(await fixtureDataset([square('A', 0, 0, 10, 10)]));
    const join = await fixtureDataset([point('join', [5, 5])]);
    const targetTable = toArrowTable(target, { encoding: 'wkb', geometryColumn: 'geometry' });
    const joinTable = toArrowTable(join, { encoding: 'wkb', geometryColumn: 'geometry' });
    const targetTableName = 'emap_duckdb_spatial_aggregate_explain_target';
    const joinTableName = 'emap_duckdb_spatial_aggregate_explain_join';

    await duckDbRuntime.ensureSpatial();
    const conn = await duckDbRuntime.connect();
    try {
      await conn.insertArrowTable(targetTable, { name: targetTableName });
      await conn.insertArrowTable(joinTable, { name: joinTableName });
      const sql = buildSpatialAggregateJoinSql({
        targetTableName,
        joinTableName,
        targetGeometryColumn: 'geometry',
        joinGeometryColumn: 'geometry',
        targetRowIdColumn: '__emap_rowid',
        duckDbFunction: 'ST_Contains',
        aggregations: [{ operation: 'count', outputColumn: 'match_count' }],
      });
      const explain = await conn.query('EXPLAIN ' + sql);
      const plan = recordsFromArrowTable(explain)
        .flatMap((record) => Object.values(record))
        .join(' ');
      expect(plan).toMatch(/SPATIAL_JOIN/i);
    } finally {
      await conn.query(`DROP TABLE IF EXISTS "${targetTableName}"`);
      await conn.query(`DROP TABLE IF EXISTS "${joinTableName}"`);
      await conn.close();
    }
  }, 60_000);
});
