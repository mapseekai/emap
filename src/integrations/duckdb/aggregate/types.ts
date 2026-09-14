import type { ProcessingOptions } from '../core/types';

/**
 * @example
 * const options: AggregateOptions = { groupBy: ['category'] };
 */
export interface AggregateOptions extends ProcessingOptions {
  groupBy?: readonly string[];
}
