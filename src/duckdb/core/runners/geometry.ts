import type { MapshaperDataset } from '../../../types/mapshaper-types';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  requireDuckDbRuntime,
  runDuckDbPipeline,
} from '../pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../../runtime';
import { buildUnaryGeometrySql } from '../../geometry/_sql';

export interface DuckDbUnaryGeometryOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}

export interface DuckDbGeometryOperation {
  id: string;
  duckDbFunction: string;
  args?: readonly number[];
}

/** Shared unary-geometry runner used by geometry and proximity tools. */
export async function runUnaryGeometryTool(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions,
  operation: DuckDbGeometryOperation,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const input = datasetToArrowInput(dataset, { layer: opts.layer, geometryColumn }, operation.id);

  return runDuckDbPipeline({
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
