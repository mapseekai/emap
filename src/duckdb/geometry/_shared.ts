import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import {
  runUnaryGeometryTool,
  type DuckDbGeometryOperation,
  type DuckDbUnaryGeometryOptions,
} from '../core/runners/geometry';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';

export type UnaryGeometryOperationId =
  | 'centroid'
  | 'envelope'
  | 'convexHull'
  | 'boundary'
  | 'makeValid';

export const UNARY_GEOMETRY_OPERATIONS: Record<UnaryGeometryOperationId, DuckDbGeometryOperation> =
  {
    centroid: { id: 'centroid', duckDbFunction: 'ST_Centroid' },
    envelope: { id: 'envelope', duckDbFunction: 'ST_Envelope' },
    convexHull: { id: 'convexHull', duckDbFunction: 'ST_ConvexHull' },
    boundary: { id: 'boundary', duckDbFunction: 'ST_Boundary' },
    makeValid: { id: 'makeValid', duckDbFunction: 'ST_MakeValid' },
  };

export function runUnary(
  operationId: UnaryGeometryOperationId,
  input: MapshaperDataset,
  options: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  const operation = UNARY_GEOMETRY_OPERATIONS[operationId];
  if (!operation) {
    throw new DuckDbOperationError(
      'validation',
      `Unknown DuckDB geometry operation '${operationId}'`,
      { field: 'operation' },
    );
  }
  return runUnaryGeometryTool(
    input,
    { ...options, geometryColumn: options.geometryColumn ?? 'geometry' },
    operation,
    runtime,
  );
}

export type GeometryOptions = DuckDbUnaryGeometryOptions;
