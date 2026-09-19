import { describe, expect, it, vi } from 'vitest';
import { decodeWasmLzw, validatedLzwLength } from './wasm-lzw';
import { encodeTiffLzw } from '../../../test/utils/tiff-lzw';

const lengths = () => new Uint16Array(4096).fill(1, 0, 256);
const zero = new Uint8Array([0x80, 0, 0x20, 0x20]);

describe('bounded WASM TIFF LZW', () => {
  it.each([
    'constant',
    'pattern',
    'random',
  ] as const)('decodes %s data with owned output', async (pattern) => {
    let seed = 19;
    const raw = Uint8Array.from({ length: 16384 }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return pattern === 'constant'
        ? 17
        : pattern === 'pattern'
          ? (i * 73 + (i >> 3)) & 255
          : seed >>> 24;
    });
    const compressed = encodeTiffLzw(raw);
    const scratch = lengths();
    expect(validatedLzwLength(compressed, raw.length, scratch)).toBe(raw.length);
    const decoded = await decodeWasmLzw(compressed.buffer, raw.length, scratch);
    expect(decoded).not.toBeNull();
    expect(new Uint8Array(decoded!)).toEqual(raw);
    const another = await decodeWasmLzw(zero.buffer, 1, scratch);
    expect(new Uint8Array(another!)).toEqual(new Uint8Array([0]));
    expect(new Uint8Array(decoded!)).toEqual(raw);
  });

  it('accepts a shorter final strip while bounding the decoded block', async () => {
    const decoded = await decodeWasmLzw(zero.buffer, 4096, lengths());
    expect(decoded?.byteLength).toBe(1);
    await expect(decodeWasmLzw(zero.buffer, 0, lengths())).rejects.toThrow(/exceeds decoded size/);
  });

  it.each([
    new Uint8Array(),
    new Uint8Array([0x80, 0]),
    new Uint8Array([0xff, 0xff]),
  ])('rejects incomplete or invalid streams before WASM', async (input) => {
    expect(() => validatedLzwLength(input, 1024, lengths())).toThrow(/Truncated|Invalid/);
    await expect(decodeWasmLzw(input.buffer, 1024, lengths())).rejects.toThrow(/Truncated|Invalid/);
  });

  it('does not retain a large compressed payload in the WASM heap', async () => {
    const padded = new Uint8Array(4 * 1024 ** 2 + 1);
    padded.set(zero);
    expect(await decodeWasmLzw(padded.buffer, 1, lengths())).toBeNull();
  });

  it('caches initialization failure so the caller can use its bounded JS decoder', async () => {
    vi.resetModules();
    const fail = vi.fn(() => {
      throw new Error('WASM blocked');
    });
    vi.doMock('@developmentseed/lzw-tiff-decoder', () => ({ decompress: fail }));
    try {
      const isolated = await import('./wasm-lzw');
      expect(await isolated.decodeWasmLzw(zero.buffer, 1, lengths())).toBeNull();
      expect(await isolated.decodeWasmLzw(zero.buffer, 1, lengths())).toBeNull();
      expect(fail).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('@developmentseed/lzw-tiff-decoder');
      vi.resetModules();
    }
  });
});
