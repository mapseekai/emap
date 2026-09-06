import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import type { DuckDbGeometryOperation, DuckDbUnaryGeometryOptions } from '../core/runners/geometry';
import { UNARY_GEOMETRY_OPERATIONS } from './_shared';
import { centroid } from './centroid';
import { envelope } from './envelope';
import { convexHull } from './convex-hull';
import { boundary } from './boundary';
import { makeValid } from './make-valid';
import { simplify, simplifyPreserveTopology, type SimplifyOptions } from './simplify';

export type DuckDbUnaryGeometryOperationId =
  | 'centroid'
  | 'envelope'
  | 'convexHull'
  | 'boundary'
  | 'simplify'
  | 'simplifyPreserveTopology'
  | 'makeValid';

export function getDuckDbUnaryGeometryOperation(
  operationId: DuckDbUnaryGeometryOperationId,
  args: { tolerance?: number } = {},
): DuckDbGeometryOperation | null {
  if (operationId === 'simplify' || operationId === 'simplifyPreserveTopology') {
    if (args.tolerance === undefined) return null;
    return {
      id: operationId,
      duckDbFunction: operationId === 'simplify' ? 'ST_Simplify' : 'ST_SimplifyPreserveTopology',
      args: [args.tolerance],
    };
  }
  return UNARY_GEOMETRY_OPERATIONS[operationId] ?? null;
}

export function runNamedDuckDbGeometryOperation(
  dataset: MapshaperDataset,
  operationId: string,
  options: DuckDbUnaryGeometryOptions & {
    tolerance?: number;
    failOnGeographicCrs?: boolean;
  } = {},
  runtime: DuckDbRuntime | null | undefined = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const resolvedRuntime = runtime === undefined ? getDuckDbRuntime() : runtime;
  switch (operationId) {
    case 'centroid':
      return centroid(dataset, options, resolvedRuntime);
    case 'envelope':
      return envelope(dataset, options, resolvedRuntime);
    case 'convexHull':
      return convexHull(dataset, options, resolvedRuntime);
    case 'boundary':
      return boundary(dataset, options, resolvedRuntime);
    case 'makeValid':
      return makeValid(dataset, options, resolvedRuntime);
    case 'simplify':
      return simplify(dataset, options as SimplifyOptions, resolvedRuntime);
    case 'simplifyPreserveTopology':
      return simplifyPreserveTopology(dataset, options as SimplifyOptions, resolvedRuntime);
    default:
      throw new DuckDbOperationError(
        'validation',
        `Unknown DuckDB geometry operation '${operationId}'`,
        { field: 'operation' },
      );
  }
}
