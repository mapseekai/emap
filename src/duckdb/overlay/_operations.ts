import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import type { DuckDbOverlayOperation } from '../core/runners/overlay';
import { difference } from './difference';
import { intersect } from './intersect';
import type { OverlayOptions } from './_shared';

export type DuckDbOverlayOperationId = 'intersection' | 'difference';
export type { OverlayOptions } from './_shared';

export function getDuckDbOverlayOperation(operationId: string): DuckDbOverlayOperation {
  if (operationId === 'intersection') {
    return { id: 'intersection', duckDbFunction: 'ST_Intersection' };
  }
  if (operationId === 'difference') {
    return { id: 'difference', duckDbFunction: 'ST_Difference' };
  }
  throw new DuckDbOperationError(
    'validation',
    `Unsupported DuckDB overlay operation: ${operationId}`,
    { field: 'operation' },
  );
}

export function runNamedDuckDbOverlayOperation(
  operationId: string,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: OverlayOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (operationId === 'intersection') {
    return intersect(inputDataset, maskDataset, opts, runtime);
  }
  if (operationId === 'difference') {
    return difference(inputDataset, maskDataset, opts, runtime);
  }
  getDuckDbOverlayOperation(operationId);
  throw new Error('unreachable');
}
