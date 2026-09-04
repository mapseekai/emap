import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './errors';
import {
  processOverlayWithDuckDb,
  type DuckDbOverlayOperationSpec,
  type DuckDbOverlayOptions,
} from './overlay-executor';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';

export type DuckDbOverlayOperationId = 'intersection' | 'difference';

const OVERLAY_OPERATION_SPECS = {
  intersection: {
    id: 'intersection',
    duckDbFunction: 'ST_Intersection',
  },
  difference: {
    id: 'difference',
    duckDbFunction: 'ST_Difference',
  },
} as const satisfies Record<DuckDbOverlayOperationId, DuckDbOverlayOperationSpec>;

export type DuckDbOverlayHelperOptions = DuckDbOverlayOptions;

export function getDuckDbOverlayOperationSpec(operation: string): DuckDbOverlayOperationSpec {
  switch (operation) {
    case 'intersection':
    case 'difference':
      return OVERLAY_OPERATION_SPECS[operation];
    default:
      throw new DuckDbOperationError(
        'validation',
        `Unsupported DuckDB overlay operation: ${operation}`,
        { field: 'operation' },
      );
  }
}

/** @internal Execute a descriptor-backed overlay operation by id. */
export async function runNamedDuckDbOverlayOperation(
  operation: string,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null | undefined = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processOverlayWithDuckDb(
    inputDataset,
    maskDataset,
    opts,
    getDuckDbOverlayOperationSpec(operation),
    runtime === undefined ? getDuckDbRuntime() : runtime,
  );
}

export function intersectionDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbOverlayOperation('intersection', inputDataset, maskDataset, opts, runtime);
}

export function differenceDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runNamedDuckDbOverlayOperation('difference', inputDataset, maskDataset, opts, runtime);
}
