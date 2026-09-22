import { describe, expect, it, vi } from 'vitest';
import { fromArrayBuffer } from 'geotiff';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';
import { readNumericWindow, readTextureWindow, supportsBoundedNumericWindow } from './read-window';

async function image(options: Parameters<typeof makeRasterFixture>[0] = {}) {
  const bytes = makeRasterFixture(options);
  return (await fromArrayBuffer(bytes.buffer as ArrayBuffer)).getImage();
}
describe('native numeric window assembly', () => {
  it('advertises bounded block concurrency only for the native numeric pipeline', async () => {
    const bounded = await image({ bits: 16, bands: 3, compression: 'deflate' });
    expect(supportsBoundedNumericWindow(bounded)).toBe(true);
    const fallback = await image({ bits: 16, sampleFormat: 3, bands: 1, compression: 'deflate' });
    expect(supportsBoundedNumericWindow(fallback)).toBe(false);
  });
  it.each([
    [8, 1],
    [8, 2],
    [16, 1],
    [16, 2],
    [32, 1],
    [32, 2],
    [32, 3],
    [64, 3],
  ] as const)('matches upstream for %i-bit sample format %i and nonaligned band order', async (bits, sampleFormat) => {
    const input = await image({
      bits,
      sampleFormat,
      bands: 3,
      width: 9,
      height: 7,
      compression: 'deflate',
      pixelValue: (x, y, b) => b * 25 + x * 3 + y,
    });
    const request = { level: 0, window: [1, 2, 8, 6] as const, samples: [2, 0] };
    const expected = await input.readRasters({
      window: [...request.window],
      samples: [...request.samples],
      interleave: false,
    });
    const actual = await readNumericWindow(input, request);
    expect(actual.width).toBe(7);
    expect(actual.height).toBe(4);
    expect(actual.data).toEqual(Array.from(expected));
  });
  it('decodes TIFF Compression 32946 through the same DEFLATE fast path', async () => {
    const input = await image({
      width: 9,
      height: 7,
      bands: 3,
      compression: 'deflate-old',
      pixelValue: (x, y, b) => b * 30 + x * 2 + y,
    });
    const request = { level: 0, window: [1, 1, 8, 6] as const, samples: [0, 2] };
    const expected = await input.readRasters({
      window: [...request.window],
      samples: [...request.samples],
      interleave: false,
    });
    const actual = await readNumericWindow(input, request);
    expect(actual.data).toEqual(Array.from(expected));
  });
  it('copies the selected nonzero band from planar data, not band zero', async () => {
    const input = await image({ bits: 16, bands: 3 });
    input.planarConfiguration = 2;
    const tile = vi.spyOn(input, 'getTileOrStrip').mockImplementation(async (x, y, sample) => ({
      x,
      y,
      sample,
      data: Uint16Array.from({ length: 64 }, (_, i) => sample * 100 + i).buffer,
    }));
    const actual = await readNumericWindow(input, { level: 0, window: [2, 1, 6, 3], samples: [2] });
    expect(Array.from(actual.data[0])).toEqual([210, 211, 212, 213, 218, 219, 220, 221]);
    expect(tile.mock.calls.every((call) => call[2] === 2)).toBe(true);
  });
  it('delegates Float16 and non-native-endian data to the supported upstream reader', async () => {
    for (const options of [
      { bits: 16 as const, sampleFormat: 3 as const },
      { bits: 16 as const },
    ]) {
      const input = await image(options);
      if (options.sampleFormat !== 3) input.littleEndian = !input.littleEndian;
      const original = vi
        .spyOn(input, 'readRasters')
        .mockResolvedValue(Object.assign([new Float32Array([7])], { width: 1, height: 1 }));
      expect(
        (await readNumericWindow(input, { level: 0, window: [0, 0, 1, 1], samples: [0] }))
          .data[0][0],
      ).toBe(7);
      expect(original).toHaveBeenCalledOnce();
    }
  });
  it('rejects truncated blocks and never schedules more than four concurrent block requests', async () => {
    const input = await image({ bits: 16, bands: 1, width: 16, height: 16 });
    vi.spyOn(input, 'getTileWidth').mockReturnValue(4);
    vi.spyOn(input, 'getTileHeight').mockReturnValue(4);
    vi.spyOn(input, 'getBlockHeight').mockReturnValue(4);
    let active = 0,
      peak = 0;
    const tile = vi.spyOn(input, 'getTileOrStrip').mockImplementation(async (x, y, sample) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { x, y, sample, data: new Uint16Array(16).fill(x + y).buffer };
    });
    const request = { level: 0, window: [0, 0, 16, 16] as const, samples: [0] };
    await readNumericWindow(input, request);
    expect(peak).toBeLessThanOrEqual(4);
    expect(tile).toHaveBeenCalledTimes(16);
    tile.mockImplementation(async (x, y, sample) => ({
      x,
      y,
      sample,
      data: new Uint16Array(1).buffer,
    }));
    await expect(readNumericWindow(input, request)).rejects.toThrow('Truncated');
  });
  it('drains active reads on failure before returning to the next serialized request', async () => {
    const input = await image({ bands: 1, width: 8, height: 8 });
    vi.spyOn(input, 'getTileWidth').mockReturnValue(4);
    vi.spyOn(input, 'getTileHeight').mockReturnValue(4);
    vi.spyOn(input, 'getBlockHeight').mockReturnValue(4);
    let active = 0;
    vi.spyOn(input, 'getTileOrStrip').mockImplementation(async (x, y, sample) => {
      active++;
      try {
        await new Promise((resolve) => setTimeout(resolve, x === 0 && y === 0 ? 1 : 8));
        if (x === 0 && y === 0) throw new Error('block failure');
        return { x, y, sample, data: new Uint8Array(16).buffer };
      } finally {
        active--;
      }
    });
    await expect(
      readNumericWindow(input, { level: 0, window: [0, 0, 8, 8], samples: [0] }),
    ).rejects.toThrow('block failure');
    expect(active).toBe(0);
    const abort = new AbortController();
    abort.abort();
    await expect(
      readNumericWindow(input, { level: 0, window: [0, 0, 1, 1], samples: [0] }, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('upload-ready original texture samples', () => {
  it.each([
    8, 16,
  ] as const)('preserves all %i-bit integer samples without creating main-thread planes', async (bits) => {
    const input = await image({
      bits,
      bands: 3,
      width: 9,
      height: 7,
      compression: 'deflate',
      pixelValue: (x, y, b) => b * 40 + x + y,
    });
    const request = { level: 0, window: [1, 1, 8, 6] as const, samples: [0, 1, 2] };
    const original = await readNumericWindow(input, request),
      packed = await readTextureWindow(input, request);
    expect(packed.bits).toBe(bits);
    for (let i = 0; i < packed.width * packed.height; i++) {
      for (let b = 0; b < 3; b++) expect(packed.data[i * 4 + b]).toBe(original.data[b][i]);
      expect(packed.data[i * 4 + 3]).toBe(0);
    }
  });
  it.each([
    1, 2,
  ])('assembles physical blocks directly with planar configuration %i and at most two decodes', async (planar) => {
    const input = await image({ bits: 16, bands: 3, width: 8, height: 8 });
    input.isTiled = true;
    input.planarConfiguration = planar;
    vi.spyOn(input, 'getTileWidth').mockReturnValue(4);
    vi.spyOn(input, 'getTileHeight').mockReturnValue(4);
    vi.spyOn(input, 'getBlockHeight').mockReturnValue(4);
    let active = 0,
      peak = 0;
    vi.spyOn(input, 'getTileOrStrip').mockImplementation(async (x, y, sample) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      const channels = planar === 1 ? 3 : 1,
        data = new Uint16Array(16 * channels);
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++)
          for (let b = 0; b < channels; b++)
            data[(j * 4 + i) * channels + b] =
              100 * (planar === 1 ? b : sample) + (x * 4 + i) * 10 + y * 4 + j;
      return { x, y, sample, data: data.buffer };
    });
    const result = await readTextureWindow(input, {
      level: 0,
      window: [1, 2, 7, 8],
      samples: [0, 1, 2],
    });
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++)
        for (let b = 0; b < 3; b++)
          expect(result.data[(y * 6 + x) * 4 + b]).toBe(b * 100 + (x + 1) * 10 + y + 2);
    expect(peak).toBeLessThanOrEqual(2);
  });
  it('rejects reordered channels and a packed-output overrun', async () => {
    const input = await image({ bits: 16, bands: 3 });
    await expect(
      readTextureWindow(input, { level: 0, window: [0, 0, 1, 1], samples: [2, 1, 0] }),
    ).rejects.toThrow();
    await expect(
      readTextureWindow(input, { level: 0, window: [0, 0, 4096, 4096], samples: [0, 1, 2] }),
    ).rejects.toThrow();
  });
});
