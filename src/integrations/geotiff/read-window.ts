import { getDecoder, type GeoTIFFImage } from 'geotiff';
import type { RasterReadRequest, RasterReadResult, RasterSamples } from '../../domain/raster/types';
import { createFastLzwDecoder } from './fast-lzw';
import { createNativeDeflateDecoder } from './native-deflate';

const NATIVE_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
let deinterleaveMs = 0;

export function getReadWindowDiagnostics() {
  return { deinterleaveMs };
}

/** True only when readNumericWindow uses the explicitly bounded four-block pipeline. */
export function supportsBoundedNumericWindow(image: GeoTIFFImage): boolean {
  const bits = image.getBitsPerSample(),
    format = image.getSampleFormat(),
    compression = image.getFileDirectory().getValue('Compression') ?? 1;
  return (
    [1, 5, 8, 32946, 32773].includes(compression) &&
    !(bits > 8 && image.littleEndian !== NATIVE_LITTLE_ENDIAN) &&
    !(format === 3 && bits === 16) &&
    [8, 16, 32, 64].includes(bits) &&
    !Array.from({ length: image.getSamplesPerPixel() }, (_, i) => i).some(
      (i) => image.getBitsPerSample(i) !== bits || image.getSampleFormat(i) !== format,
    )
  );
}

interface WindowBlockGrid {
  readonly x0: number;
  readonly y0: number;
  readonly columns: number;
  readonly count: number;
}

function windowBlockGrid(
  image: GeoTIFFImage,
  window: RasterReadRequest['window'],
  perTile: number,
): WindowBlockGrid {
  const tw = image.getTileWidth(),
    th = image.getTileHeight(),
    x0 = Math.floor(window[0] / tw),
    x1 = Math.ceil(window[2] / tw),
    y0 = Math.floor(window[1] / th),
    y1 = Math.ceil(window[3] / th),
    columns = x1 - x0;
  return { x0, y0, columns, count: columns * (y1 - y0) * perTile };
}

