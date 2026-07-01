import type { MapshaperDataset } from '../types/mapshaper-types';
import { isGeographicCrs } from '../geo/crs-resolver';
import { DuckDbOperationError } from './duckdb-errors';
import { processGeometryWithDuckDb, type DuckDbUnaryGeometryOptions } from './duckdb-geometry-op';
import { type DuckDbRuntime, getDuckDbRuntime } from './duckdb-runtime';

export interface DuckDbBufferOptions extends DuckDbUnaryGeometryOptions {
  distance: number;
  failOnGeographicCrs?: boolean;
}

interface NormalizedDuckDbBufferOptions extends DuckDbBufferOptions {
  geometryColumn: string;
  failOnGeographicCrs: boolean;
}

export function normalizeDuckDbBufferOptions(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
): NormalizedDuckDbBufferOptions {
  if (!Number.isFinite(opts.distance) || opts.distance <= 0) {
    throw new DuckDbOperationError(
      'validation',
      'DuckDB buffer distance must be a finite number greater than zero',
      { field: 'distance' },
    );
  }

  const failOnGeographicCrs = opts.failOnGeographicCrs ?? true;
  if (failOnGeographicCrs && isGeographicCrs(dataset)) {
    throw new DuckDbOperationError(
      'validation',
      'DuckDB buffer uses coordinate units; reproject to a projected CRS before buffering.',
      { field: 'crs' },
    );
  }

  return {
    layer: opts.layer,
    distance: opts.distance,
    outputLayer: opts.outputLayer,
    geometryColumn: opts.geometryColumn ?? 'geometry',
    failOnGeographicCrs,
  };
}

export async function bufferDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const normalized = normalizeDuckDbBufferOptions(dataset, opts);
  return processGeometryWithDuckDb(
    dataset,
    normalized,
    {
      id: 'buffer',
      duckDbFunction: 'ST_Buffer',
      args: [normalized.distance],
    },
    runtime,
  );
}

export default bufferDatasetWithDuckDb;
