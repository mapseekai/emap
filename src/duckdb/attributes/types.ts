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

export interface AttributeOptions extends AttributeProcessingOptions {
  failOnGeographicCrs?: boolean;
}
