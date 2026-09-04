import type { MapshaperDataset } from '../types/mapshaper-types';
import { isGeographicCrs } from '../geo/crs-resolver';
import { DuckDbOperationError } from './errors';
import {
  processGeometryWithDuckDb,
  type DuckDbGeometryOperationSpec,
  type DuckDbUnaryGeometryOptions,
} from './geometry-executor';
import { type DuckDbRuntime, getDuckDbRuntime } from './runtime';

export type DuckDbUnaryGeometryOperationId =
  | 'centroid'
  | 'envelope'
  | 'convexHull'
  | 'boundary'
  | 'simplify'
  | 'simplifyPreserveTopology'
  | 'makeValid';

export interface DuckDbSimplifyOptions extends DuckDbUnaryGeometryOptions {
  tolerance: number;
  failOnGeographicCrs?: boolean;
}

interface NormalizedDuckDbSimplifyOptions extends DuckDbSimplifyOptions {
  geometryColumn: string;
  failOnGeographicCrs: boolean;
}

export const DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS: Record<
  Exclude<DuckDbUnaryGeometryOperationId, 'simplify' | 'simplifyPreserveTopology'>,
  DuckDbGeometryOperationSpec
> = {
  centroid: { id: 'centroid', duckDbFunction: 'ST_Centroid' },
  envelope: { id: 'envelope', duckDbFunction: 'ST_Envelope' },
  convexHull: { id: 'convexHull', duckDbFunction: 'ST_ConvexHull' },
  boundary: { id: 'boundary', duckDbFunction: 'ST_Boundary' },
  makeValid: { id: 'makeValid', duckDbFunction: 'ST_MakeValid' },
};

function normalizeSimplifyOptions(
  dataset: MapshaperDataset,
  opts: DuckDbSimplifyOptions,
  operationName: string,
): NormalizedDuckDbSimplifyOptions {
  if (!Number.isFinite(opts.tolerance) || opts.tolerance < 0) {
    throw new DuckDbOperationError(
      'validation',
      `DuckDB ${operationName} tolerance must be a finite number greater than or equal to zero`,
      { field: 'tolerance' },
    );
  }

  const failOnGeographicCrs = opts.failOnGeographicCrs ?? true;
  if (failOnGeographicCrs && isGeographicCrs(dataset)) {
    throw new DuckDbOperationError(
      'validation',
      `DuckDB ${operationName} uses coordinate units; reproject to a projected CRS before simplifying.`,
      { field: 'crs' },
    );
  }

  return {
    layer: opts.layer,
    outputLayer: opts.outputLayer,
    geometryColumn: opts.geometryColumn ?? 'geometry',
    tolerance: opts.tolerance,
    failOnGeographicCrs,
  };
}

function processNamedGeometryOperation(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions,
  spec: DuckDbGeometryOperationSpec,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  return processGeometryWithDuckDb(
    dataset,
    { ...opts, geometryColumn: opts.geometryColumn ?? 'geometry' },
    spec,
    runtime,
  );
}

/** @internal Execute a descriptor-backed geometry operation by id. */
export async function runNamedDuckDbGeometryOperation(
  dataset: MapshaperDataset,
  operation: string,
  opts: DuckDbUnaryGeometryOptions & {
    tolerance?: number;
    failOnGeographicCrs?: boolean;
  } = {},
  runtime: DuckDbRuntime | null | undefined = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const resolvedRuntime = runtime === undefined ? getDuckDbRuntime() : runtime;
  if (operation === 'simplify' || operation === 'simplifyPreserveTopology') {
    const normalized = normalizeSimplifyOptions(
      dataset,
      { ...opts, tolerance: opts.tolerance as number },
      operation,
    );
    return processGeometryWithDuckDb(
      dataset,
      normalized,
      {
        id: operation,
        duckDbFunction: operation === 'simplify' ? 'ST_Simplify' : 'ST_SimplifyPreserveTopology',
        args: [normalized.tolerance],
      },
      resolvedRuntime,
    );
  }

  const spec =
    DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS[
      operation as keyof typeof DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS
    ];
  if (!spec) {
    throw new DuckDbOperationError(
      'validation',
      `Unknown DuckDB geometry operation '${operation}'`,
      { field: 'operation' },
    );
  }
  return processNamedGeometryOperation(dataset, opts, spec, resolvedRuntime);
}

export function centroidDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'centroid', opts, runtime);
}

export function envelopeDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'envelope', opts, runtime);
}

export function convexHullDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'convexHull', opts, runtime);
}

export function boundaryDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'boundary', opts, runtime);
}

export function makeValidDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'makeValid', opts, runtime);
}

export function simplifyDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbSimplifyOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'simplify', opts, runtime);
}

export function simplifyPreserveTopologyDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbSimplifyOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(dataset, 'simplifyPreserveTopology', opts, runtime);
}

export function getDuckDbUnaryGeometryOperationSpec(
  operation: DuckDbUnaryGeometryOperationId,
  args: { tolerance?: number } = {},
): DuckDbGeometryOperationSpec | null {
  if (operation === 'simplify') {
    return args.tolerance === undefined
      ? null
      : { id: 'simplify', duckDbFunction: 'ST_Simplify', args: [args.tolerance] };
  }
  if (operation === 'simplifyPreserveTopology') {
    return args.tolerance === undefined
      ? null
      : {
          id: 'simplifyPreserveTopology',
          duckDbFunction: 'ST_SimplifyPreserveTopology',
          args: [args.tolerance],
        };
  }
  return DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS[operation] ?? null;
}
