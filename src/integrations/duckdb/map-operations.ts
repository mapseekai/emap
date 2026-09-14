import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { resolveDatasetCRSMetadata } from '../../domain/geo/crs-resolver';
import { Err, okValue, type OpResult } from '../../engine/map/op-result';
import { DuckDbOperationError } from './errors';
import type { DuckDbRuntime } from './runtime';
import { attributeFilter, type AttributeFilterOptions } from './selection/attribute-filter';
import {
  type DuckDbGeoParquetQuerySource,
  queryGeoParquetWithDuckDb,
  type DuckDbGeoParquetQueryOptions,
} from './geoparquet';
import { spatialSummaryJoin, type SpatialSummaryJoinOptions } from './join';
import { difference, intersect, type OverlayOptions } from './overlay';

export interface DuckDbMapOpSource {
  getBytes?(): Uint8Array | ArrayBuffer | null | undefined;
  getDataset(): MapshaperDataset | null | undefined;
  getGeoParquetQuerySource?(): DuckDbGeoParquetQuerySource | null | undefined;
}

/** Reuse one context per source collection so concurrent requests share a commit boundary. */
export interface DuckDbMapOpContext {
  /** Return stable source/dataset references until that source is replaced. */
  getSource(id: string): DuckDbMapOpSource | null | undefined;
  /**
   * Commit synchronously, without starting deferred writes. Async processing happens
   * before this call; the version check and write must be in the same JS turn.
   * `undefined` deliberately excludes async functions (unlike a `void` callback).
   */
  setSourceDataset(id: string, dataset: MapshaperDataset): undefined;
}

