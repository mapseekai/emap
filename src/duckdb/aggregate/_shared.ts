import type { DuckDbProcessingGeometryOptions } from '../core/runners/processing';

export interface AggregateOptions extends DuckDbProcessingGeometryOptions {
  groupBy?: readonly string[];
}
