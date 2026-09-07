import type { AttributeProcessingOptions } from '../core/types';

export type AttributeOperationId =
  | 'area'
  | 'length'
  | 'perimeter'
  | 'geometryType'
  | 'isValid'
  | 'isEmpty'
  | 'isSimple'
  | 'x'
  | 'y'
  | 'centroidX'
  | 'centroidY';

/**
 * @example
 * const options: AttributeOptions = { outputColumn: 'metric' };
 */
export interface AttributeOptions extends AttributeProcessingOptions {
  failOnGeographicCrs?: boolean;
}
