import type { RasterLevel, RasterReadRequest, RasterWindow } from './types';

/** Hard policy: intentionally not an import option or bypass flag. */
export const RASTER_PYRAMID_THRESHOLD = 2 * 1024 ** 3;
export const RASTER_MAX_WINDOW_PIXELS = 4 * 1024 ** 2;
export const RASTER_MAX_DECODE_BYTES = 64 * 1024 ** 2;

export class RasterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'RasterError';
  }
}

export function isRasterOverview(base: RasterLevel, candidate: RasterLevel): boolean {
  // TIFF NewSubfileType: bit 0 = reduced resolution, bit 1 = page, bit 2 = mask.
  if (!(candidate.subfileType & 1) || candidate.subfileType & 6) return false;
  if (
    candidate.width > base.width ||
    candidate.height > base.height ||
    (candidate.width === base.width && candidate.height === base.height)
  )
    return false;
  if (candidate.width < 1 || candidate.height < 1) return false;
  const ratio = Math.min(base.width / candidate.width, base.height / candidate.height);
  if (
    Math.abs(base.width / ratio - candidate.width) > 1 ||
    Math.abs(base.height / ratio - candidate.height) > 1
  )
    return false;
  return (
    candidate.samples === base.samples &&
    // readRasters preserves raw bands: three-band MINISBLACK and RGB need no
    // colorspace conversion. The TIFF reader separately rejects alpha changes.
    (candidate.photometric === base.photometric ||
      (base.samples === 3 &&
        [1, 2].includes(base.photometric) &&
        [1, 2].includes(candidate.photometric))) &&
    candidate.bits.every((bit, i) => bit === base.bits[i]) &&
    candidate.bits.length === base.bits.length &&
    candidate.formats.every((format, i) => format === base.formats[i]) &&
    candidate.formats.length === base.formats.length
  );
}

export function assertRasterPyramid(fileSize: number, levels: readonly RasterLevel[]): void {
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || !levels.length)
    throw new RasterError('INVALID_RASTER', 'Invalid file size or missing base image.');
  if (
    fileSize > RASTER_PYRAMID_THRESHOLD &&
    !levels.slice(1).some((level) => isRasterOverview(levels[0], level))
  ) {
    throw new RasterError(
      'PYRAMID_REQUIRED',
      '原始栅格超过 2GiB（2,147,483,648 字节）且没有有效金字塔。必须先创建内部金字塔，或创建并关联同名 .ovr 文件，再重新加载；不能跳过。',
    );
  }
}

export function validateRasterWindow(
  level: RasterLevel,
  window: RasterWindow,
  samples: readonly number[],
): void {
  const [left, top, right, bottom] = window;
  if (
    window.some((value) => !Number.isSafeInteger(value)) ||
    left < 0 ||
    top < 0 ||
    right > level.width ||
    bottom > level.height ||
    right <= left ||
    bottom <= top
  ) {
    throw new RasterError(
      'INVALID_WINDOW',
      'Read window must contain integral pixels inside the source image.',
    );
  }
  if (
    !samples.length ||
    new Set(samples).size !== samples.length ||
    samples.some((sample) => !Number.isInteger(sample) || sample < 0 || sample >= level.samples)
  ) {
    throw new RasterError(
      'INVALID_BANDS',
      'Bands must be distinct zero-based source sample indices.',
    );
  }
  const pixels = (right - left) * (bottom - top);
  const sampleBytes = (band: number) =>
    level.formats[band] === 3 && level.bits[band] === 16
      ? 4
      : Math.max(1, Math.ceil(level.bits[band] / 8));
  const bytesPerPixel = level.bits.reduce((sum, _bits, band) => sum + sampleBytes(band), 0);
  const blockColumns = Math.ceil(right / level.tileWidth) - Math.floor(left / level.tileWidth);
  const blockRows = Math.ceil(bottom / level.tileHeight) - Math.floor(top / level.tileHeight);
  const decodedBlocks =
    blockColumns * blockRows * level.tileWidth * level.tileHeight * bytesPerPixel;
  // Account for all source bands in chunky compressed blocks, the assembled window,
  // and a conservative temporary decode copy. A small output is not a small read.
  const budget =
    2 * decodedBlocks + pixels * samples.reduce((sum, band) => sum + sampleBytes(band), 0);
  if (
    !Number.isSafeInteger(budget) ||
    pixels > RASTER_MAX_WINDOW_PIXELS ||
    budget > RASTER_MAX_DECODE_BYTES
  ) {
    throw new RasterError(
      'RASTER_READ_BUDGET',
      '源窗口或压缩块解码超出内存预算。请创建更完整的金字塔或转换为分块 TIFF 后重试。',
    );
  }
}

export function validateRasterRead(
  levels: readonly RasterLevel[],
  request: RasterReadRequest,
): RasterLevel {
  const level = levels.find((item) => item.id === request.level);
  if (!level) throw new RasterError('INVALID_LEVEL', 'Unknown or non-overview TIFF image.');
  validateRasterWindow(level, request.window, request.samples);
  return level;
}
