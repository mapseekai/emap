import type { MapshaperDataset } from '../../types/mapshaper-types';
import { isGeographicCrs } from '../../geo/crs-resolver';
import { DuckDbOperationError } from '../errors';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runUnaryGeometryTool } from '../core/runners/geometry';
import type { ProcessingOptions } from '../core/types';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';

export interface BufferOptions extends ProcessingOptions {
  distance: number;
  failOnGeographicCrs?: boolean;
}
export function normalizeBufferOptions(
  dataset: MapshaperDataset,
  options: BufferOptions,
): BufferOptions & { geometryColumn: string; failOnGeographicCrs: boolean } {
  if (!Number.isFinite(options.distance) || options.distance <= 0)
    throw new DuckDbOperationError(
      'validation',
      'DuckDB buffer distance must be a finite number greater than zero',
      { field: 'distance' },
    );
  const failOnGeographicCrs = options.failOnGeographicCrs ?? true;
  if (failOnGeographicCrs && isGeographicCrs(dataset))
    throw new DuckDbOperationError(
      'validation',
      'DuckDB buffer uses coordinate units; reproject to a projected CRS before buffering.',
      { field: 'crs' },
    );
  return { ...options, geometryColumn: options.geometryColumn ?? 'geometry', failOnGeographicCrs };
}
export async function buffer(
  input: MapshaperDataset,
  options: BufferOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  const normalized = normalizeBufferOptions(input, options);
  return runUnaryGeometryTool(
    input,
    normalized,
    { id: 'buffer', duckDbFunction: 'ST_Buffer', args: [normalized.distance] },
    runtime,
  );
}
export const bufferTool = defineDuckDbTool({
  id: 'buffer',
  category: 'proximity',
  title: 'Buffer',
  description: 'Create a buffer polygon around input features.',
  inputs: [
    { name: 'input', description: 'Features to buffer.', required: true, geometry: ['any'] },
  ],
  parameters: [
    {
      name: 'distance',
      description: 'Buffer distance in dataset coordinate units.',
      type: 'number',
      required: true,
      exclusiveMinimum: 0,
    },
  ],
  crs: 'projected',
  units: 'dataset',
  output: {
    geometry: 'derived',
    cardinality: 'preserve',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Create distance-based zones around features.',
    whenToUse: ['Find or visualize areas within a distance of features.'],
    avoidWhen: ['The dataset is geographic and distance should be metric without reprojection.'],
    keywords: ['buffer', 'distance', 'proximity', 'zone'],
  },
  execute: (context) =>
    buffer(requireToolInput(context, 'input'), toolParams<BufferOptions>(context), context.runtime),
});
