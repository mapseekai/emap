import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { getDecoder } from 'geotiff';
import {
  canUseNativeDeflate,
  createNativeDeflateDecoder,
  getNativeDeflateCapability,
} from './native-deflate';

type GeoTIFFDecoder = Awaited<ReturnType<typeof getDecoder>>;

const parameters = {
  tileWidth: 4,
  tileHeight: 2,
  planarConfiguration: 1,
  bitsPerSample: [8, 8, 8],
  predictor: 2,
} as const;

function predictor2Encode(input: Uint8Array, width: number, height: number, stride: number) {
  const encoded = input.slice(),
    rowBytes = width * stride;
  for (let row = 0; row < height; row++) {
    const start = row * rowBytes;
    for (let i = rowBytes - 1; i >= stride; i--)
      encoded[start + i] = (encoded[start + i] - encoded[start + i - stride]) & 255;
  }
  return encoded;
}

function fallback(): GeoTIFFDecoder {
  return {
    parameters: {
      tileWidth: parameters.tileWidth,
      tileHeight: parameters.tileHeight,
      planarConfiguration: parameters.planarConfiguration,
      bitsPerSample: [...parameters.bitsPerSample],
      predictor: parameters.predictor,
    },
    decodeBlock: vi.fn(),
    decode: vi.fn(async () => new Uint8Array([99]).buffer),
  } as GeoTIFFDecoder;
}

describe('native DEFLATE decoder', () => {
  it.each([
    8, 32946,
  ])('inflates TIFF DEFLATE code %i and reverses predictor 2 byte-for-byte', async (compression) => {
    const original = Uint8Array.from({ length: 24 }, (_, i) => (i * 17 + 11) & 255),
      predicted = predictor2Encode(original, 4, 2, 3),
      compressed = deflateSync(predicted),
      decoder = createNativeDeflateDecoder(compression, parameters, fallback()),
      result = new Uint8Array(
        await decoder.decode(
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength,
          ),
        ),
      );
    expect(result).toEqual(original);
  });

  it('falls back to the upstream decoder when native streams are unavailable', async () => {
    const upstream = fallback();
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      expect(canUseNativeDeflate(8, parameters)).toBe(false);
      expect(getNativeDeflateCapability(8, parameters)).toMatchObject({
        available: false,
        eligible: false,
        disabledReason: 'decompression-stream-unavailable',
      });
      const decoder = createNativeDeflateDecoder(8, parameters, upstream);
      expect(decoder).toBe(upstream);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports unsupported codecs separately from runtime stream support', () => {
    expect(getNativeDeflateCapability(32946, parameters)).toMatchObject({
      compressionCodes: [32946],
      eligible: true,
      disabledReason: null,
    });
    expect(getNativeDeflateCapability(5, parameters)).toMatchObject({
      compressionCodes: [5],
      eligible: false,
      disabledReason: 'unsupported-compression',
    });
  });
});
