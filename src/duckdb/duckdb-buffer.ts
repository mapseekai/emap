import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';

export interface DuckDbBufferOptions {
  layer?: string | number;
  distance: number;
  outputLayer?: string;
  geometryColumn?: string;
  failOnGeographicCrs?: boolean;
}

export interface NormalizedDuckDbBufferOptions {
  layer?: string | number;
  distance: number;
  outputLayer?: string;
  geometryColumn: string;
  failOnGeographicCrs: boolean;
}

export function normalizeDuckDbBufferOptions(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
): NormalizedDuckDbBufferOptions {
  if (!Number.isFinite(opts.distance) || opts.distance <= 0) {
    throw new DuckDbOperationError('validation', 'DuckDB buffer distance must be a finite number greater than zero', {
      field: 'distance',
    });
  }

  const failOnGeographicCrs = opts.failOnGeographicCrs ?? true;
  const crs = dataset.info?.crs_string?.trim().toUpperCase();
  if (failOnGeographicCrs && (crs === 'EPSG:4326' || crs === 'OGC:CRS84')) {
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
