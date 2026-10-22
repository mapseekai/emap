export interface OverlayOptions {
  signal?: AbortSignal;
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
}
