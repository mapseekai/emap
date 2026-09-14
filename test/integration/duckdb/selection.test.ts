import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MapshaperDataset } from '../../../src/shared/types/mapshaper-types';
import {
  runRelationTool,
  type RelationOperation,
} from '../../../src/integrations/duckdb/core/runners/relation';
import { DuckDbOperationError } from '../../../src/integrations/duckdb/errors';
import type { DuckDbRuntime } from '../../../src/integrations/duckdb/runtime';
import {
  getRelationOperation,
  runNamedRelationOperation,
} from '../../../src/integrations/duckdb/core/relation/operations';
import {
  buildRelationAttributeSql,
  buildRelationFilterSql,
} from '../../../src/integrations/duckdb/core/sql/relation';

vi.mock('../../../src/integrations/duckdb/core/runners/relation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/integrations/duckdb/core/runners/relation')>();
  return {
    ...actual,
    runRelationTool: vi.fn(async (inputDataset) => inputDataset),
  };
});

const runRelationToolMock = vi.mocked(runRelationTool);
const runtime = { runtime: 'duckdb' } as unknown as DuckDbRuntime;

function dataset(crs = 'EPSG:3857'): MapshaperDataset {
  return {
    layers: [
      {
        name: 'layer',
        shapes: [],
      },
    ],
    info: {
      crs_string: crs,
      crs: { is_latlong: crs === 'EPSG:4326' },
    },
  } as unknown as MapshaperDataset;
}

function lastRelationOperation(): RelationOperation {
  return runRelationToolMock.mock.calls.at(-1)?.[3] as RelationOperation;
}

function relationSql(operation: RelationOperation): string {
  const baseSqlOptions = {
    inputTableName: 'input_table',
    maskTableName: 'mask_table',
    inputGeometryColumn: 'geometry',
    maskGeometryColumn: 'geometry',
  };

  if (operation.mode === 'filter') {
    return 'distance' in operation
      ? buildRelationFilterSql({
          ...baseSqlOptions,
          duckDbFunction: 'ST_Distance',
          distance: operation.distance,
        })
      : buildRelationFilterSql({
          ...baseSqlOptions,
          duckDbFunction: operation.duckDbFunction,
        });
  }

  if (operation.output === 'distance') {
    return buildRelationAttributeSql({
      ...baseSqlOptions,
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: operation.outputColumn!,
    });
  }

  return 'distance' in operation
    ? buildRelationAttributeSql({
        ...baseSqlOptions,
        duckDbFunction: 'ST_Distance',
        distance: operation.distance,
        outputColumn: operation.outputColumn!,
      })
    : buildRelationAttributeSql({
        ...baseSqlOptions,
        duckDbFunction: operation.duckDbFunction,
        outputColumn: operation.outputColumn!,
      });
}

async function expectValidationError(action: () => Promise<unknown>, field: string): Promise<void> {
  try {
    await Promise.resolve(action());
    throw new Error('Expected DuckDbOperationError');
  } catch (err) {
    expect(err).toBeInstanceOf(DuckDbOperationError);
    expect((err as DuckDbOperationError).kind).toBe('validation');
    expect((err as DuckDbOperationError).field).toBe(field);
  }
}

