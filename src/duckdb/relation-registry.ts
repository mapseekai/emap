import type { MapshaperDataset } from '../types/mapshaper-types';
import { isGeographicCrs } from '../geo/crs-resolver';
import { DuckDbOperationError } from './errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';
import {
  processRelationWithDuckDb,
  type DuckDbRelationOperationSpec,
  type DuckDbRelationOptions,
} from './relation-executor';
import type { RelationDuckDbFunction } from './sql';

const DUCKDB_RELATION_OPERATION_SPECS = {
  intersects: {
    id: 'intersects',
    duckDbFunction: 'ST_Intersects',
    outputColumn: 'duckdb_intersects',
    output: 'predicate',
  },
  contains: {
    id: 'contains',
    duckDbFunction: 'ST_Contains',
    outputColumn: 'duckdb_contains',
    output: 'predicate',
  },
  within: {
    id: 'within',
    duckDbFunction: 'ST_Within',
    outputColumn: 'duckdb_within',
    output: 'predicate',
  },
  touches: {
    id: 'touches',
    duckDbFunction: 'ST_Touches',
    outputColumn: 'duckdb_touches',
    output: 'predicate',
  },
  disjoint: {
    id: 'disjoint',
    duckDbFunction: 'ST_Disjoint',
    outputColumn: 'duckdb_disjoint',
    output: 'predicate',
  },
  overlaps: {
    id: 'overlaps',
    duckDbFunction: 'ST_Overlaps',
    outputColumn: 'duckdb_overlaps',
    output: 'predicate',
  },
  equals: {
    id: 'equals',
    duckDbFunction: 'ST_Equals',
    outputColumn: 'duckdb_equals',
    output: 'predicate',
  },
  crosses: {
    id: 'crosses',
    duckDbFunction: 'ST_Crosses',
    outputColumn: 'duckdb_crosses',
    output: 'predicate',
  },
  covers: {
    id: 'covers',
    duckDbFunction: 'ST_Covers',
    outputColumn: 'duckdb_covers',
    output: 'predicate',
  },
  coveredBy: {
    id: 'coveredBy',
    duckDbFunction: 'ST_CoveredBy',
    outputColumn: 'duckdb_covered_by',
    output: 'predicate',
  },
  containsProperly: {
    id: 'containsProperly',
    duckDbFunction: 'ST_ContainsProperly',
    outputColumn: 'duckdb_contains_properly',
    output: 'predicate',
  },
  distance: {
    id: 'distance',
    duckDbFunction: 'ST_Distance',
    outputColumn: 'duckdb_distance',
    output: 'distance',
  },
  distanceWithin: {
    id: 'distanceWithin',
    duckDbFunction: 'ST_Distance',
    outputColumn: 'duckdb_distance_within',
    output: 'predicate',
  },
} as const;

export type DuckDbRelationOperationId = keyof typeof DUCKDB_RELATION_OPERATION_SPECS;

export type DuckDbNamedRelationOperationSpec =
  (typeof DUCKDB_RELATION_OPERATION_SPECS)[DuckDbRelationOperationId];

export interface DuckDbRelationHelperOptions extends DuckDbRelationOptions {
  distance?: number;
  failOnGeographicCrs?: boolean;
}

type TopologicalRelationOperationId = Exclude<
  DuckDbRelationOperationId,
  'distance' | 'distanceWithin'
>;

type PredicateDuckDbFunction = Exclude<RelationDuckDbFunction, 'ST_Distance'>;

export function getDuckDbRelationOperationSpec(
  operation: string,
): DuckDbNamedRelationOperationSpec {
  const spec = DUCKDB_RELATION_OPERATION_SPECS[operation as DuckDbRelationOperationId];
  if (!spec) {
    throw new DuckDbOperationError(
      'validation',
      `Unsupported DuckDB relation operation: ${operation}`,
      {
        field: 'op',
      },
    );
  }
  return { ...spec };
}

function assertProjectedCrsForDistance(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions,
): void {
  if (opts.failOnGeographicCrs === false) return;
  if (!isGeographicCrs(inputDataset) && !isGeographicCrs(maskDataset)) return;

  throw new DuckDbOperationError(
    'validation',
    'DuckDB distance relation operations require a projected CRS',
    {
      field: 'crs',
    },
  );
}

