import {
  colorizeRasterTile,
  rasterBands,
  validateRasterStyle,
} from '../../engine/rendering/raster/tile';
import { rasterWarpLocator, validateRasterRender } from '../../engine/rendering/raster/warp';
import { RasterError } from '../../domain/raster/policy';
import type {
  RasterRenderRequest,
  RasterRenderResult,
  RasterSource,
} from '../../domain/raster/types';

/** Runs in the GeoTIFF Worker. Raw samples never cross the UI boundary for display. */
export async function renderRasterWindow(
  source: RasterSource,
  request: RasterRenderRequest,
  signal?: AbortSignal,
): Promise<RasterRenderResult> {
  signal?.throwIfAborted();
  validateRasterRender(source.metadata, request);
  validateRasterStyle(source.metadata, request.style);
  const bands = rasterBands(source.metadata, request.style);
  const needed = [
    ...bands,
    ...(source.metadata.alphaBand === null ? [] : [source.metadata.alphaBand]),
  ];
  if (needed.some((band) => !request.read.samples.includes(band)))
    throw new RasterError('INVALID_BANDS', 'Display request omits a selected color or alpha band.');
  const level = source.metadata.levels.find((value) => value.id === request.read.level)!;
  const data = await source.readWindow(request.read, signal);
  signal?.throwIfAborted();
  const rgba = colorizeRasterTile(
    source.metadata,
    {
      request: request.read,
      warp: request.warp,
      level,
      bands,
      width: request.width,
      height: request.height,
      locate: rasterWarpLocator(request.warp, request.width),
    },
    data,
    request.style,
  );
  signal?.throwIfAborted();
  return { width: request.width, height: request.height, rgba };
}
