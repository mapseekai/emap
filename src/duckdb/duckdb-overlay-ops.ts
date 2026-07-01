import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import {
  processOverlayWithDuckDb,
  type DuckDbOverlayOperationSpec,
  type DuckDbOverlayOptions,
} from './duckdb-overlay-op';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';

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
      );
  }
}

function runOverlayHelper(
  operation: DuckDbOverlayOperationId,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  return processOverlayWithDuckDb(
    inputDataset,
    maskDataset,
    opts,
    getDuckDbOverlayOperationSpec(operation),
    runtime,
  );
}

export function intersectionDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runOverlayHelper('intersection', inputDataset, maskDataset, opts, runtime);
}

export function differenceDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runOverlayHelper('difference', inputDataset, maskDataset, opts, runtime);
}