export interface DuckDbSpatialSummaryJoinLayerOptions extends SpatialSummaryJoinOptions {
  src: string;
  join: string;
  output: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbAttributeFilterLayerOptions extends AttributeFilterOptions {
  src: string;
  output: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbGeoParquetQueryLayerOptions extends DuckDbGeoParquetQueryOptions {
  src: string;
  output: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export interface DuckDbOverlayLayerOptions {
  src: string;
  mask: string;
  operation: 'intersect' | 'difference' | string;
  inputLayer?: string | number;
  maskLayer?: string | number;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
  outputLayer?: string;
  output: { sourceId: string };
  runtime?: DuckDbRuntime;
}

interface LayerSuccess {
  sourceId: string;
  dataset: MapshaperDataset;
}

export type DuckDbSpatialSummaryJoinLayerResult = OpResult<LayerSuccess>;
export type DuckDbAttributeFilterLayerResult = OpResult<LayerSuccess>;
export type DuckDbGeoParquetQueryLayerResult = OpResult<LayerSuccess>;
export type DuckDbOverlayLayerResult = OpResult<LayerSuccess>;

function errorToOpResult(err: unknown, operation: string): OpResult<never> {
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

// Weak ownership keeps completed contexts collectible; target-local tokens allow
// independent outputs to execute concurrently while making the latest request win.
const pendingOutputs = new WeakMap<DuckDbMapOpContext, Map<string, object>>();

function captureSource(ctx: DuckDbMapOpContext, id: string) {
  const source = ctx.getSource(id) ?? null;
  const dataset = source?.getDataset() ?? null;
  const editVersion = dataset?.editVersion ?? 0;
  const attributeVersion = dataset?.attributeVersion ?? 0;
  const crs = resolveDatasetCRSMetadata(dataset ?? undefined);
  const bytes = source?.getBytes?.() ?? null;
  const querySource = source?.getGeoParquetQuerySource?.() ?? null;
  return {
    id,
    isCurrent: () =>
      (ctx.getSource(id) ?? null) === source &&
      (source?.getDataset() ?? null) === dataset &&
      (dataset?.editVersion ?? 0) === editVersion &&
      (dataset?.attributeVersion ?? 0) === attributeVersion &&
      resolveDatasetCRSMetadata(dataset ?? undefined) === crs &&
      (source?.getBytes?.() ?? null) === bytes &&
      (source?.getGeoParquetQuerySource?.() ?? null) === querySource,
  };
}

async function runSourceOp(
  ctx: DuckDbMapOpContext,
  inputs: readonly string[],
  sourceId: string,
  operation: string,
  run: () => Promise<MapshaperDataset>,
): Promise<OpResult<LayerSuccess>> {
  let outputs = pendingOutputs.get(ctx);
  if (!outputs) {
    outputs = new Map();
    pendingOutputs.set(ctx, outputs);
  }
  const token = {};
  outputs.set(sourceId, token);
  try {
    const snapshots = [...new Set([...inputs, sourceId])].map((id) => captureSource(ctx, id));
    const dataset = await run();
    if (outputs.get(sourceId) !== token) return Err.staleOperation(sourceId, operation);
    for (const snapshot of snapshots) {
      if (!snapshot.isCurrent()) return Err.staleOperation(snapshot.id, operation);
    }
    // No await between validation and mutation: the setter is synchronous by contract.
    ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return errorToOpResult(err, operation);
  } finally {
    if (outputs.get(sourceId) === token) outputs.delete(sourceId);
    if (outputs.size === 0 && pendingOutputs.get(ctx) === outputs) pendingOutputs.delete(ctx);
  }
}

async function runLayerOp(
  ctx: DuckDbMapOpContext,
  opts: { src: string; output: { sourceId: string } },
  errorOperation: string,
  run: (dataset: MapshaperDataset) => Promise<MapshaperDataset>,
): Promise<OpResult<LayerSuccess>> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  return runSourceOp(ctx, [opts.src], sourceId, errorOperation, () => run(input.dataset));
}

async function runBinaryLayerOp(
  ctx: DuckDbMapOpContext,
  opts: { src: string; output: { sourceId: string }; mask?: string; join?: string },
  maskField: 'mask' | 'join',
  errorOperation: string,
  run: (inputDataset: MapshaperDataset, maskDataset: MapshaperDataset) => Promise<MapshaperDataset>,
): Promise<OpResult<LayerSuccess>> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const mask = readInputDataset(ctx, opts[maskField]!, maskField);
  if (!mask.ok) return mask.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  return runSourceOp(ctx, [opts.src, opts[maskField]!], sourceId, errorOperation, () =>
    run(input.dataset, mask.dataset),
  );
}

export function duckDbAttributeFilterLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbAttributeFilterLayerOptions,
): Promise<DuckDbAttributeFilterLayerResult> {
  return runLayerOp(ctx, opts, 'duckdb-attribute-filter', (dataset) =>
    attributeFilter(dataset, opts, opts.runtime),
  );
}

export function duckDbSpatialSummaryJoinLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbSpatialSummaryJoinLayerOptions,
): Promise<DuckDbSpatialSummaryJoinLayerResult> {
  return runBinaryLayerOp(ctx, opts, 'join', 'duckdb-spatial-summary-join', (target, join) =>
    spatialSummaryJoin(target, join, opts, opts.runtime),
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

  return runSourceOp(ctx, [opts.src], sourceId, 'duckdb-geoparquet-query', () =>
    input.querySource
      ? input.querySource.query(opts)
      : queryGeoParquetWithDuckDb(input.bytes, opts, opts.runtime),
  );
}

function overlayOptions(opts: DuckDbOverlayLayerOptions): OverlayOptions {
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
  if (opts.operation === 'intersect' || opts.operation === 'intersection') {
    return intersect(inputDataset, maskDataset, overlayOptions(opts), opts.runtime);
  }
  if (opts.operation === 'difference') {
    return difference(inputDataset, maskDataset, overlayOptions(opts), opts.runtime);
  }
  throw new DuckDbOperationError(
    'validation',
    `Unsupported DuckDB overlay operation: ${opts.operation}`,
    { field: 'operation' },
  );
}

export function duckDbOverlayLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbOverlayLayerOptions,
): Promise<DuckDbOverlayLayerResult> {
  return runBinaryLayerOp(ctx, opts, 'mask', `duckdb-${opts.operation}-overlay`, (input, mask) =>
    runOverlayOperation(input, mask, opts),
  );
}
