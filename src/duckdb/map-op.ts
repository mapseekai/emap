import type { MapshaperDataset } from '../types/mapshaper-types';
import { Err, okValue, type OpResult } from '../map/op-result';
import { DuckDbOperationError } from './duckdb-errors';
import bufferDatasetWithDuckDb, { type DuckDbBufferOptions } from './duckdb-buffer';
import {
  boundaryDatasetWithDuckDb,
  centroidDatasetWithDuckDb,
  convexHullDatasetWithDuckDb,
  envelopeDatasetWithDuckDb,
  makeValidDatasetWithDuckDb,
  simplifyDatasetWithDuckDb,
  simplifyPreserveTopologyDatasetWithDuckDb,
  type DuckDbSimplifyOptions,
  type DuckDbUnaryGeometryOperationId,
} from './duckdb-spatial-ops';
import type { DuckDbRuntime } from './duckdb-runtime';
import type { DuckDbUnaryGeometryOptions } from './duckdb-geometry-op';

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

export interface DuckDbGeometryLayerOptions extends DuckDbUnaryGeometryOptions {
  src: string;
  operation: DuckDbUnaryGeometryOperationId | string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
  tolerance?: number;
  failOnGeographicCrs?: boolean;
}

interface DuckDbLayerSuccess {
  sourceId: string;
  dataset: MapshaperDataset;
}

export type DuckDbBufferLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbGeometryLayerResult = OpResult<DuckDbLayerSuccess>;

function duckDbErrorToOpResult(err: unknown, operation: string): OpResult<never> {
  if (err instanceof DuckDbOperationError && err.kind === 'validation') {
    return Err.validation(err.field ?? 'duckdb', err.message);
  }
  return Err.mapshaper(err, { operation });
}

function readInputDataset(
  ctx: DuckDbMapOpContext,
  src: string,
): { ok: true; dataset: MapshaperDataset } | { ok: false; result: OpResult<never> } {
  const source = ctx.getSource(src);
  if (!source) return { ok: false, result: Err.notFound('source', src) };

  const dataset = source.getDataset();
  if (!dataset) {
    return {
      ok: false,
      result: Err.validation('src', `Source '${src}' does not have a loaded dataset`),
    };
  }

  return { ok: true, dataset };
}

function outputSourceId(output: { sourceId: string } | undefined): string | OpResult<never> {
  if (!output?.sourceId) {
    return Err.validation('output.sourceId', 'DuckDB operation requires output.sourceId');
  }
  return output.sourceId;
}

export async function duckDbBufferLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbBufferLayerOptions,
): Promise<DuckDbBufferLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await bufferDatasetWithDuckDb(input.dataset, opts, opts.runtime);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, 'duckdb-buffer');
  }
}

function geometryOptions(opts: DuckDbGeometryLayerOptions): DuckDbUnaryGeometryOptions {
  return {
    layer: opts.layer,
    outputLayer: opts.outputLayer,
    geometryColumn: opts.geometryColumn,
  };
}

async function runGeometryOperation(
  dataset: MapshaperDataset,
  opts: DuckDbGeometryLayerOptions,
): Promise<MapshaperDataset> {
  switch (opts.operation) {
    case 'centroid':
      return centroidDatasetWithDuckDb(dataset, geometryOptions(opts), opts.runtime);
    case 'envelope':
      return envelopeDatasetWithDuckDb(dataset, geometryOptions(opts), opts.runtime);
    case 'convexHull':
      return convexHullDatasetWithDuckDb(dataset, geometryOptions(opts), opts.runtime);
    case 'boundary':
      return boundaryDatasetWithDuckDb(dataset, geometryOptions(opts), opts.runtime);
    case 'makeValid':
      return makeValidDatasetWithDuckDb(dataset, geometryOptions(opts), opts.runtime);
    case 'simplify':
      return simplifyDatasetWithDuckDb(
        dataset,
        {
          ...geometryOptions(opts),
          tolerance: opts.tolerance as number,
          failOnGeographicCrs: opts.failOnGeographicCrs,
        } satisfies DuckDbSimplifyOptions,
        opts.runtime,
      );
    case 'simplifyPreserveTopology':
      return simplifyPreserveTopologyDatasetWithDuckDb(
        dataset,
        {
          ...geometryOptions(opts),
          tolerance: opts.tolerance as number,
          failOnGeographicCrs: opts.failOnGeographicCrs,
        } satisfies DuckDbSimplifyOptions,
        opts.runtime,
      );
    default:
      throw new DuckDbOperationError(
        'validation',
        `Unknown DuckDB geometry operation '${opts.operation}'`,
        { field: 'operation' },
      );
  }
}

export async function duckDbGeometryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbGeometryLayerOptions,
): Promise<DuckDbGeometryLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await runGeometryOperation(input.dataset, opts);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, `duckdb-${opts.operation}`);
  }
}