function requireDistanceWithinDistance(distance: number | undefined): number {
  if (typeof distance === 'number' && Number.isFinite(distance) && distance > 0) {
    return distance;
  }

  throw new DuckDbOperationError(
    'validation',
    'DuckDB distanceWithin relation requires a finite positive distance',
    {
      field: 'distance',
    },
  );
}

function runRelationHelper(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions,
  spec: DuckDbRelationOperationSpec,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  return processRelationWithDuckDb(inputDataset, maskDataset, opts, spec, runtime);
}

function runDistanceWithinHelper(
  mode: 'filter' | 'attribute',
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  const distance = requireDistanceWithinDistance(opts.distance);
  assertProjectedCrsForDistance(inputDataset, maskDataset, opts);
  return runRelationHelper(
    inputDataset,
    maskDataset,
    opts,
    mode === 'attribute'
      ? {
          id: 'distanceWithin',
          mode,
          duckDbFunction: 'ST_Distance',
          outputColumn: opts.outputColumn ?? 'duckdb_distance_within',
          distance,
        }
      : {
          id: 'distanceWithin',
          mode,
          duckDbFunction: 'ST_Distance',
          distance,
        },
    runtime,
  );
}

function runTopologicalFilterHelper(
  operation: TopologicalRelationOperationId,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  const spec = getDuckDbRelationOperationSpec(operation);
  return runRelationHelper(
    inputDataset,
    maskDataset,
    opts,
    {
      id: spec.id,
      mode: 'filter',
      duckDbFunction: spec.duckDbFunction as PredicateDuckDbFunction,
    },
    runtime,
  );
}

function runTopologicalAttributeHelper(
  operation: TopologicalRelationOperationId,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  const spec = getDuckDbRelationOperationSpec(operation);
  return runRelationHelper(
    inputDataset,
    maskDataset,
    opts,
    {
      id: spec.id,
      mode: 'attribute',
      duckDbFunction: spec.duckDbFunction as PredicateDuckDbFunction,
      outputColumn: opts.outputColumn ?? spec.outputColumn,
    },
    runtime,
  );
}

export function intersectsDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('intersects', inputDataset, maskDataset, opts, runtime);
}

export function containsDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('contains', inputDataset, maskDataset, opts, runtime);
}

export function withinDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('within', inputDataset, maskDataset, opts, runtime);
}

export function touchesDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('touches', inputDataset, maskDataset, opts, runtime);
}

export function disjointDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('disjoint', inputDataset, maskDataset, opts, runtime);
}

export function overlapsDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('overlaps', inputDataset, maskDataset, opts, runtime);
}

export function equalsDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('equals', inputDataset, maskDataset, opts, runtime);
}

export function crossesDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('crosses', inputDataset, maskDataset, opts, runtime);
}

export function coversDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('covers', inputDataset, maskDataset, opts, runtime);
}

export function coveredByDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('coveredBy', inputDataset, maskDataset, opts, runtime);
}

export function containsProperlyDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('containsProperly', inputDataset, maskDataset, opts, runtime);
}

export function distanceWithinDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runDistanceWithinHelper('filter', inputDataset, maskDataset, opts, runtime);
}

export function intersectsAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('intersects', inputDataset, maskDataset, opts, runtime);
}

export function containsAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('contains', inputDataset, maskDataset, opts, runtime);
}

export function withinAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('within', inputDataset, maskDataset, opts, runtime);
}

export function touchesAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('touches', inputDataset, maskDataset, opts, runtime);
}

export function disjointAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('disjoint', inputDataset, maskDataset, opts, runtime);
}

export function overlapsAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('overlaps', inputDataset, maskDataset, opts, runtime);
}

export function equalsAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('equals', inputDataset, maskDataset, opts, runtime);
}

export function crossesAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('crosses', inputDataset, maskDataset, opts, runtime);
}

export function coversAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('covers', inputDataset, maskDataset, opts, runtime);
}

export function coveredByAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('coveredBy', inputDataset, maskDataset, opts, runtime);
}

export function containsProperlyAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper(
    'containsProperly',
    inputDataset,
    maskDataset,
    opts,
    runtime,
  );
}

export function distanceDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  assertProjectedCrsForDistance(inputDataset, maskDataset, opts);
  return runRelationHelper(
    inputDataset,
    maskDataset,
    opts,
    {
      id: 'distance',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: opts.outputColumn ?? 'duckdb_distance',
    },
    runtime,
  );
}

export function distanceWithinAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runDistanceWithinHelper('attribute', inputDataset, maskDataset, opts, runtime);
}
