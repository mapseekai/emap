import { describe, expect, it, vi } from 'vitest';
import { getDecoder, type BaseDecoder } from 'geotiff';
import { canUseFastLzw, createFastLzwDecoder, decodeLzwBlock } from './fast-lzw';

function encodeTiffLzw(input: Uint8Array): Uint8Array {
  const dictionary = new Map<string, number>();
  for (let i = 0; i < 256; i++) dictionary.set(String(i), i);
  let nextCode = 258,
    bits = 9,
    currentByte = 0,
    bitCount = 0;
  const output: number[] = [];
  const write = (code: number) => {
    for (let shift = bits - 1; shift >= 0; shift--) {
      currentByte = (currentByte << 1) | ((code >> shift) & 1);
      if (++bitCount === 8) {
        output.push(currentByte);
        currentByte = 0;
        bitCount = 0;
      }
    }
  };
  write(256);
  if (input.length) {
    let sequence = String(input[0]);
    for (let i = 1; i < input.length; i++) {
      const next = `${sequence},${input[i]}`;
      if (dictionary.has(next)) sequence = next;
      else {
        write(dictionary.get(sequence)!);
        if (nextCode <= 4095) {
          dictionary.set(next, nextCode++);
          if (bits < 12 && nextCode >= 1 << bits) bits++;
        }
        sequence = String(input[i]);
      }
    }
    write(dictionary.get(sequence)!);
  }
  write(257);
  if (bitCount) output.push(currentByte << (8 - bitCount));
  return Uint8Array.from(output);
}

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
