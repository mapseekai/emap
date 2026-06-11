import type { MapshaperDataset } from '../types/mapshaper-types';
import { Err, okValue, type OpResult } from '../map/op-result';
import { DuckDbOperationError } from './duckdb-errors';
import { bufferDatasetWithDuckDb, type DuckDbBufferOptions } from './duckdb-buffer';
import type { DuckDbRuntime } from './duckdb-runtime';

export interface DuckDbMapOpSource {
  getDataset(): MapshaperDataset | null | undefined;
}

export interface DuckDbMapOpContext {
  getSource(id: string): DuckDbMapOpSource | null | undefined;
  setSourceDataset(id: string, dataset: MapshaperDataset): void | Promise<void>;
}

export interface DuckDbBufferLayerOptions extends DuckDbBufferOptions {
  src: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbBufferLayerSuccess {
  sourceId: string;
  dataset: MapshaperDataset;
}

export type DuckDbBufferLayerResult = OpResult<DuckDbBufferLayerSuccess>;

function duckDbErrorToOpResult(err: unknown): OpResult<never> {
  if (err instanceof DuckDbOperationError && err.kind === 'validation') {
    return Err.validation(err.field ?? 'duckdb', err.message);
  }
  return Err.mapshaper(err, { operation: 'duckdb-buffer' });
}

export async function duckDbBufferLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbBufferLayerOptions,
): Promise<DuckDbBufferLayerResult> {
  const source = ctx.getSource(opts.src);
  if (!source) return Err.notFound('source', opts.src);

  const dataset = source.getDataset();
  if (!dataset) return Err.validation('src', `Source '${opts.src}' does not have a loaded dataset`);

  const outputSourceId = opts.output?.sourceId;
  if (!outputSourceId) return Err.validation('output.sourceId', 'is required');

  const { runtime, src: _src, output: _output, ...bufferOptions } = opts;

  try {
    const result = await bufferDatasetWithDuckDb(dataset, bufferOptions, runtime);
    await ctx.setSourceDataset(outputSourceId, result);
    return okValue({ sourceId: outputSourceId, dataset: result });
  } catch (err) {
    return duckDbErrorToOpResult(err);
  }
}
