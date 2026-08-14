import type { MapshaperDataset } from '../types/mapshaper-types';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  requireDuckDbRuntime,
  runDuckDbPipeline,
} from './duckdb-pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { buildUnaryGeometrySql } from './duckdb-sql';

export interface DuckDbUnaryGeometryOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}

export interface DuckDbGeometryOperationSpec {
  id: string;
  duckDbFunction: string;
  args?: readonly number[];
}

export async function processGeometryWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbUnaryGeometryOptions,
  spec: DuckDbGeometryOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);

  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const input = datasetToArrowInput(dataset, { layer: opts.layer, geometryColumn }, spec.id);

  return runDuckDbPipeline({
    label: spec.id,
    runtime: rt,
    inputs: [{ table: input, prefix: 'emap_duckdb_geometry_input' }],
    buildSql: ([tableName]) =>
      buildUnaryGeometrySql({
        tableName: tableName!,
        geometryColumn,
        duckDbFunction: spec.duckDbFunction,
        args: spec.args,
      }),
    convertResult: (resultTable) =>
      arrowResultToDataset(resultTable, { layerName: opts.outputLayer }, dataset, spec.id),
  });
}
