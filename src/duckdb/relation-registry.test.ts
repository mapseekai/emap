import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './errors';
import { processRelationWithDuckDb, type DuckDbRelationOperationSpec } from './relation-executor';
import { buildRelationAttributeSql, buildRelationFilterSql } from './sql';
import {
  containsAttributeDatasetWithDuckDb,
  containsProperlyAttributeDatasetWithDuckDb,
  containsProperlyDatasetWithDuckDb,
  containsDatasetWithDuckDb,
  coveredByAttributeDatasetWithDuckDb,
  coveredByDatasetWithDuckDb,
  coversAttributeDatasetWithDuckDb,
  coversDatasetWithDuckDb,
  crossesAttributeDatasetWithDuckDb,
  crossesDatasetWithDuckDb,
  disjointAttributeDatasetWithDuckDb,
  disjointDatasetWithDuckDb,
  distanceDatasetWithDuckDb,
  distanceWithinAttributeDatasetWithDuckDb,
  distanceWithinDatasetWithDuckDb,
  equalsAttributeDatasetWithDuckDb,
  equalsDatasetWithDuckDb,
  getDuckDbRelationOperationSpec,
  intersectsAttributeDatasetWithDuckDb,
  intersectsDatasetWithDuckDb,
  overlapsAttributeDatasetWithDuckDb,
  overlapsDatasetWithDuckDb,
  touchesAttributeDatasetWithDuckDb,
  touchesDatasetWithDuckDb,
  withinAttributeDatasetWithDuckDb,
  withinDatasetWithDuckDb,
} from './relation-registry';

vi.mock('./relation-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relation-executor')>();
  return {
    ...actual,
    processRelationWithDuckDb: vi.fn(async (inputDataset) => inputDataset),
  };
});

const processRelationWithDuckDbMock = vi.mocked(processRelationWithDuckDb);
const runtime = { runtime: 'duckdb' };

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

function lastRelationSpec(): DuckDbRelationOperationSpec {
  return processRelationWithDuckDbMock.mock.calls.at(-1)?.[3] as DuckDbRelationOperationSpec;
}

