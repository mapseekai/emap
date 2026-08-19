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

export function centroidDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedGeometryOperation(
    dataset,
    opts,
    DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS.centroid,
    runtime,
  );
}

export function envelopeDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedGeometryOperation(
    dataset,
    opts,
    DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS.envelope,
    runtime,
  );
}

export function convexHullDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedGeometryOperation(
    dataset,
    opts,
    DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS.convexHull,
    runtime,
  );
}

export function boundaryDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedGeometryOperation(
    dataset,
    opts,
    DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS.boundary,
    runtime,
  );
}

export function makeValidDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedGeometryOperation(
    dataset,
    opts,
    DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS.makeValid,
    runtime,
  );
}

export async function simplifyDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbSimplifyOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const normalized = normalizeSimplifyOptions(dataset, opts, 'simplify');
  return processGeometryWithDuckDb(
    dataset,
    normalized,
    {
      id: 'simplify',
      duckDbFunction: 'ST_Simplify',
      args: [normalized.tolerance],
    },
    runtime,
  );
}

export async function simplifyPreserveTopologyDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbSimplifyOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const normalized = normalizeSimplifyOptions(dataset, opts, 'simplifyPreserveTopology');
  return processGeometryWithDuckDb(
    dataset,
    normalized,
    {
      id: 'simplifyPreserveTopology',
      duckDbFunction: 'ST_SimplifyPreserveTopology',
      args: [normalized.tolerance],
    },
    runtime,
  );
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
