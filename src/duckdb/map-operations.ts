import type { MapshaperDataset } from '../types/mapshaper-types';
import { Err, okValue, type OpResult } from '../map/op-result';
import { DuckDbOperationError } from './errors';
import { bufferDatasetWithDuckDb, type DuckDbBufferOptions } from './buffer';
import {
  runNamedDuckDbGeometryOperation,
  type DuckDbUnaryGeometryOperationId,
} from './geometry-registry';
import {
  runNamedDuckDbAttributeOperation,
  type DuckDbAttributeOperationId,
  type DuckDbAttributeOperationOptions,
} from './attribute-registry';
import {
  runNamedDuckDbRelationOperation,
  type DuckDbRelationHelperOptions,
  type DuckDbRelationOperationId,
} from './relation-registry';
import {
  runNamedDuckDbOverlayOperation,
  type DuckDbOverlayHelperOptions,
  type DuckDbOverlayOperationId,
} from './overlay-registry';
import type { DuckDbRuntime } from './runtime';
import type { DuckDbUnaryGeometryOptions } from './geometry-executor';
import { queryDatasetWithDuckDb, type DuckDbQueryOptions } from './query-executor';
import {
  type DuckDbGeoParquetQuerySource,
  queryGeoParquetWithDuckDb,
  type DuckDbGeoParquetQueryOptions,
} from './geoparquet-query';
import {
  spatialAggregateJoinDatasetWithDuckDb,
  type DuckDbSpatialAggregateJoinOptions,
} from './spatial-aggregate-join';

export interface DuckDbMapOpSource {
  getBytes?(): Uint8Array | ArrayBuffer | null | undefined;
  getDataset(): MapshaperDataset | null | undefined;
  getGeoParquetQuerySource?(): DuckDbGeoParquetQuerySource | null | undefined;
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

export interface DuckDbAttributeLayerOptions extends DuckDbAttributeOperationOptions {
  src: string;
  operation: DuckDbAttributeOperationId | string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbRelationLayerOptions extends DuckDbRelationHelperOptions {
  src: string;
  mask: string;
  mode: 'filter' | 'attribute' | string;
  operation: DuckDbRelationOperationId | string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbSpatialAggregateJoinLayerOptions extends DuckDbSpatialAggregateJoinOptions {
  src: string;
  join: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbQueryLayerOptions extends DuckDbQueryOptions {
  src: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbGeoParquetQueryLayerOptions extends DuckDbGeoParquetQueryOptions {
  src: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

interface DuckDbLayerSuccess {
  sourceId: string;
  dataset: MapshaperDataset;
}

export type DuckDbBufferLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbGeometryLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbAttributeLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbRelationLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbSpatialAggregateJoinLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbQueryLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbGeoParquetQueryLayerResult = OpResult<DuckDbLayerSuccess>;

function duckDbErrorToOpResult(err: unknown, operation: string): OpResult<never> {
  if (err instanceof DuckDbOperationError) {
    return Err.duckdb(operation, err.kind, err.message, {
      ...(err.field === undefined ? {} : { field: err.field }),
      ...(err.cause === undefined ? {} : { cause: err.cause }),
    });
  }
  return Err.mapshaper(err, { operation });
}

function readInputDataset(
  ctx: DuckDbMapOpContext,
  src: string,
  field = 'src',
): { ok: true; dataset: MapshaperDataset } | { ok: false; result: OpResult<never> } {
  const source = ctx.getSource(src);
  if (!source) return { ok: false, result: Err.notFound('source', src) };

  const dataset = source.getDataset();
  if (!dataset) {
    return {
      ok: false,
      result: Err.validation(field, `Source '${src}' does not have a loaded dataset`),
    };
  }

  return { ok: true, dataset };
}

function outputSourceId(output: { sourceId: string } | undefined): string | OpResult<never> {
  const sourceId = output?.sourceId;
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    return Err.validation('output.sourceId', 'DuckDB operation requires output.sourceId');
  }
  return sourceId;
}

async function runDuckDbLayerOp(
  ctx: DuckDbMapOpContext,
  opts: { src: string; output?: { sourceId: string } },
  errorOperation: string,
  run: (dataset: MapshaperDataset) => Promise<MapshaperDataset>,
): Promise<OpResult<DuckDbLayerSuccess>> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await run(input.dataset);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, errorOperation);
  }
}

async function runDuckDbBinaryLayerOp(
  ctx: DuckDbMapOpContext,
  opts: { src: string; output?: { sourceId: string }; mask?: string; join?: string },
  maskField: 'mask' | 'join',
  errorOperation: string,
  run: (inputDataset: MapshaperDataset, maskDataset: MapshaperDataset) => Promise<MapshaperDataset>,
): Promise<OpResult<DuckDbLayerSuccess>> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const mask = readInputDataset(ctx, opts[maskField]!, maskField);
  if (!mask.ok) return mask.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await run(input.dataset, mask.dataset);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, errorOperation);
  }
}

export function duckDbBufferLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbBufferLayerOptions,
): Promise<DuckDbBufferLayerResult> {
  return runDuckDbLayerOp(ctx, opts, 'duckdb-buffer', (dataset) =>
    bufferDatasetWithDuckDb(dataset, opts, opts.runtime),
  );
}

export function duckDbQueryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbQueryLayerOptions,
): Promise<DuckDbQueryLayerResult> {
  return runDuckDbLayerOp(ctx, opts, 'duckdb-query', (dataset) =>
    queryDatasetWithDuckDb(dataset, opts, opts.runtime),
  );
}

function geometryOptions(opts: DuckDbGeometryLayerOptions): DuckDbUnaryGeometryOptions {
  return {
    layer: opts.layer,
    outputLayer: opts.outputLayer,
    geometryColumn: opts.geometryColumn,
  };
}