async function runBoundedBlocks(
  count: number,
  signal: AbortSignal | undefined,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0,
    failed = false;
  const run = async () => {
    while (next < count && !failed) {
      signal?.throwIfAborted();
      const index = next++;
      await task(index);
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(4, count) }, async () => {
      try {
        await run();
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  );
  const rejected = settled.find((result) => result.status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
  signal?.throwIfAborted();
}

async function windowDecoder(image: GeoTIFFImage) {
  const directory = image.getFileDirectory(),
    compression = directory.getValue('Compression') ?? 1,
    parameters = {
      tileWidth: image.getTileWidth(),
      tileHeight: image.getTileHeight(),
      planarConfiguration: image.planarConfiguration,
      bitsPerSample: Array.from({ length: image.getSamplesPerPixel() }, (_, i) =>
        image.getBitsPerSample(i),
      ),
      predictor: (await directory.loadValue('Predictor')) || 1,
    },
    upstream = await getDecoder(compression, parameters);
  return {
    decoder:
      compression === 5
        ? createFastLzwDecoder(compression, parameters, upstream)
        : compression === 8 || compression === 32946
          ? createNativeDeflateDecoder(compression, parameters, upstream)
          : upstream,
    compression,
  };
}

/** Assemble validated numeric windows through public geotiff APIs. The narrow
 * codec fast path delegates decoding and prediction upstream; special codecs,
 * non-native endianness, Float16 and mixed sample formats retain readRasters().
 */
export async function readNumericWindow(
  image: GeoTIFFImage,
  request: RasterReadRequest,
  signal?: AbortSignal,
): Promise<RasterReadResult> {
  signal?.throwIfAborted();
  const { window, samples } = request;
  const w = window[2] - window[0],
    h = window[3] - window[1];
  if (!supportsBoundedNumericWindow(image)) {
    const result = await image.readRasters({
      window: [...window],
      samples: [...samples],
      interleave: false,
      signal,
    });
    return {
      width: result.width,
      height: result.height,
      data: Array.from(result) as RasterSamples[],
    };
  }
  const { decoder } = await windowDecoder(image);
  signal?.throwIfAborted();
  const output = samples.map((sample) => image.getArrayForSample(sample, w * h)),
    tw = image.getTileWidth(),
    th = image.getTileHeight(),
    bands = image.getSamplesPerPixel(),
    perTile = image.planarConfiguration === 2 ? samples.length : 1,
    grid = windowBlockGrid(image, window, perTile);
  await runBoundedBlocks(grid.count, signal, async (index) => {
    const tileIndex = Math.floor(index / perTile),
      bandIndex = index % perTile,
      x = grid.x0 + (tileIndex % grid.columns),
      y = grid.y0 + Math.floor(tileIndex / grid.columns),
      tile = await image.getTileOrStrip(
        x,
        y,
        image.planarConfiguration === 1 ? 0 : samples[bandIndex],
        decoder,
        signal,
      );
    signal?.throwIfAborted();
    const input = image.getArrayForSample(0, tile.data),
      left = Math.max(window[0], x * tw),
      right = Math.min(window[2], (x + 1) * tw, image.getWidth()),
      top = Math.max(window[1], y * th),
      bottom = Math.min(window[3], y * th + image.getBlockHeight(y), image.getHeight()),
      stride = image.planarConfiguration === 2 ? 1 : bands;
    if (input.length < image.getBlockHeight(y) * tw * stride)
      throw new Error('Truncated decoded TIFF block.');
    for (let row = top; row < bottom; row++) {
      const source = (row - y * th) * tw + left - x * tw,
        target = (row - window[1]) * w + left - window[0],
        length = right - left;
      if (image.planarConfiguration === 2) {
        output[bandIndex].set(input.subarray(source, source + length), target);
      } else if (bands === 1) {
        output[0].set(input.subarray(source, source + length), target);
      } else {
        const deinterleaveStarted = performance.now();
        for (let si = 0; si < samples.length; si++) {
          const destination = output[si],
            sample = samples[si];
          for (let col = 0; col < length; col++)
            destination[target + col] = input[(source + col) * bands + sample];
        }
        deinterleaveMs += performance.now() - deinterleaveStarted;
      }
    }
  });
  return { width: w, height: h, data: output };
}

export interface InterleavedRgb8Window {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

/** Assemble a chunky UInt8 RGB source window without deinterleaving three planes. */
export async function readInterleavedRgb8Window(
  image: GeoTIFFImage,
  request: RasterReadRequest,
  signal?: AbortSignal,
): Promise<InterleavedRgb8Window> {
  signal?.throwIfAborted();
  if (
    image.planarConfiguration !== 1 ||
    image.getSamplesPerPixel() !== 3 ||
    [0, 1, 2].some(
      (band) => image.getBitsPerSample(band) !== 8 || image.getSampleFormat(band) !== 1,
    )
  )
    throw new Error('Interleaved RGB8 fast path requires chunky UInt8 RGB samples.');
  const { window } = request,
    width = window[2] - window[0],
    height = window[3] - window[1],
    output = new Uint8Array(width * height * 3),
    { decoder } = await windowDecoder(image),
    tw = image.getTileWidth(),
    th = image.getTileHeight(),
    grid = windowBlockGrid(image, window, 1);
  await runBoundedBlocks(grid.count, signal, async (index) => {
    const x = grid.x0 + (index % grid.columns),
      y = grid.y0 + Math.floor(index / grid.columns),
      tile = await image.getTileOrStrip(x, y, 0, decoder, signal);
    signal?.throwIfAborted();
    const input = new Uint8Array(tile.data),
      left = Math.max(window[0], x * tw),
      right = Math.min(window[2], (x + 1) * tw, image.getWidth()),
      top = Math.max(window[1], y * th),
      bottom = Math.min(window[3], y * th + image.getBlockHeight(y), image.getHeight());
    if (input.length < image.getBlockHeight(y) * tw * 3)
      throw new Error('Truncated decoded TIFF block.');
    for (let row = top; row < bottom; row++) {
      const sourcePixel = (row - y * th) * tw + left - x * tw,
        targetPixel = (row - window[1]) * width + left - window[0],
        pixels = right - left;
      output.set(input.subarray(sourcePixel * 3, (sourcePixel + pixels) * 3), targetPixel * 3);
    }
  });
  return { width, height, data: output };
}
