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

const RELATION_DESCRIPTORS = {
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

export type DuckDbRelationOperationId = keyof typeof RELATION_DESCRIPTORS;
export type DuckDbNamedRelationOperationSpec =
  (typeof RELATION_DESCRIPTORS)[DuckDbRelationOperationId];

export interface DuckDbRelationHelperOptions extends DuckDbRelationOptions {
  distance?: number;
  failOnGeographicCrs?: boolean;
}

type TopologicalRelationOperationId = Exclude<
  DuckDbRelationOperationId,
  'distance' | 'distanceWithin'
>;
type PredicateDuckDbFunction = Exclude<RelationDuckDbFunction, 'ST_Distance'>;
type RelationMode = 'filter' | 'attribute';
type RelationRunnerArgs = [
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts?: DuckDbRelationHelperOptions,
  runtime?: DuckDbRuntime | null,
];

export function getDuckDbRelationOperationSpec(
  operation: string,
): DuckDbNamedRelationOperationSpec {
  const spec = RELATION_DESCRIPTORS[operation as DuckDbRelationOperationId];
  if (!spec) {
    throw new DuckDbOperationError(
      'validation',
      `Unsupported DuckDB relation operation: ${operation}`,
      { field: 'op' },
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
    { field: 'crs' },
  );
}

function requireDistance(distance: number | undefined): number {
  if (typeof distance === 'number' && Number.isFinite(distance) && distance > 0) {
    return distance;
  }
  throw new DuckDbOperationError(
    'validation',
    'DuckDB distanceWithin relation requires a finite positive distance',
    { field: 'distance' },
  );
}

function runRelation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions,
  spec: DuckDbRelationOperationSpec,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  return processRelationWithDuckDb(inputDataset, maskDataset, opts, spec, runtime);
}

function runTopologicalOperation(
  operation: TopologicalRelationOperationId,
  mode: RelationMode,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const descriptor = RELATION_DESCRIPTORS[operation];
  return runRelation(
    inputDataset,
    maskDataset,
    opts,
    mode === 'filter'
      ? {
          id: descriptor.id,
          mode,
          duckDbFunction: descriptor.duckDbFunction as PredicateDuckDbFunction,
        }
      : {
          id: descriptor.id,
          mode,
          duckDbFunction: descriptor.duckDbFunction as PredicateDuckDbFunction,
          outputColumn: opts.outputColumn ?? descriptor.outputColumn,
        },
    runtime,
  );
}

function runDistanceWithinOperation(
  mode: RelationMode,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const distance = requireDistance(opts.distance);
  assertProjectedCrsForDistance(inputDataset, maskDataset, opts);
  return runRelation(
    inputDataset,
    maskDataset,
    opts,
    mode === 'filter'
      ? {
          id: 'distanceWithin',
          mode,
          duckDbFunction: 'ST_Distance',
          distance,
        }
      : {
          id: 'distanceWithin',
          mode,
          duckDbFunction: 'ST_Distance',
          distance,
          outputColumn: opts.outputColumn ?? RELATION_DESCRIPTORS.distanceWithin.outputColumn,
        },
    runtime,
  );
}

/** Execute a descriptor-backed relation operation for map-level adapters. */
export function runNamedDuckDbRelationOperation(
  mode: string,
  operation: string,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (mode !== 'filter' && mode !== 'attribute') {
    throw new DuckDbOperationError('validation', `Unknown DuckDB relation mode '${mode}'`, {
      field: 'mode',
    });
  }

  if (!(operation in RELATION_DESCRIPTORS)) {
    throw new DuckDbOperationError(
      'validation',
      `Unknown DuckDB relation operation '${operation}'`,
      { field: 'operation' },
    );
  }

  if (operation === 'distance') {
    if (mode === 'filter') {
      throw new DuckDbOperationError(
        'validation',
        "DuckDB relation operation 'distance' only supports attribute mode",
        { field: 'operation' },
      );
    }
    return distanceDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime);
  }

  if (operation === 'distanceWithin') {
    return runDistanceWithinOperation(mode, inputDataset, maskDataset, opts, runtime);
  }

  return runTopologicalOperation(
    operation as TopologicalRelationOperationId,
    mode,
    inputDataset,
    maskDataset,
    opts,
    runtime,
  );
}

export function intersectsDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('intersects', 'filter', ...args);
}

export function containsDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('contains', 'filter', ...args);
}

export function withinDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('within', 'filter', ...args);
}

export function touchesDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('touches', 'filter', ...args);
}

export function disjointDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('disjoint', 'filter', ...args);
}

export function overlapsDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('overlaps', 'filter', ...args);
}

export function equalsDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('equals', 'filter', ...args);
}

export function crossesDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('crosses', 'filter', ...args);
}

export function coversDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('covers', 'filter', ...args);
}

export function coveredByDatasetWithDuckDb(...args: RelationRunnerArgs): Promise<MapshaperDataset> {
  return runTopologicalOperation('coveredBy', 'filter', ...args);
}

export function containsProperlyDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('containsProperly', 'filter', ...args);
}

export function distanceWithinDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runDistanceWithinOperation('filter', ...args);
}

export function intersectsAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('intersects', 'attribute', ...args);
}

export function containsAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('contains', 'attribute', ...args);
}

export function withinAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('within', 'attribute', ...args);
}

export function touchesAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('touches', 'attribute', ...args);
}

export function disjointAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('disjoint', 'attribute', ...args);
}

export function overlapsAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('overlaps', 'attribute', ...args);
}

export function equalsAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('equals', 'attribute', ...args);
}

export function crossesAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('crosses', 'attribute', ...args);
}

export function coversAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('covers', 'attribute', ...args);
}

export function coveredByAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('coveredBy', 'attribute', ...args);
}

export function containsProperlyAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runTopologicalOperation('containsProperly', 'attribute', ...args);
}

export function distanceDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  assertProjectedCrsForDistance(inputDataset, maskDataset, opts);
  return runRelation(
    inputDataset,
    maskDataset,
    opts,
    {
      id: 'distance',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: opts.outputColumn ?? RELATION_DESCRIPTORS.distance.outputColumn,
    },
    runtime,
  );
}

export function distanceWithinAttributeDatasetWithDuckDb(
  ...args: RelationRunnerArgs
): Promise<MapshaperDataset> {
  return runDistanceWithinOperation('attribute', ...args);
}
