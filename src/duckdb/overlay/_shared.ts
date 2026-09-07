import type { OverlayOperation } from '../core/runners/overlay';
export type OverlayOperationId = 'intersect' | 'difference';

export const OVERLAY_OPERATIONS: Record<OverlayOperationId, OverlayOperation> = {
  intersect: { id: 'intersect', duckDbFunction: 'ST_Intersection' },
  difference: { id: 'difference', duckDbFunction: 'ST_Difference' },
};
