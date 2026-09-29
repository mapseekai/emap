export const GEOTIFF_WORKER_PROTOCOL_VERSION = 13;
/** Reader state and compressed pages stay reserved independently of decoded blocks. */
export const GEOTIFF_READER_BYTES = 128 * 1024 ** 2;

import type {
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterTextureResult,
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
  noData?: number | null;
  cacheBytes?: number;
  pageLimit?: number;
  maxMetadataBytes?: number;
  statistics?: readonly RasterBandStatistics[];
};
export type GeoTIFFWorkerCommand = { cacheCapacityBytes?: number } & (
  | GeoTIFFWorkerOpen
  | { type: 'configure'; cacheBytes: number }
  | { type: 'read'; request: RasterReadRequest }
  | { type: 'texture'; request: RasterReadRequest }
  | { type: 'render'; request: RasterRenderRequest }
  | { type: 'render-batch'; requests: readonly RasterRenderRequest[] }
);
export type GeoTIFFWorkerRequest =
  | (GeoTIFFWorkerCommand & { id: number })
  | { id: number; type: 'cancel' };
export type GeoTIFFWorkerResponse = { sessionId?: string } & (
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
      nativeDeflateStatus?: RasterNativeDeflateStatus;
    }
  | {
      id: number;
      type: 'rendered';
      result: RasterRenderResult;
      nativeDeflateStatus?: RasterNativeDeflateStatus;
    }
  | {
      id: number;
      type: 'rendered-batch';
      results: readonly RasterRenderResult[];
      nativeDeflateStatus?: RasterNativeDeflateStatus;
    }
  | {
      id: number;
      type: 'texture';
      result: RasterTextureResult;
      nativeDeflateStatus?: RasterNativeDeflateStatus;
    }
  | { id: number; type: 'configured' }
  | { id: number; type: 'error'; code?: string; name: string; message: string }
);
