import type { ProcessingOptions } from '../core/types';

export interface AggregateOptions extends ProcessingOptions {
  groupBy?: readonly string[];
}
