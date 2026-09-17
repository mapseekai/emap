export const GEOTIFF_WORKER_PROTOCOL_VERSION = 4;

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
  | { type: 'configure'; cacheBytes: number }
  | { type: 'read'; request: RasterReadRequest }
  | { type: 'render'; request: RasterRenderRequest };
export type GeoTIFFWorkerRequest =
  | (GeoTIFFWorkerCommand & { id: number })
  | { id: number; type: 'cancel' };
export interface GeoTIFFWorkerBlockAccess {
  readonly requested: readonly string[];
  readonly loaded: readonly string[];
}
export type GeoTIFFWorkerResponse =
  | {
      id: number;
      type: 'metadata';
      metadata: RasterMetadata;
      directoryBytes?: number;
      protocolVersion?: number;
    }
  | { id: number; type: 'result'; result: RasterReadResult; blockAccess?: GeoTIFFWorkerBlockAccess }
  | {
      id: number;
      type: 'rendered';
      result: RasterRenderResult;
      blockAccess?: GeoTIFFWorkerBlockAccess;
    }
  | { id: number; type: 'configured' }
  | { id: number; type: 'error'; code?: string; name: string; message: string };
