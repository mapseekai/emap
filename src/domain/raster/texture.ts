import { RasterError, validateRasterWindow } from './policy';
import type { RasterLevel, RasterReadRequest } from './types';

/** Preserve raw UInt8/UInt16 channels; account for the packed output in addition
 * to the ordinary conservative decode reservation. No change to readWindow(). */
export function validateRasterTextureRead(level: RasterLevel, request: RasterReadRequest): number {
  const bits = level.bits[0];
  if (
    level.samples < 1 ||
    level.samples > 4 ||
    ![8, 16].includes(bits) ||
    level.bits.some((b) => b !== bits) ||
    level.formats.some((f) => f !== 1) ||
    request.samples.length !== level.samples ||
    request.samples.some((b, i) => b !== i)
  )
    throw new RasterError(
      'UNSUPPORTED_SAMPLES',
      'Texture reads require all homogeneous UInt8/UInt16 bands in source order.',
    );
  const bytes = validateRasterWindow(level, request.window, request.samples);
  const pixels = (request.window[2] - request.window[0]) * (request.window[3] - request.window[1]);
  if ((pixels * 4 * bits) / 8 > 8 * 1024 ** 2)
    throw new RasterError('RASTER_READ_BUDGET', 'Packed texture output exceeds 8 MiB.');
  return bytes + (pixels * 4 * bits) / 8;
}
