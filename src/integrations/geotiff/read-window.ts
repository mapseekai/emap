import { getDecoder, type GeoTIFFImage } from 'geotiff';
import type { RasterReadRequest, RasterReadResult, RasterSamples } from '../../domain/raster/types';
import { createNativeDeflateDecoder } from './native-deflate';

const NATIVE_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

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
  const bits = image.getBitsPerSample(),
    format = image.getSampleFormat();
  const directory = image.getFileDirectory(),
    compression = directory.getValue('Compression') ?? 1;
  const w = window[2] - window[0],
    h = window[3] - window[1];
  if (
    ![1, 5, 8, 32946, 32773].includes(compression) ||
    (bits > 8 && image.littleEndian !== NATIVE_LITTLE_ENDIAN) ||
    (format === 3 && bits === 16) ||
    ![8, 16, 32, 64].includes(bits) ||
    Array.from({ length: image.getSamplesPerPixel() }, (_, i) => i).some(
      (i) => image.getBitsPerSample(i) !== bits || image.getSampleFormat(i) !== format,
    )
  ) {
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
  const decoderParameters = {
      tileWidth: image.getTileWidth(),
      tileHeight: image.getTileHeight(),
      planarConfiguration: image.planarConfiguration,
      bitsPerSample: Array.from({ length: image.getSamplesPerPixel() }, (_, i) =>
        image.getBitsPerSample(i),
      ),
      predictor: (await directory.loadValue('Predictor')) || 1,
    },
    upstreamDecoder = await getDecoder(compression, decoderParameters),
    decoder =
      compression === 8
        ? createNativeDeflateDecoder(decoderParameters, upstreamDecoder)
        : upstreamDecoder;
  signal?.throwIfAborted();
  const output = samples.map((sample) => image.getArrayForSample(sample, w * h));
  const tw = image.getTileWidth(),
    th = image.getTileHeight(),
    bands = image.getSamplesPerPixel();
  const x0 = Math.floor(window[0] / tw),
    x1 = Math.ceil(window[2] / tw),
    y0 = Math.floor(window[1] / th),
    y1 = Math.ceil(window[3] / th);
  const perTile = image.planarConfiguration === 2 ? samples.length : 1;
  const columns = x1 - x0,
    count = columns * (y1 - y0) * perTile;
  let next = 0,
    failed = false;
  const run = async () => {
    while (next < count && !failed) {
      signal?.throwIfAborted();
      const index = next++,
        tileIndex = Math.floor(index / perTile),
        bandIndex = index % perTile;
      const x = x0 + (tileIndex % columns),
        y = y0 + Math.floor(tileIndex / columns);
      const tile = await image.getTileOrStrip(
        x,
        y,
        image.planarConfiguration === 1 ? 0 : samples[bandIndex],
        decoder,
        signal,
      );
      signal?.throwIfAborted();
      const input = image.getArrayForSample(0, tile.data);
      const left = Math.max(window[0], x * tw),
        right = Math.min(window[2], (x + 1) * tw, image.getWidth());
      const top = Math.max(window[1], y * th),
        bottom = Math.min(window[3], y * th + image.getBlockHeight(y), image.getHeight());
      const stride = image.planarConfiguration === 2 ? 1 : bands;
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
          for (let si = 0; si < samples.length; si++) {
            const destination = output[si],
              sample = samples[si];
            for (let col = 0; col < length; col++)
              destination[target + col] = input[(source + col) * bands + sample];
          }
        }
      }
    }
  };
  // A bounded block pipeline replaces per-pixel DataView.call and unbounded fanout.
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
  return { width: w, height: h, data: output };
}
