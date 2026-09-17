/** @module geotiff */
export { openGeoTIFF, openGeoTIFFHandle } from './source';
export { geoTIFFPlugin } from './plugin';
export { rasterPlugin } from '../../runtime/plugins/raster/plugin';
export { RasterError, RASTER_PYRAMID_THRESHOLD } from '../../domain/raster/policy';
export type { OpenGeoTIFFOptions } from './source';
export type { GeoTIFFPluginOptions, GeoTIFFAddOptions, GeoTIFFContract } from './plugin';
export type { RasterRenderOptions } from '../../engine/rendering/raster/service';
export type {
  RasterSource,
  RasterMetadata,
  RasterBandStatistics,
  RasterLevel,
  RasterWindow,
  RasterRenderRequest,
  RasterRenderResult,
  RasterTaskDiagnostics,
  RasterWarpMesh,
  RasterProcessingStats,
  RasterReadRequest,
  RasterReadResult,
  RasterSamples,
  RasterReference,
  RasterStyle,
} from '../../domain/raster/types';
export type {
  RasterContract,
  RasterLayerInfo,
  RasterLayerReference,
  RasterCacheStats,
  RasterPerformanceTotals,
} from '../../runtime/services/contracts/raster';
