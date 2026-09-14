import type { MapshaperDataset } from '../../../types/mapshaper-types';
import { assertProjectedCrs } from '../dataset-crs';
import { DuckDbOperationError } from '../../errors';
import { runRelationTool, type RelationOperation } from '../runners/relation';
import type { BinaryRelationOptions } from '../types';
import { type DuckDbRuntime } from '../../runtime';
import {
  RELATION_OPERATIONS,
  type NamedRelationOperation,
  type RelationOperationId,
  type TopologicalRelationOperationId,
} from './types';

export interface RelationOptions extends BinaryRelationOptions {
  distance?: number;
  failOnGeographicCrs?: boolean;
}

export function getRelationOperation(operationId: RelationOperationId): NamedRelationOperation {
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
  options: RelationOptions,
): void {
  if (options.failOnGeographicCrs === false) return;
  assertProjectedCrs(
    [inputDataset, maskDataset],
    'DuckDB distance relation operations require a projected CRS',
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
  operationId: TopologicalRelationOperationId,
  mode: 'filter' | 'attribute',
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  options: RelationOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  const operationDefinition = RELATION_OPERATIONS[operationId];
  const operation: RelationOperation =
    mode === 'filter'
      ? { id: operationId, mode, duckDbFunction: operationDefinition.duckDbFunction }
      : {
          id: operationId,
          mode,
          duckDbFunction: operationDefinition.duckDbFunction,
          outputColumn: options.outputColumn ?? operationDefinition.outputColumn,
        };
  return runRelationTool(inputDataset, maskDataset, options, operation, runtime);
}

export function runDistanceWithinRelation(
  mode: 'filter' | 'attribute',
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  options: RelationOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  const distance = requireDistance(options.distance);
  assertProjectedCrsForDistance(inputDataset, maskDataset, options);
  const operation: RelationOperation =
    mode === 'filter'
      ? { id: 'distanceWithin', mode, duckDbFunction: 'ST_Distance', distance }
      : {
          id: 'distanceWithin',
          mode,
          duckDbFunction: 'ST_Distance',
          distance,
          outputColumn: options.outputColumn ?? 'duckdb_distance_within',
        };
  return runRelationTool(inputDataset, maskDataset, options, operation, runtime);
}

export function distanceRelation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  options: RelationOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  assertProjectedCrsForDistance(inputDataset, maskDataset, options);
  return runRelationTool(
    inputDataset,
    maskDataset,
    options,
    {
      id: 'distance',
      mode: 'attribute',
      duckDbFunction: 'ST_Distance',
      output: 'distance',
      outputColumn: options.outputColumn ?? 'duckdb_distance',
    },
    runtime,
  );
}

export function runNamedRelationOperation(
  mode: string,
  operationId: string,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  options: RelationOptions = {},
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  if (mode !== 'filter' && mode !== 'attribute') {
    throw new DuckDbOperationError('validation', `Unknown DuckDB relation mode '${mode}'`, {
      field: 'mode',
    });
  }
  if (
    !(operationId in RELATION_OPERATIONS) &&
    operationId !== 'distance' &&
    operationId !== 'distanceWithin'
  ) {
    throw new DuckDbOperationError(
      'validation',
      `Unknown DuckDB relation operation '${operationId}'`,
      { field: 'operation' },
    );
  }
  if (operationId === 'distance') {
    if (mode === 'filter') {
      throw new DuckDbOperationError(
        'validation',
        "DuckDB relation operation 'distance' only supports attribute mode",
        { field: 'operation' },
      );
    }
    return distanceRelation(inputDataset, maskDataset, options, runtime);
  }
  if (operationId === 'distanceWithin') {
    return runDistanceWithinRelation(mode, inputDataset, maskDataset, options, runtime);
  }
  return runTopologicalRelation(
    operationId as TopologicalRelationOperationId,
    mode,
    inputDataset,
    maskDataset,
    options,
    runtime,
  );
}