function relationSql(spec: DuckDbRelationOperationSpec): string {
  const baseSqlOptions = {
    inputTableName: 'input_table',
    maskTableName: 'mask_table',
    inputGeometryColumn: 'geometry',
    maskGeometryColumn: 'geometry',
  };

  if (spec.mode === 'filter') {
    return 'distance' in spec
      ? buildRelationFilterSql({
          ...baseSqlOptions,
          duckDbFunction: 'ST_Distance',
          distance: spec.distance,
        })
      : buildRelationFilterSql({
          ...baseSqlOptions,
          duckDbFunction: spec.duckDbFunction,
        });
  }

  if (spec.output === 'distance') {
    return buildRelationAttributeSql({
      ...baseSqlOptions,
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: spec.outputColumn!,
    });
  }

  return 'distance' in spec
    ? buildRelationAttributeSql({
        ...baseSqlOptions,
        duckDbFunction: 'ST_Distance',
        distance: spec.distance,
        outputColumn: spec.outputColumn!,
      })
    : buildRelationAttributeSql({
        ...baseSqlOptions,
        duckDbFunction: spec.duckDbFunction,
        outputColumn: spec.outputColumn!,
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

describe('named DuckDB relation helpers', () => {
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
    processRelationWithDuckDbMock.mockClear();
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

    await intersectsDatasetWithDuckDb(input, mask, opts, runtime);

    expect(processRelationWithDuckDbMock).toHaveBeenCalledWith(
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

  it.each([
    [intersectsDatasetWithDuckDb, 'intersects', 'ST_Intersects'],
    [containsDatasetWithDuckDb, 'contains', 'ST_Contains'],
    [withinDatasetWithDuckDb, 'within', 'ST_Within'],
    [touchesDatasetWithDuckDb, 'touches', 'ST_Touches'],
    [disjointDatasetWithDuckDb, 'disjoint', 'ST_Disjoint'],
    [overlapsDatasetWithDuckDb, 'overlaps', 'ST_Overlaps'],
    [equalsDatasetWithDuckDb, 'equals', 'ST_Equals'],
    [crossesDatasetWithDuckDb, 'crosses', 'ST_Crosses'],
    [coversDatasetWithDuckDb, 'covers', 'ST_Covers'],
    [coveredByDatasetWithDuckDb, 'coveredBy', 'ST_CoveredBy'],
    [containsProperlyDatasetWithDuckDb, 'containsProperly', 'ST_ContainsProperly'],
  ])('builds %s filter relation specs', async (helper, id, duckDbFunction) => {
    await helper(dataset(), dataset());

    expect(lastRelationSpec()).toEqual({
      id,
      mode: 'filter',
      duckDbFunction,
    });
    expect(relationSql(lastRelationSpec())).toContain(duckDbFunction);
  });

  it.each([
    [intersectsAttributeDatasetWithDuckDb, 'intersects', 'ST_Intersects', 'duckdb_intersects'],
    [containsAttributeDatasetWithDuckDb, 'contains', 'ST_Contains', 'duckdb_contains'],
    [withinAttributeDatasetWithDuckDb, 'within', 'ST_Within', 'duckdb_within'],
    [touchesAttributeDatasetWithDuckDb, 'touches', 'ST_Touches', 'duckdb_touches'],
    [disjointAttributeDatasetWithDuckDb, 'disjoint', 'ST_Disjoint', 'duckdb_disjoint'],
    [overlapsAttributeDatasetWithDuckDb, 'overlaps', 'ST_Overlaps', 'duckdb_overlaps'],
    [equalsAttributeDatasetWithDuckDb, 'equals', 'ST_Equals', 'duckdb_equals'],
    [crossesAttributeDatasetWithDuckDb, 'crosses', 'ST_Crosses', 'duckdb_crosses'],
    [coversAttributeDatasetWithDuckDb, 'covers', 'ST_Covers', 'duckdb_covers'],
    [coveredByAttributeDatasetWithDuckDb, 'coveredBy', 'ST_CoveredBy', 'duckdb_covered_by'],
    [
      containsProperlyAttributeDatasetWithDuckDb,
      'containsProperly',
      'ST_ContainsProperly',
      'duckdb_contains_properly',
    ],
  ])('builds %s attribute relation specs with default columns', async (helper, id, duckDbFunction, outputColumn) => {
    await helper(dataset(), dataset());

    expect(lastRelationSpec()).toEqual({
      id,
      mode: 'attribute',
      duckDbFunction,
      outputColumn,
    });
    const sql = relationSql(lastRelationSpec());
    expect(sql).toContain(duckDbFunction);
    expect(sql).toContain(`"${outputColumn}"`);
  });

  it('passes distanceWithin threshold into filter SQL', async () => {
    await distanceWithinDatasetWithDuckDb(dataset(), dataset(), {
      distance: 25,
    });

    expect(lastRelationSpec()).toEqual({
      id: 'distanceWithin',
      mode: 'filter',
      duckDbFunction: 'ST_Distance',
      distance: 25,
    });
    expect(relationSql(lastRelationSpec())).toContain('ST_Distance');
    expect(relationSql(lastRelationSpec())).toContain('<= 25');
  });

  it('builds distance attribute SQL with the default output column', async () => {
    await distanceDatasetWithDuckDb(dataset(), dataset());

    expect(lastRelationSpec()).toEqual({
      id: 'distance',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: 'duckdb_distance',
    });
    expect(relationSql(lastRelationSpec())).toContain('ST_Distance');
    expect(relationSql(lastRelationSpec())).toContain('"duckdb_distance"');
  });

  it('builds distanceWithin attribute SQL with the default output column', async () => {
    await distanceWithinAttributeDatasetWithDuckDb(dataset(), dataset(), {
      distance: 10.5,
    });

    expect(lastRelationSpec()).toEqual({
      id: 'distanceWithin',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance_within',
      distance: 10.5,
    });
    expect(relationSql(lastRelationSpec())).toContain('ST_Distance');
    expect(relationSql(lastRelationSpec())).toContain('<= 10.5');
    expect(relationSql(lastRelationSpec())).toContain('"duckdb_distance_within"');
  });

  it('lets callers override attribute output columns', async () => {
    await containsAttributeDatasetWithDuckDb(dataset(), dataset(), {
      outputColumn: 'matches_mask',
    });

    expect(lastRelationSpec()).toEqual({
      id: 'contains',
      mode: 'attribute',
      duckDbFunction: 'ST_Contains',
      outputColumn: 'matches_mask',
    });
  });

  it.each([
    ['intersects filter', intersectsDatasetWithDuckDb],
    ['contains filter', containsDatasetWithDuckDb],
    ['within filter', withinDatasetWithDuckDb],
    ['touches filter', touchesDatasetWithDuckDb],
    ['disjoint filter', disjointDatasetWithDuckDb],
    ['overlaps filter', overlapsDatasetWithDuckDb],
    ['equals filter', equalsDatasetWithDuckDb],
    ['crosses filter', crossesDatasetWithDuckDb],
    ['covers filter', coversDatasetWithDuckDb],
    ['coveredBy filter', coveredByDatasetWithDuckDb],
    ['containsProperly filter', containsProperlyDatasetWithDuckDb],
    ['intersects attribute', intersectsAttributeDatasetWithDuckDb],
    ['contains attribute', containsAttributeDatasetWithDuckDb],
    ['within attribute', withinAttributeDatasetWithDuckDb],
    ['touches attribute', touchesAttributeDatasetWithDuckDb],
    ['disjoint attribute', disjointAttributeDatasetWithDuckDb],
    ['overlaps attribute', overlapsAttributeDatasetWithDuckDb],
    ['equals attribute', equalsAttributeDatasetWithDuckDb],
    ['crosses attribute', crossesAttributeDatasetWithDuckDb],
    ['covers attribute', coversAttributeDatasetWithDuckDb],
    ['coveredBy attribute', coveredByAttributeDatasetWithDuckDb],
    ['containsProperly attribute', containsProperlyAttributeDatasetWithDuckDb],
  ])('allows topological helper %s with EPSG:4326', async (_name, helper) => {
    await helper(dataset('EPSG:4326'), dataset('EPSG:4326'));

    expect(processRelationWithDuckDbMock).toHaveBeenCalledOnce();
  });

  it.each([
    distanceDatasetWithDuckDb,
    distanceWithinDatasetWithDuckDb,
  ])('rejects distance helpers on geographic CRS by default', async (helper) => {
    await expectValidationError(
      () => helper(dataset('EPSG:4326'), dataset('EPSG:4326'), { distance: 5 }),
      'crs',
    );
  });

  it.each([
    ['distance attribute', distanceDatasetWithDuckDb, { id: 'distance' }],
    [
      'distanceWithin filter',
      distanceWithinDatasetWithDuckDb,
      { id: 'distanceWithin', distance: 5 },
    ],
    [
      'distanceWithin attribute',
      distanceWithinAttributeDatasetWithDuckDb,
      { id: 'distanceWithin', distance: 5 },
    ],
  ])('allows distance helper %s on geographic CRS when failOnGeographicCrs is false', async (_name, helper, expectedSpec) => {
    await helper(dataset('EPSG:4326'), dataset(), {
      distance: 5,
      failOnGeographicCrs: false,
    });

    expect(lastRelationSpec()).toMatchObject(expectedSpec);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid distanceWithin distance %s', async (distance) => {
    await expectValidationError(
      () => distanceWithinDatasetWithDuckDb(dataset(), dataset(), { distance }),
      'distance',
    );
  });

  it.each([
    ['filter', distanceWithinDatasetWithDuckDb],
    ['attribute', distanceWithinAttributeDatasetWithDuckDb],
  ])('validates distance before geographic CRS for distanceWithin %s helpers', async (_name, helper) => {
    await expectValidationError(
      () => helper(dataset('EPSG:4326'), dataset('EPSG:4326'), { distance: 0 }),
      'distance',
    );
    await expectValidationError(
      () => helper(dataset('EPSG:4326'), dataset('EPSG:4326')),
      'distance',
    );
  });

  it('rejects missing distanceWithin distance', async () => {
    await expectValidationError(
      () => distanceWithinAttributeDatasetWithDuckDb(dataset(), dataset()),
      'distance',
    );
  });

  it('returns immutable named operation specs for map-op integration', () => {
    expect(getDuckDbRelationOperationSpec('intersects')).toEqual({
      id: 'intersects',
      duckDbFunction: 'ST_Intersects',
      outputColumn: 'duckdb_intersects',
      output: 'predicate',
    });
    expect(getDuckDbRelationOperationSpec('distance')).toEqual({
      id: 'distance',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance',
      output: 'distance',
    });
    expect(getDuckDbRelationOperationSpec('distanceWithin')).toEqual({
      id: 'distanceWithin',
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance_within',
      output: 'predicate',
    });
  });

  it.each(ADDITIONAL_RELATION_CASES)('returns the additional $id operation spec', ({
    id,
    duckDbFunction,
    outputColumn,
  }) => {
    expect(getDuckDbRelationOperationSpec(id)).toEqual({
      id,
      duckDbFunction,
      outputColumn,
      output: 'predicate',
    });
  });

  it('throws validation errors for unknown operation specs', () => {
    expect(() => getDuckDbRelationOperationSpec('unsupported')).toThrowError(DuckDbOperationError);
    expect(() => getDuckDbRelationOperationSpec('unsupported')).toThrowError(
      /Unsupported DuckDB relation operation/,
    );
  });
});
