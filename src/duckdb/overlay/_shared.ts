import type { DuckDbOverlayOperation, DuckDbOverlayOptions } from '../core/runners/overlay';

export type OverlayOptions = DuckDbOverlayOptions;
export type OverlayOperationId = 'intersect' | 'difference';

export const OVERLAY_OPERATIONS: Record<OverlayOperationId, DuckDbOverlayOperation> = {
  intersect: { id: 'intersect', duckDbFunction: 'ST_Intersection' },
  difference: { id: 'difference', duckDbFunction: 'ST_Difference' },
};
