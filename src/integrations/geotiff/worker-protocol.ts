import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
} from '../../domain/raster/types';

export type GeoTIFFWorkerRequest =
  | { id: number; type: 'open'; file: File; overviewFile?: File; crs?: string }
  | { id: number; type: 'read'; request: RasterReadRequest }
  | { id: number; type: 'cancel' };
export type GeoTIFFWorkerResponse =
  | { id: number; type: 'metadata'; metadata: RasterMetadata }
  | { id: number; type: 'result'; result: RasterReadResult }
  | { id: number; type: 'error'; code?: string; name: string; message: string };
