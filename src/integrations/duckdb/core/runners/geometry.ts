import type { MapshaperDataset } from '../../../../shared/types/mapshaper-types';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  requireRuntime,
  runPipeline,
} from '../pipeline';
import { type DuckDbRuntime } from '../../runtime';
import { buildUnaryGeometrySql } from '../sql/geometry';

export interface UnaryGeometryRunnerOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}

export interface GeometryOperation {
  id: string;
  duckDbFunction: string;
  args?: readonly number[];
}

/** Shared unary-geometry runner used by geometry and proximity tools. */
export async function runUnaryGeometryTool(
  dataset: MapshaperDataset,
  opts: UnaryGeometryRunnerOptions,
  operation: GeometryOperation,
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  const rt = requireRuntime(runtime);
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const input = datasetToArrowInput(dataset, { layer: opts.layer, geometryColumn }, operation.id);

  return runPipeline({
    label: operation.id,
    runtime: rt,
    inputs: [{ table: input, prefix: 'emap_duckdb_geometry_input' }],
    buildSql: ([tableName]) =>
      buildUnaryGeometrySql({
        tableName: tableName!,
        geometryColumn,
        duckDbFunction: operation.duckDbFunction,
        args: operation.args,
      }),
    convertResult: (resultTable) =>
      arrowResultToDataset(resultTable, { layerName: opts.outputLayer }, dataset, operation.id),
  });
}
