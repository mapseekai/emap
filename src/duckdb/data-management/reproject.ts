import type { MapshaperDataset } from '../../types/mapshaper-types';
import { resolveDatasetCRSMetadata, setDatasetCrsMetadata } from '../../geo/crs-resolver';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { processingValidation, runSingleInputTool, sqlString } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
export interface ReprojectOptions extends ProcessingOptions {
  sourceCrs?: string;
  targetCrs: string;
  alwaysXY?: boolean;
}
export async function reproject(
  input: MapshaperDataset,
  options: ReprojectOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  const sourceCrs = options.sourceCrs ?? resolveDatasetCRSMetadata(input);
  if (!sourceCrs) throw processingValidation('reproject', 'source CRS is required', 'sourceCrs');
  if (!options.targetCrs?.trim())
    throw processingValidation('reproject', 'target CRS is required', 'targetCrs');
  const result = await runSingleInputTool(
    input,
    'reproject',
    options,
    (tableName, geometryColumn) => {
      const table = quoteIdentifier(tableName);
      const geom = quoteIdentifier(geometryColumn);
      return `SELECT\n  * EXCLUDE (${geom}),\n  ST_AsWKB(ST_Transform(${geom}, ${sqlString(sourceCrs)}, ${sqlString(options.targetCrs)}, ${options.alwaysXY === false ? 'false' : 'true'})) AS ${geom}\nFROM ${table}\nWHERE ${geom} IS NOT NULL`;
    },
    runtime,
  );
  setDatasetCrsMetadata(result, options.targetCrs);
  return result;
}
export const reprojectTool = defineDuckDbTool({
  id: 'reproject',
  category: 'dataManagement',
  title: 'Reproject',
  description: 'Transform coordinates from a source CRS to a target CRS.',
  inputs: [
    { name: 'input', description: 'Dataset to reproject.', required: true, geometry: ['any'] },
  ],
  parameters: [
    {
      name: 'sourceCrs',
      description: 'Source CRS when not available in dataset metadata.',
      type: 'string',
    },
    { name: 'targetCrs', description: 'Destination CRS.', type: 'string', required: true },
    {
      name: 'alwaysXY',
      description: 'Use longitude/easting as X and latitude/northing as Y.',
      type: 'boolean',
      default: true,
    },
  ],
  crs: 'known',
  units: 'none',
  output: {
    geometry: 'derived',
    cardinality: 'preserve',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Transform a dataset into another coordinate reference system.',
    whenToUse: [
      'Prepare geographic data for metric distance or area analysis.',
      'Match CRS between layers.',
    ],
    keywords: ['reproject', 'transform crs', 'projection', 'epsg'],
  },
  execute: (c) =>
    reproject(requireToolInput(c, 'input'), toolParams<ReprojectOptions>(c), c.runtime),
});
