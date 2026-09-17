import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { getDecoder } from 'geotiff';
import { canUseNativeDeflate, createNativeDeflateDecoder } from './native-deflate';

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
  it('inflates and reverses horizontal predictor 2 byte-for-byte', async () => {
    const original = Uint8Array.from({ length: 24 }, (_, i) => (i * 17 + 11) & 255),
      predicted = predictor2Encode(original, 4, 2, 3),
      compressed = deflateSync(predicted),
      decoder = createNativeDeflateDecoder(parameters, fallback()),
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
      expect(canUseNativeDeflate(parameters)).toBe(false);
      const decoder = createNativeDeflateDecoder(parameters, upstream);
      expect(decoder).toBe(upstream);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
