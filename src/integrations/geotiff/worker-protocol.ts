import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterRenderRequest,
  RasterRenderResult,
  RasterBandStatistics,
} from '../../domain/raster/types';

export type GeoTIFFWorkerOpen = {
  type: 'open';
  file: File;
  overviewFile?: File;
  crs?: string;
  cacheBytes?: number;
  pageLimit?: number;
  maxMetadataBytes?: number;
  statistics?: readonly RasterBandStatistics[];
};
export type GeoTIFFWorkerCommand =
  | GeoTIFFWorkerOpen
  | { type: 'read'; request: RasterReadRequest }
  | { type: 'render'; request: RasterRenderRequest };
export type GeoTIFFWorkerRequest =
  | (GeoTIFFWorkerCommand & { id: number })
  | { id: number; type: 'cancel' };
export type GeoTIFFWorkerResponse =
  | {
      id: number;
      type: 'metadata';
      metadata: RasterMetadata;
      directoryBytes?: number;
      protocolVersion?: number;
    }
  | { id: number; type: 'result'; result: RasterReadResult }
  | { id: number; type: 'rendered'; result: RasterRenderResult }
  | { id: number; type: 'error'; code?: string; name: string; message: string };
