import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { runUnaryGeometryTool, type GeometryOperation } from '../core/runners/geometry';
import type { GeometryOptions } from './types';
import { type DuckDbRuntime } from '../runtime';

export type UnaryGeometryOperationId = 'centroid' | 'envelope' | 'convexHull' | 'boundary';

export const UNARY_GEOMETRY_OPERATIONS: Record<UnaryGeometryOperationId, GeometryOperation> = {
  centroid: { id: 'centroid', duckDbFunction: 'ST_Centroid' },
  envelope: { id: 'envelope', duckDbFunction: 'ST_Envelope' },
  convexHull: { id: 'convexHull', duckDbFunction: 'ST_ConvexHull' },
  boundary: { id: 'boundary', duckDbFunction: 'ST_Boundary' },
};

export function runUnary(
  operationId: UnaryGeometryOperationId,
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = null,
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