describe('DuckDB relation operations', () => {
  const TOPOLOGICAL_RELATION_CASES = [
    ['intersects', 'ST_Intersects', 'duckdb_intersects'],
    ['contains', 'ST_Contains', 'duckdb_contains'],
    ['within', 'ST_Within', 'duckdb_within'],
    ['touches', 'ST_Touches', 'duckdb_touches'],
    ['disjoint', 'ST_Disjoint', 'duckdb_disjoint'],
    ['overlaps', 'ST_Overlaps', 'duckdb_overlaps'],
    ['equals', 'ST_Equals', 'duckdb_equals'],
    ['crosses', 'ST_Crosses', 'duckdb_crosses'],
    ['covers', 'ST_Covers', 'duckdb_covers'],
    ['coveredBy', 'ST_CoveredBy', 'duckdb_covered_by'],
    ['containsProperly', 'ST_ContainsProperly', 'duckdb_contains_properly'],
  ] as const;

  const ADDITIONAL_RELATION_CASES = [
    { id: 'overlaps', duckDbFunction: 'ST_Overlaps', outputColumn: 'duckdb_overlaps' },
    { id: 'equals', duckDbFunction: 'ST_Equals', outputColumn: 'duckdb_equals' },
    { id: 'crosses', duckDbFunction: 'ST_Crosses', outputColumn: 'duckdb_crosses' },
    { id: 'covers', duckDbFunction: 'ST_Covers', outputColumn: 'duckdb_covers' },
    { id: 'coveredBy', duckDbFunction: 'ST_CoveredBy', outputColumn: 'duckdb_covered_by' },
    {
      id: 'containsProperly',
      duckDbFunction: 'ST_ContainsProperly',
      outputColumn: 'duckdb_contains_properly',
    },
  ] as const;

  beforeEach(() => {
    runRelationToolMock.mockClear();
  });

  it('passes filter helper options through to the relation core', async () => {
    const input = dataset();
    const mask = dataset();
    const opts = {
      inputLayer: 'parcels',
      maskLayer: 1,
      outputLayer: 'selected',
      inputGeometryColumn: 'parcel_geom',
      maskGeometryColumn: 'zone_geom',
    };

    await runNamedRelationOperation('filter', 'intersects', input, mask, opts, runtime);

    expect(runRelationToolMock).toHaveBeenCalledWith(
      input,
      mask,
      opts,
      {
        id: 'intersects',
        mode: 'filter',
        duckDbFunction: 'ST_Intersects',
      },
      runtime,
    );
  });

  it.each(
    TOPOLOGICAL_RELATION_CASES,
  )('builds %s filter relation operations', async (id, duckDbFunction) => {
    await runNamedRelationOperation('filter', id, dataset(), dataset());

    expect(lastRelationOperation()).toEqual({
      id,
      mode: 'filter',
      duckDbFunction,
    });
    expect(relationSql(lastRelationOperation())).toContain(duckDbFunction);
  });

  it.each(
    TOPOLOGICAL_RELATION_CASES,
  )('builds %s attribute relation operations with default columns', async (id, duckDbFunction, outputColumn) => {
    await runNamedRelationOperation('attribute', id, dataset(), dataset());

    expect(lastRelationOperation()).toEqual({
      id,
      mode: 'attribute',
      duckDbFunction,
      outputColumn,
    });
    const sql = relationSql(lastRelationOperation());
    expect(sql).toContain(duckDbFunction);
    expect(sql).toContain(`"${outputColumn}"`);
  });

  it('passes distanceWithin threshold into filter SQL', async () => {
    await runNamedRelationOperation('filter', 'distanceWithin', dataset(), dataset(), {
      distance: 25,
    });

    expect(lastRelationOperation()).toEqual({
      id: 'distanceWithin',
      mode: 'filter',
      duckDbFunction: 'ST_Distance',
      distance: 25,
    });
    expect(relationSql(lastRelationOperation())).toContain('ST_Distance');
    expect(relationSql(lastRelationOperation())).toContain('<= 25');
  });

  it('builds distance attribute SQL with the default output column', async () => {
    await runNamedRelationOperation('attribute', 'distance', dataset(), dataset());

    expect(lastRelationOperation()).toEqual({
      id: 'distance',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: 'duckdb_distance',
    });
    expect(relationSql(lastRelationOperation())).toContain('ST_Distance');
    expect(relationSql(lastRelationOperation())).toContain('"duckdb_distance"');
  });

  it('builds distanceWithin attribute SQL with the default output column', async () => {
    await runNamedRelationOperation('attribute', 'distanceWithin', dataset(), dataset(), {
      distance: 10.5,
    });

    expect(lastRelationOperation()).toEqual({
      id: 'distanceWithin',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance_within',
      distance: 10.5,
    });
    expect(relationSql(lastRelationOperation())).toContain('ST_Distance');
    expect(relationSql(lastRelationOperation())).toContain('<= 10.5');
    expect(relationSql(lastRelationOperation())).toContain('"duckdb_distance_within"');
  });

  it('lets callers override attribute output columns', async () => {
    await runNamedRelationOperation('attribute', 'contains', dataset(), dataset(), {
      outputColumn: 'matches_mask',
    });

    expect(lastRelationOperation()).toEqual({
      id: 'contains',
      mode: 'attribute',
      duckDbFunction: 'ST_Contains',
      outputColumn: 'matches_mask',
    });
  });

  it.each(
    TOPOLOGICAL_RELATION_CASES.map(([id]) => id),
  )('allows topological operation %s with EPSG:4326', async (id) => {
    await runNamedRelationOperation('filter', id, dataset('EPSG:4326'), dataset('EPSG:4326'));
    await runNamedRelationOperation('attribute', id, dataset('EPSG:4326'), dataset('EPSG:4326'));

    expect(runRelationToolMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['distance', 'attribute'],
    ['distanceWithin', 'filter'],
  ] as const)('rejects %s operations on geographic CRS by default', async (operation, mode) => {
    await expectValidationError(
      () =>
        runNamedRelationOperation(mode, operation, dataset('EPSG:4326'), dataset('EPSG:4326'), {
          distance: 5,
        }),
      'crs',
    );
  });

  it.each([
    ['distance attribute', 'distance', 'attribute', { id: 'distance' }],
    ['distanceWithin filter', 'distanceWithin', 'filter', { id: 'distanceWithin', distance: 5 }],
    [
      'distanceWithin attribute',
      'distanceWithin',
      'attribute',
      { id: 'distanceWithin', distance: 5 },
    ],
  ] as const)('allows distance operation %s on geographic CRS when failOnGeographicCrs is false', async (_name, operation, mode, expectedOperation) => {
    await runNamedRelationOperation(mode, operation, dataset('EPSG:4326'), dataset(), {
      distance: 5,
      failOnGeographicCrs: false,
    });

    expect(lastRelationOperation()).toMatchObject(expectedOperation);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid distanceWithin distance %s', async (distance) => {
    await expectValidationError(
      () =>
        runNamedRelationOperation('filter', 'distanceWithin', dataset(), dataset(), {
          distance,
        }),
      'distance',
    );
  });

  it.each([
    'filter',
    'attribute',
  ] as const)('validates distance before geographic CRS for distanceWithin %s mode', async (mode) => {
    await expectValidationError(
      () =>
        runNamedRelationOperation(
          mode,
          'distanceWithin',
          dataset('EPSG:4326'),
          dataset('EPSG:4326'),
          {
            distance: 0,
          },
        ),
      'distance',
    );
    await expectValidationError(
      () =>
        runNamedRelationOperation(
          mode,
          'distanceWithin',
          dataset('EPSG:4326'),
          dataset('EPSG:4326'),
        ),
      'distance',
    );
  });

  it('rejects missing distanceWithin distance', async () => {
    await expectValidationError(
      () => runNamedRelationOperation('attribute', 'distanceWithin', dataset(), dataset()),
      'distance',
    );
  });

  it('returns immutable named operations for map-op integration', () => {
    expect(getRelationOperation('intersects')).toEqual({
      id: 'intersects',
      duckDbFunction: 'ST_Intersects',
      outputColumn: 'duckdb_intersects',
      output: 'predicate',
    });
    expect(getRelationOperation('distance')).toEqual({
      id: 'distance',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance',
      output: 'distance',
    });
    expect(getRelationOperation('distanceWithin')).toEqual({
      id: 'distanceWithin',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance_within',
      output: 'predicate',
    });
  });

  it.each(ADDITIONAL_RELATION_CASES)('returns the additional $id operation', ({
    id,
    duckDbFunction,
    outputColumn,
  }) => {
    expect(getRelationOperation(id)).toEqual({
      id,
      duckDbFunction,
      outputColumn,
      output: 'predicate',
    });
  });

  it('throws validation errors for unknown operations', () => {
    expect(() => getRelationOperation('unsupported' as never)).toThrowError(DuckDbOperationError);
    expect(() => getRelationOperation('unsupported' as never)).toThrowError(
      /Unsupported DuckDB relation operation/,
    );
  });
});
