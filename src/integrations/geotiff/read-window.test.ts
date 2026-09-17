import { describe, expect, it, vi } from 'vitest';
import { fromArrayBuffer } from 'geotiff';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';
import { readNumericWindow } from './read-window';

async function image(options: Parameters<typeof makeRasterFixture>[0] = {}) {
  const bytes = makeRasterFixture(options);
  return (await fromArrayBuffer(bytes.buffer as ArrayBuffer)).getImage();
}
describe('native numeric window assembly', () => {
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
