import type { MapshaperDataset } from '../../types/mapshaper-types';
import { isGeographicCrs } from '../../geo/crs-resolver';
import { DuckDbOperationError } from '../errors';
import {
  runRelationTool,
  type DuckDbRelationOperation,
  type DuckDbRelationOptions,
} from '../core/runners/relation';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import {
  RELATION_OPERATIONS,
  type DuckDbNamedRelationOperation,
  type DuckDbRelationOperationId,
  type DuckDbTopologicalRelationOperationId,
} from './_relation-types';

export interface DuckDbRelationHelperOptions extends DuckDbRelationOptions {
  distance?: number;
  failOnGeographicCrs?: boolean;
}

export function getDuckDbRelationOperation(
  operationId: DuckDbRelationOperationId,
): DuckDbNamedRelationOperation {
  if (operationId === 'distance') {
    return {
      id: operationId,
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance',
      output: 'distance',
    };
  }
  if (operationId === 'distanceWithin') {
    return {
      id: operationId,
      duckDbFunction: 'ST_Distance',
      outputColumn: 'duckdb_distance_within',
      output: 'predicate',
    };
  }
  const operation = RELATION_OPERATIONS[operationId];
  if (!operation) {
    throw new DuckDbOperationError(
      'validation',
      `Unsupported DuckDB relation operation: ${operationId}`,
      { field: 'operation' },
    );
  }
  return { id: operationId, ...operation, output: 'predicate' };
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
  if (typeof distance === 'number' && Number.isFinite(distance) && distance > 0) return distance;
  throw new DuckDbOperationError(
    'validation',
    'DuckDB distanceWithin relation requires a finite positive distance',
    { field: 'distance' },
  );
}

export function runTopologicalRelation(
  operationId: DuckDbTopologicalRelationOperationId,
  mode: 'filter' | 'attribute',
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const operationDefinition = RELATION_OPERATIONS[operationId];
  const operation: DuckDbRelationOperation =
    mode === 'filter'
      ? { id: operationId, mode, duckDbFunction: operationDefinition.duckDbFunction }
      : {
          id: operationId,
          mode,
          duckDbFunction: operationDefinition.duckDbFunction,
          outputColumn: opts.outputColumn ?? operationDefinition.outputColumn,
        };
  return runRelationTool(inputDataset, maskDataset, opts, operation, runtime);
}

export function runDistanceWithinRelation(
  mode: 'filter' | 'attribute',
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const distance = requireDistance(opts.distance);
  assertProjectedCrsForDistance(inputDataset, maskDataset, opts);
  const operation: DuckDbRelationOperation =
    mode === 'filter'
      ? { id: 'distanceWithin', mode, duckDbFunction: 'ST_Distance', distance }
      : {
          id: 'distanceWithin',
          mode,
          duckDbFunction: 'ST_Distance',
          distance,
          outputColumn: opts.outputColumn ?? 'duckdb_distance_within',
        };
  return runRelationTool(inputDataset, maskDataset, opts, operation, runtime);
}

export function distanceRelation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  assertProjectedCrsForDistance(inputDataset, maskDataset, opts);
  return runRelationTool(
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
