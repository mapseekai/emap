import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runUnaryGeometryTool } from '../core/runners/geometry';
import type { ProcessingOptions } from '../core/types';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
/**
 * @example
 * const options: RepairGeometryOptions = { outputLayer: 'repaired' };
 */
export type RepairGeometryOptions = ProcessingOptions;
/**
 * @example
 * const result = await repairGeometry(polygons, { outputLayer: 'repaired' });
 */
export function repairGeometry(
  input: MapshaperDataset,
  options: RepairGeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runUnaryGeometryTool(
    input,
    options,
    { id: 'repairGeometry', duckDbFunction: 'ST_MakeValid' },
    runtime,
  );
}
export const repairGeometryTool = defineDuckDbTool({
  id: 'repairGeometry',
  category: 'dataManagement',
  title: 'Repair Geometry',
  aliases: ['makeValid'],
  description: 'Repair invalid geometries using DuckDB ST_MakeValid.',
  inputs: [
    {
      name: 'input',
      description: 'Features whose geometry should be repaired.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'preserve',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Repair invalid or self-intersecting geometries.',
    whenToUse: [
      'Geometry validation reports invalid features.',
      'Overlay operations fail because of invalid geometry.',
    ],
    keywords: ['repair geometry', 'make valid', 'fix geometry', 'invalid geometry'],
  },
  execute: (c) =>
    repairGeometry(requireToolInput(c, 'input'), toolParams<RepairGeometryOptions>(c), c.runtime),
});
