import type { MapshaperDataset } from '../../types/mapshaper-types';
import { isGeographicCrs } from '../../geo/crs-resolver';
import { DuckDbOperationError } from '../errors';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runUnaryGeometryTool } from '../core/runners/geometry';
import type { ProcessingOptions } from '../core/types';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';

/**
 * @example
 * const options: SimplifyOptions = { tolerance: 2 };
 */
export interface SimplifyOptions extends ProcessingOptions {
  tolerance: number;
  failOnGeographicCrs?: boolean;
}
function normalize(input: MapshaperDataset, options: SimplifyOptions) {
  if (!Number.isFinite(options.tolerance) || options.tolerance < 0)
    throw new DuckDbOperationError(
      'validation',
      'DuckDB simplify tolerance must be a finite number greater than or equal to zero',
      { field: 'tolerance' },
    );
  const failOnGeographicCrs = options.failOnGeographicCrs ?? true;
  if (failOnGeographicCrs && isGeographicCrs(input))
    throw new DuckDbOperationError(
      'validation',
      'DuckDB simplify uses coordinate units; reproject to a projected CRS before simplifying.',
      { field: 'crs' },
    );
  return { ...options, geometryColumn: options.geometryColumn ?? 'geometry', failOnGeographicCrs };
}
/**
 * @example
 * const result = await simplify(lines, { tolerance: 2 });
 */
export async function simplify(
  input: MapshaperDataset,
  options: SimplifyOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  const normalized = normalize(input, options);
  return runUnaryGeometryTool(
    input,
    normalized,
    {
      id: 'simplify',
      duckDbFunction: 'ST_Simplify',
      args: [normalized.tolerance],
    },
    runtime,
  );
}
/**
 * @example
 * const result = await simplifyPreserveTopology(polygons, { tolerance: 2 });
 */
export async function simplifyPreserveTopology(
  input: MapshaperDataset,
  options: SimplifyOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  const normalized = normalize(input, options);
  return runUnaryGeometryTool(
    input,
    normalized,
    {
      id: 'simplifyPreserveTopology',
      duckDbFunction: 'ST_SimplifyPreserveTopology',
      args: [normalized.tolerance],
    },
    runtime,
  );
}
export const simplifyTool = defineDuckDbTool({
  id: 'simplify',
  category: 'geometry',
  title: 'Simplify',
  description: 'Reduce geometry vertices using a tolerance.',
  inputs: [
    {
      name: 'input',
      description: 'Input line or polygon features.',
      required: true,
      geometry: ['polyline', 'polygon'],
    },
  ],
  parameters: [
    {
      name: 'tolerance',
      description: 'Simplification tolerance in dataset units.',
      type: 'number',
      required: true,
      minimum: 0,
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
    summary: 'Reduce vertex count while preserving overall shape.',
    whenToUse: ['Generalize detailed geometry for display or analysis.'],
    keywords: ['simplify', 'generalize', 'reduce vertices', 'topology'],
  },
  execute: (c) => simplify(requireToolInput(c, 'input'), toolParams<SimplifyOptions>(c), c.runtime),
});
export const simplifyPreserveTopologyTool = defineDuckDbTool({
  ...simplifyTool,
  id: 'simplifyPreserveTopology',
  title: 'Simplify Preserve Topology',
  description: 'Reduce geometry vertices while preserving topology.',
  aliases: ['simplify-topology'],
  parameters: [
    {
      name: 'tolerance',
      description: 'Simplification tolerance in dataset units.',
      type: 'number',
      required: true,
      minimum: 0,
    },
  ],
  agent: {
    summary: 'Simplify geometry while protecting topological relationships.',
    whenToUse: ['Generalize polygon or line geometry when topology must be preserved.'],
    keywords: ['simplify preserve topology', 'topology simplification', 'generalize'],
  },
  execute: (c) =>
    simplifyPreserveTopology(
      requireToolInput(c, 'input'),
      toolParams<SimplifyOptions>(c),
      c.runtime,
    ),
});