function attributeOptions(opts: DuckDbAttributeLayerOptions): DuckDbAttributeOperationOptions {
  return {
    layer: opts.layer,
    outputLayer: opts.outputLayer,
    geometryColumn: opts.geometryColumn,
    outputColumn: opts.outputColumn,
    failOnGeographicCrs: opts.failOnGeographicCrs,
  };
}

function relationOptions(opts: DuckDbRelationLayerOptions): DuckDbRelationHelperOptions {
  return {
    inputLayer: opts.inputLayer,
    maskLayer: opts.maskLayer,
    outputLayer: opts.outputLayer,
    inputGeometryColumn: opts.inputGeometryColumn,
    maskGeometryColumn: opts.maskGeometryColumn,
    outputColumn: opts.outputColumn,
    distance: opts.distance,
    failOnGeographicCrs: opts.failOnGeographicCrs,
  };
}

function runGeometryOperation(
  dataset: MapshaperDataset,
  opts: DuckDbGeometryLayerOptions,
): Promise<MapshaperDataset> {
  return runNamedDuckDbGeometryOperation(
    dataset,
    opts.operation,
    {
      ...geometryOptions(opts),
      tolerance: opts.tolerance,
      failOnGeographicCrs: opts.failOnGeographicCrs,
    },
    opts.runtime,
  );
}

function runAttributeOperation(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeLayerOptions,
): Promise<MapshaperDataset> {
  return runNamedDuckDbAttributeOperation(
    dataset,
    opts.operation,
    attributeOptions(opts),
    opts.runtime,
  );
}

export function runRelationOperation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationLayerOptions,
): Promise<MapshaperDataset> {
  return runNamedDuckDbRelationOperation(
    opts.mode,
    opts.operation,
    inputDataset,
    maskDataset,
    relationOptions(opts),
    opts.runtime,
  );
}

export function duckDbGeometryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbGeometryLayerOptions,
): Promise<DuckDbGeometryLayerResult> {
  return runDuckDbLayerOp(ctx, opts, `duckdb-${opts.operation}`, (dataset) =>
    runGeometryOperation(dataset, opts),
  );
}

export function duckDbRelationLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbRelationLayerOptions,
): Promise<DuckDbRelationLayerResult> {
  return runDuckDbBinaryLayerOp(
    ctx,
    opts,
    'mask',
    `duckdb-relation-${opts.operation}`,
    (input, mask) => runRelationOperation(input, mask, opts),
  );
}

export function duckDbSpatialAggregateJoinLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbSpatialAggregateJoinLayerOptions,
): Promise<DuckDbSpatialAggregateJoinLayerResult> {
  return runDuckDbBinaryLayerOp(
    ctx,
    opts,
    'join',
    'duckdb-spatial-aggregate-join',
    (target, join) => spatialAggregateJoinDatasetWithDuckDb(target, join, opts, opts.runtime),
  );
}

export function duckDbAttributeLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbAttributeLayerOptions,
): Promise<DuckDbAttributeLayerResult> {
  return runDuckDbLayerOp(ctx, opts, `duckdb-${opts.operation}`, (dataset) =>
    runAttributeOperation(dataset, opts),
  );
}

function readInputBytes(
  ctx: DuckDbMapOpContext,
  src: string,
  field = 'src',
):
  | { ok: true; bytes: Uint8Array | ArrayBuffer; querySource?: undefined }
  | { ok: true; bytes?: undefined; querySource: DuckDbGeoParquetQuerySource }
  | { ok: false; result: OpResult<never> } {
  const source = ctx.getSource(src);
  if (!source) return { ok: false, result: Err.notFound('source', src) };

  const querySource = source.getGeoParquetQuerySource?.();
  if (querySource) return { ok: true, querySource };

  const bytes = source.getBytes?.();
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    return {
      ok: false,
      result: Err.validation(field, `Source '${src}' does not expose GeoParquet bytes`),
    };
  }

  return { ok: true, bytes };
}

export async function duckDbGeoParquetQueryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbGeoParquetQueryLayerOptions,
): Promise<DuckDbGeoParquetQueryLayerResult> {
  const input = readInputBytes(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = input.querySource
      ? await input.querySource.query(opts)
      : await queryGeoParquetWithDuckDb(input.bytes, opts, opts.runtime);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, 'duckdb-geoparquet-query');
  }
}

export interface DuckDbOverlayLayerOptions {
  src: string;
  mask: string;
  operation: DuckDbOverlayOperationId | string;
  inputLayer?: string | number;
  maskLayer?: string | number;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
  outputLayer?: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export type DuckDbOverlayLayerResult = OpResult<DuckDbLayerSuccess>;

function overlayOptions(opts: DuckDbOverlayLayerOptions): DuckDbOverlayHelperOptions {
  return {
    inputLayer: opts.inputLayer,
    maskLayer: opts.maskLayer,
    outputLayer: opts.outputLayer,
    inputGeometryColumn: opts.inputGeometryColumn,
    maskGeometryColumn: opts.maskGeometryColumn,
  };
}

function runOverlayOperation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayLayerOptions,
): Promise<MapshaperDataset> {
  return runNamedDuckDbOverlayOperation(
    opts.operation,
    inputDataset,
    maskDataset,
    overlayOptions(opts),
    opts.runtime,
  );
}

export function duckDbOverlayLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbOverlayLayerOptions,
): Promise<DuckDbOverlayLayerResult> {
  return runDuckDbBinaryLayerOp(
    ctx,
    opts,
    'mask',
    `duckdb-${opts.operation}-overlay`,
    (input, mask) => runOverlayOperation(input, mask, opts),
  );
}
