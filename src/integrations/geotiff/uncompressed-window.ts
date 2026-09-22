import type { GeoTIFFImage } from 'geotiff';
import type { RasterReadRequest, RasterReadResult } from '../../domain/raster/types';
import { RasterError } from '../../domain/raster/policy';
import { LocalRasterFileSource } from './file-source';

const timings = { assemblyMs: 0, directReadMs: 0 };
export function getUncompressedWindowTimings() {
  return { ...timings };
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** Narrow, lossless fast path. Unsupported codecs/layouts retain normal block decoding. */
export async function readUncompressedStripWindow(
  image: GeoTIFFImage,
  request: RasterReadRequest,
  signal?: AbortSignal,
): Promise<RasterReadResult | null> {
  signal?.throwIfAborted();
  const started = performance.now();
  let assemblyMs = 0;
  const source = image.source,
    fd = image.getFileDirectory(),
    bits = image.getBitsPerSample();
  const bands = image.getSamplesPerPixel();
  if (
    !(source instanceof LocalRasterFileSource) ||
    image.isTiled ||
    image.planarConfiguration !== 1 ||
    (fd.getValue('Compression') ?? 1) !== 1 ||
    ![8, 16, 32].includes(bits) ||
    (bits > 8 && image.littleEndian !== LITTLE_ENDIAN) ||
    Array.from({ length: bands }, (_, i) => i).some(
      (i) => image.getBitsPerSample(i) !== bits || image.getSampleFormat(i) !== 1,
    ) ||
    !fd.hasTag('StripOffsets') ||
    !fd.hasTag('StripByteCounts')
  )
    return null;
  if (((await fd.loadValue('Predictor')) ?? 1) !== 1) return null;
  signal?.throwIfAborted();
  const [x0, y0, x1, y1] = request.window;
  const width = x1 - x0,
    height = y1 - y0;
  // Full-width windows already have efficient, cached full-strip reads.
  if (width === image.getWidth()) return null;
  if (
    ![x0, y0, x1, y1].every(Number.isSafeInteger) ||
    x0 < 0 ||
    y0 < 0 ||
    width < 1 ||
    height < 1 ||
    x1 > image.getWidth() ||
    y1 > image.getHeight() ||
    !request.samples.length ||
    request.samples.some((b) => !Number.isInteger(b) || b < 0 || b >= bands)
  )
    throw new RasterError('INVALID_RASTER_WINDOW', 'Invalid direct strip window.');
  const offsets = await fd.loadValue('StripOffsets'),
    counts = await fd.loadValue('StripByteCounts');
  signal?.throwIfAborted();
  const rowsPerStrip = image.getTileHeight(),
    bytesPerPixel = (bands * bits) / 8;
  const rowBytes = width * bytesPerPixel;
  // Keep output and gathered input bounded independently of physical strip width.
  if (width * height * bytesPerPixel > 32 * 1024 ** 2) return null;
  for (let strip = Math.floor(y0 / rowsPerStrip); strip < Math.ceil(y1 / rowsPerStrip); strip++) {
    const offset = Number(offsets?.[strip]),
      count = Number(counts?.[strip]);
    // Sparse/implicit-zero blocks retain upstream semantics, not a guessed byte offset.
    if (offset === 0 || count === 0) return null;
    const stripBytes = image.getBlockHeight(strip) * image.getWidth() * bytesPerPixel;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(count) ||
      offset < 0 ||
      count < stripBytes ||
      !Number.isSafeInteger(offset + count) ||
      offset + count > source.fileSize
    )
      throw new RasterError('TRUNCATED_TIFF_RANGE', 'Invalid uncompressed strip bounds.');
  }
  const output = request.samples.map((b) => image.getArrayForSample(b, width * height));
  const rowsPerBatch = Math.max(1, Math.min(256, Math.floor((4 * 1024 ** 2) / rowBytes)));
  for (let row = 0; row < height; row += rowsPerBatch) {
    signal?.throwIfAborted();
    const batch = Array.from({ length: Math.min(rowsPerBatch, height - row) }, (_, i) => {
      const y = y0 + row + i,
        strip = Math.floor(y / rowsPerStrip);
      return {
        offset:
          Number(offsets![strip]) + ((y % rowsPerStrip) * image.getWidth() + x0) * bytesPerPixel,
        length: rowBytes,
      };
    });
    const bytes = await source.fetchPackedRanges(batch, signal);
    const input = image.getArrayForSample(0, bytes),
      pixels = batch.length * width;
    const assembled = performance.now();
    for (let b = 0; b < request.samples.length; b++) {
      const band = request.samples[b],
        target = output[b];
      for (let i = 0; i < pixels; i++) target[row * width + i] = input[i * bands + band];
    }
    assemblyMs += performance.now() - assembled;
  }
  signal?.throwIfAborted();
  timings.assemblyMs += assemblyMs;
  timings.directReadMs += Math.max(0, performance.now() - started - assemblyMs);
  return { width, height, data: output };
}
