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
import {
  areaDatasetWithDuckDb,
  centroidXDatasetWithDuckDb,
  centroidYDatasetWithDuckDb,
  geometryTypeDatasetWithDuckDb,
  isEmptyDatasetWithDuckDb,
  isSimpleDatasetWithDuckDb,
  isValidDatasetWithDuckDb,
  lengthDatasetWithDuckDb,
  perimeterDatasetWithDuckDb,
  xDatasetWithDuckDb,
  yDatasetWithDuckDb,
  type DuckDbAttributeOperationId,
  type DuckDbAttributeOperationOptions,
} from './duckdb-attribute-ops';
import {
  containsAttributeDatasetWithDuckDb,
  containsDatasetWithDuckDb,
  disjointAttributeDatasetWithDuckDb,
  disjointDatasetWithDuckDb,
  distanceDatasetWithDuckDb,
  distanceWithinAttributeDatasetWithDuckDb,
  distanceWithinDatasetWithDuckDb,
  intersectsAttributeDatasetWithDuckDb,
  intersectsDatasetWithDuckDb,
  touchesAttributeDatasetWithDuckDb,
  touchesDatasetWithDuckDb,
  withinAttributeDatasetWithDuckDb,
  withinDatasetWithDuckDb,
  type DuckDbRelationHelperOptions,
  type DuckDbRelationOperationId,
} from './duckdb-relation-ops';
import {
  differenceDatasetWithDuckDb,
  intersectionDatasetWithDuckDb,
  type DuckDbOverlayHelperOptions,
  type DuckDbOverlayOperationId,
} from './duckdb-overlay-ops';
import type { DuckDbRuntime } from './duckdb-runtime';
import type { DuckDbUnaryGeometryOptions } from './duckdb-geometry-op';
import { queryDatasetWithDuckDb, type DuckDbQueryOptions } from './duckdb-query-op';
import {
  queryGeoParquetWithDuckDb,
  type DuckDbGeoParquetQueryOptions,
} from './duckdb-geoparquet-query-op';

export interface DuckDbMapOpSource {
  getBytes?(): Uint8Array | ArrayBuffer | null | undefined;
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
export type DuckDbQueryLayerResult = OpResult<DuckDbLayerSuccess>;
export type DuckDbGeoParquetQueryLayerResult = OpResult<DuckDbLayerSuccess>;

function duckDbErrorToOpResult(err: unknown, operation: string): OpResult<never> {
  if (err instanceof DuckDbOperationError && err.kind === 'validation') {
    return Err.validation(err.field ?? 'duckdb', err.message);
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

export async function duckDbQueryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbQueryLayerOptions,
): Promise<DuckDbQueryLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await queryDatasetWithDuckDb(input.dataset, opts, opts.runtime);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, 'duckdb-query');
  }
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

async function runAttributeOperation(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeLayerOptions,
): Promise<MapshaperDataset> {
  switch (opts.operation) {
    case 'area':
      return areaDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'length':
      return lengthDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'perimeter':
      return perimeterDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'geometryType':
      return geometryTypeDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'isValid':
      return isValidDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'isEmpty':
      return isEmptyDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'isSimple':
      return isSimpleDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'x':
      return xDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'y':
      return yDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'centroidX':
      return centroidXDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    case 'centroidY':
      return centroidYDatasetWithDuckDb(dataset, attributeOptions(opts), opts.runtime);
    default:
      throw new DuckDbOperationError(
        'validation',
        `Unknown DuckDB attribute operation '${opts.operation}'`,
        { field: 'operation' },
      );
  }
}

export async function runRelationOperation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationLayerOptions,
): Promise<MapshaperDataset> {
  const helperOptions = relationOptions(opts);

  switch (opts.mode) {
    case 'filter':
      switch (opts.operation) {
        case 'intersects':
          return intersectsDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'contains':
          return containsDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
        case 'within':
          return withinDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
        case 'touches':
          return touchesDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
        case 'disjoint':
          return disjointDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
        case 'distanceWithin':
          return distanceWithinDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'distance':
          throw new DuckDbOperationError(
            'validation',
            "DuckDB relation operation 'distance' only supports attribute mode",
            { field: 'operation' },
          );
        default:
          throw new DuckDbOperationError(
            'validation',
            `Unknown DuckDB relation operation '${opts.operation}'`,
            { field: 'operation' },
          );
      }
    case 'attribute':
      switch (opts.operation) {
        case 'intersects':
          return intersectsAttributeDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'contains':
          return containsAttributeDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'within':
          return withinAttributeDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'touches':
          return touchesAttributeDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'disjoint':
          return disjointAttributeDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        case 'distance':
          return distanceDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
        case 'distanceWithin':
          return distanceWithinAttributeDatasetWithDuckDb(
            inputDataset,
            maskDataset,
            helperOptions,
            opts.runtime,
          );
        default:
          throw new DuckDbOperationError(
            'validation',
            `Unknown DuckDB relation operation '${opts.operation}'`,
            { field: 'operation' },
          );
      }
    default:
      throw new DuckDbOperationError('validation', `Unknown DuckDB relation mode '${opts.mode}'`, {
        field: 'mode',
      });
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

export async function duckDbRelationLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbRelationLayerOptions,
): Promise<DuckDbRelationLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const mask = readInputDataset(ctx, opts.mask, 'mask');
  if (!mask.ok) return mask.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await runRelationOperation(input.dataset, mask.dataset, opts);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, `duckdb-relation-${opts.operation}`);
  }
}

export async function duckDbAttributeLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbAttributeLayerOptions,
): Promise<DuckDbAttributeLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await runAttributeOperation(input.dataset, opts);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, `duckdb-${opts.operation}`);
  }
}

function readInputBytes(
  ctx: DuckDbMapOpContext,
  src: string,
  field = 'src',
): { ok: true; bytes: Uint8Array | ArrayBuffer } | { ok: false; result: OpResult<never> } {
  const source = ctx.getSource(src);
  if (!source) return { ok: false, result: Err.notFound('source', src) };

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
    const dataset = await queryGeoParquetWithDuckDb(input.bytes, opts, opts.runtime);
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

async function runOverlayOperation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayLayerOptions,
): Promise<MapshaperDataset> {
  const helperOptions = overlayOptions(opts);

  switch (opts.operation) {
    case 'intersection':
      return intersectionDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
    case 'difference':
      return differenceDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
    default:
      throw new DuckDbOperationError(
        'validation',
        `Unsupported DuckDB overlay operation: ${String(opts.operation)}`,
        { field: 'operation' },
      );
  }
}

export async function duckDbOverlayLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbOverlayLayerOptions,
): Promise<DuckDbOverlayLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const mask = readInputDataset(ctx, opts.mask, 'mask');
  if (!mask.ok) return mask.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await runOverlayOperation(input.dataset, mask.dataset, opts);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, `duckdb-${opts.operation}-overlay`);
  }
}
