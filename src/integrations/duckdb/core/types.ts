export interface ProcessingOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}

export interface AttributeProcessingOptions extends ProcessingOptions {
  outputColumn?: string;
}

export interface BinaryRelationOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
  outputColumn?: string;
}
