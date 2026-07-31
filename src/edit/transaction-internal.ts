import type { MapshaperDataset } from '../types/mapshaper-types';

export interface TransactionInternal {
  readonly isOpen: boolean;
  _captureFirstTouch(sourceId: string, before: MapshaperDataset): void;
  _trackOperation(operation: Promise<unknown>): void;
}
