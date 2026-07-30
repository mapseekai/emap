import type { MapshaperDataset } from '../types/mapshaper-types';

export interface TransactionInternal {
  _captureFirstTouch(sourceId: string, before: MapshaperDataset): void;
}
