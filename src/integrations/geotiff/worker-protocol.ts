export const GEOTIFF_WORKER_PROTOCOL_VERSION = 6;

import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterRenderRequest,
  RasterRenderResult,
  RasterBandStatistics,
  RasterNativeDeflateStatus,
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
  | {
      id: number;
      type: 'result';
      result: RasterReadResult;
      blockAccess?: GeoTIFFWorkerBlockAccess;
      nativeDeflateStatus?: RasterNativeDeflateStatus;
    }
  | {
      id: number;
      type: 'rendered';
      result: RasterRenderResult;
      blockAccess?: GeoTIFFWorkerBlockAccess;
      nativeDeflateStatus?: RasterNativeDeflateStatus;
    }
  | { id: number; type: 'configured' }
  | { id: number; type: 'error'; code?: string; name: string; message: string };
