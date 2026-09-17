import { describe, expect, it } from 'vitest';
import {
  assertRasterPyramid,
  isRasterOverview,
  validateRasterWindow,
  RASTER_PYRAMID_THRESHOLD,
} from './policy';
import type { RasterLevel } from './types';

const base: RasterLevel = {
  id: 0,
  width: 4096,
  height: 4096,
  tileWidth: 256,
  tileHeight: 256,
  samples: 3,
  bits: [8, 8, 8],
  formats: [1, 1, 1],
  photometric: 2,
  subfileType: 0,
};
const overview = { ...base, id: 1, width: 1024, height: 1024, subfileType: 1 };

describe('raster preflight policy', () => {
  it('requires overviews strictly above 2 GiB, before any decoding', () => {
    expect(() => assertRasterPyramid(RASTER_PYRAMID_THRESHOLD, [base])).not.toThrow();
    expect(() => assertRasterPyramid(RASTER_PYRAMID_THRESHOLD + 1, [base])).toThrowError(
      /PYRAMID_REQUIRED/,
    );
    expect(() => assertRasterPyramid(RASTER_PYRAMID_THRESHOLD + 1, [base, overview])).not.toThrow();
  });
  it('does not mistake masks, full-sized pages or incompatible rasters for overviews', () => {
    expect(isRasterOverview(base, overview)).toBe(true);
    for (const bad of [
      { ...overview, subfileType: 5 },
      { ...overview, subfileType: 0 },
      { ...overview, subfileType: 3 },
      { ...overview, width: base.width, height: base.height },
      { ...overview, height: 500 },
      { ...overview, samples: 1 },
      { ...overview, bits: [16, 16, 16] },
    ])
      expect(isRasterOverview(base, bad)).toBe(false);
  });
  it('budgets source pixels and whole compressed strips, not resized output', () => {
    expect(() => validateRasterWindow(base, [0, 0, 256, 256], [0, 1, 2])).not.toThrow();
    expect(() => validateRasterWindow(base, [0, 0, 4096, 4096], [0, 1, 2])).toThrow();
    const hugeStrip = {
      ...base,
      width: 100000,
      height: 100000,
      tileWidth: 100000,
      tileHeight: 100000,
    };
    expect(() => validateRasterWindow(hugeStrip, [0, 0, 10, 10], [0])).toThrow();
  });
  it('rejects non-finite, fractional, inverted, outside or empty windows and invalid bands', () => {
    for (const window of [
      [NaN, 0, 1, 1],
      [0.5, 0, 2, 2],
      [-1, 0, 1, 1],
      [2, 0, 1, 1],
      [0, 0, 0, 1],
      [0, 0, 5000, 1],
    ]) {
      expect(() =>
        validateRasterWindow(base, window as [number, number, number, number], [0]),
      ).toThrow();
    }
    for (const samples of [[], [-1], [3], [0.5], [0, 0]])
      expect(() => validateRasterWindow(base, [0, 0, 1, 1], samples)).toThrow();
  });
});

describe('numerical overview compatibility', () => {
  it.each([
    [1, 2],
    [2, 1],
  ])('accepts three-band MINISBLACK/RGB tags (%i → %i)', (from, to) => {
    const original = { ...base, photometric: from, bits: [16, 16, 16] };
    const reduced = { ...overview, photometric: to, bits: [16, 16, 16] };
    expect(isRasterOverview(original, reduced)).toBe(true);
    expect(() =>
      assertRasterPyramid(RASTER_PYRAMID_THRESHOLD + 1, [original, reduced]),
    ).not.toThrow();
    for (const incompatible of [
      { ...reduced, photometric: 0 },
      { ...reduced, photometric: 3 },
      { ...reduced, photometric: 5 },
      { ...reduced, photometric: 6 },
      { ...reduced, samples: 1, bits: [16], formats: [1] },
      { ...reduced, bits: [8, 8, 8] },
      { ...reduced, formats: [2, 2, 2] },
      { ...reduced, subfileType: 5 },
      { ...reduced, height: 500 },
    ])
      expect(isRasterOverview(original, incompatible)).toBe(false);
  });
  it('does not reinterpret single-band data as RGB', () => {
    const single = { ...base, samples: 1, bits: [8], formats: [1], photometric: 1 };
    expect(
      isRasterOverview(single, {
        ...single,
        width: 1024,
        height: 1024,
        subfileType: 1,
        photometric: 2,
      }),
    ).toBe(false);
  });
});
