import { encodeTiffLzw } from '../../../test/utils/tiff-lzw';
import { describe, expect, it, vi } from 'vitest';
import { getDecoder, type BaseDecoder } from 'geotiff';
import { canUseFastLzw, createFastLzwDecoder, decodeLzwBlock } from './fast-lzw';

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

const parameters = {
  tileWidth: 64,
  tileHeight: 16,
  planarConfiguration: 1,
  bitsPerSample: [8, 8, 8],
  predictor: 1,
} as const;

describe('allocation-light TIFF LZW decoder', () => {
  it('keeps the bounded JS fallback correct after filling the 12-bit dictionary', () => {
    let seed = 19;
    const raw = Uint8Array.from({ length: 16384 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    });
    const compressed = encodeTiffLzw(raw);
    expect(new Uint8Array(decodeLzwBlock(compressed.buffer, raw.length))).toEqual(raw);
  });

  it.each([16, 32] as const)('preserves %i-bit samples and planar Predictor 2', async (bits) => {
    for (const planarConfiguration of [1, 2]) {
      const ArrayType = bits === 16 ? Uint16Array : Uint32Array;
      const stride = planarConfiguration === 2 ? 1 : 3;
      const original = ArrayType.from({ length: 64 * 16 * stride }, (_, i) => i * 173 + 7);
      const predicted = original.slice();
      for (let row = 0; row < 16; row++)
        for (let index = 64 * stride - 1; index >= stride; index--)
          predicted[row * 64 * stride + index] -= predicted[row * 64 * stride + index - stride];
      const params = {
        ...parameters,
        bitsPerSample: [bits, bits, bits],
        predictor: 2,
        planarConfiguration,
      };
      const upstream = await getDecoder(5, params);
      const decoder = createFastLzwDecoder(5, params, upstream);
      const compressed = encodeTiffLzw(new Uint8Array(predicted.buffer));
      expect(new Uint8Array(await decoder.decode(compressed.buffer))).toEqual(
        new Uint8Array(original.buffer),
      );
    }
  });

  it('matches upstream through dictionary code-width transitions', async () => {
    const original = Uint8Array.from({ length: 64 * 16 * 3 }, (_, i) => (i * 73 + (i >> 3)) & 255),
      compressed = encodeTiffLzw(original),
      upstream = await getDecoder(5, parameters),
      expected = new Uint8Array(await upstream.decodeBlock(compressed.buffer)),
      actual = new Uint8Array(decodeLzwBlock(compressed.buffer, original.length));
    expect(expected).toEqual(original);
    expect(actual).toEqual(expected);
  });

  it('reverses horizontal predictor 2 byte-for-byte', async () => {
    const predictorParameters = { ...parameters, predictor: 2 as const },
      original = Uint8Array.from({ length: 64 * 16 * 3 }, (_, i) => (i * 19 + 7) & 255),
      compressed = encodeTiffLzw(predictor2Encode(original, 64, 16, 3)),
      fallback = (await getDecoder(5, predictorParameters)) as BaseDecoder,
      decoder = createFastLzwDecoder(5, predictorParameters, fallback),
      actual = new Uint8Array(await decoder.decode(compressed.buffer));
    expect(actual).toEqual(original);
  });

  it('rejects decoded output larger than the declared TIFF block without unsafe fallback', async () => {
    const upstream = await getDecoder(5, parameters),
      decode = vi.spyOn(upstream, 'decode'),
      decoder = createFastLzwDecoder(5, parameters, upstream),
      compressed = encodeTiffLzw(
        new Uint8Array(parameters.tileWidth * parameters.tileHeight * 3 + 1),
      );
    await expect(decoder.decode(compressed.buffer)).rejects.toThrow(/exceeds decoded size/);
    expect(decode).not.toHaveBeenCalled();
  });

  it('keeps unsupported layouts on the upstream decoder', async () => {
    const fallback = await getDecoder(5, parameters);
    expect(canUseFastLzw(8, parameters)).toBe(false);
    expect(createFastLzwDecoder(8, parameters, fallback)).toBe(fallback);
    expect(createFastLzwDecoder(5, { ...parameters, predictor: 3 }, fallback)).toBe(fallback);
    const decode = vi.spyOn(fallback, 'decode');
    await fallback.decode(
      encodeTiffLzw(new Uint8Array(parameters.tileWidth * parameters.tileHeight * 3)).buffer,
    );
    expect(decode).toHaveBeenCalledOnce();
  });
});
