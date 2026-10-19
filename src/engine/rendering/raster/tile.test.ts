import { describe, expect, it } from 'vitest';
import {
  colorizeRasterTile,
  planRasterTile,
  rasterBands,
  selectRasterLevel,
  validateRasterStyle,
} from './tile';
import type { RasterMetadata } from '../../../domain/raster/types';
const metadata: RasterMetadata = {
  filename: 'test.tif',
  fileSize: 1000,
  lastModified: 0,
  crs: 'EPSG:4326',
  origin: [0, 8],
  resolution: [1, -1],
  bounds: [0, 0, 8, 8],
  noData: null,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 8,
      height: 8,
      tileWidth: 8,
      tileHeight: 8,
      samples: 1,
      bits: [8],
      formats: [1],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
const identity = (x: number, y: number): [number, number] => [x, y];
describe('raster display tiles', () => {
  it.each([
    'nearest',
    'bilinear',
  ] as const)('writes %s into the supplied RGBA without clearing transparent pixels', (resampling) => {
    const rgbaMetadata = {
      ...metadata,
      noData: 0,
      alphaBand: 3,
      levels: [
        {
          ...metadata.levels[0],
          samples: 4,
          bits: [32, 32, 32, 32],
          formats: [3, 3, 3, 3],
          photometric: 2,
        },
      ],
    };
    const style = { resampling };
    const plan = planRasterTile(rgbaMetadata, [0, 0, 8, 8], identity, style, 8)!;
    const red = new Float32Array(64).fill(0.5);
    red[0] = 0;
    const alpha = new Float32Array(64).fill(0.5);
    alpha[1] = 0;
    alpha[2] = NaN;
    alpha[3] = -1;
    alpha[4] = 0.001;
    const samples = { width: 8, height: 8, data: [red, red.slice(), red.slice(), alpha] };
    const expected = new Uint8ClampedArray(256).fill(73);
    const partial = colorizeRasterTile(rgbaMetadata, plan, samples, style);
    for (let i = 0; i < partial.length; i += 4)
      if (partial[i + 3]) expected.set(partial.subarray(i, i + 4), i);
    const target = new Uint8ClampedArray(256).fill(73);
    expect(colorizeRasterTile(rgbaMetadata, plan, samples, style, target)).toBe(target);
    expect(target).toEqual(expected);
    expect(Array.from(target.subarray(0, 20))).toEqual(Array(20).fill(73));
  });

  it('validates a caller-owned target before writing', () => {
    const plan = planRasterTile(metadata, [0, 0, 8, 8], identity, {}, 8)!;
    const target = new Uint8ClampedArray(4).fill(73);
    expect(() =>
      colorizeRasterTile(
        metadata,
        plan,
        { width: 8, height: 8, data: [new Uint8Array(64)] },
        {},
        target,
      ),
    ).toThrow(/RGBA/);
    expect(Array.from(target)).toEqual([73, 73, 73, 73]);
  });

  it('normalizes floating-point unassociated alpha using the 0–1 range', () => {
    const rgbaMetadata = {
      ...metadata,
      alphaBand: 3,
      levels: [
        {
          ...metadata.levels[0],
          samples: 4,
          bits: [32, 32, 32, 32],
          formats: [3, 3, 3, 3],
          photometric: 2,
        },
      ],
    };
    const plan = planRasterTile(rgbaMetadata, [0, 0, 8, 8], identity, {}, 8)!;
    const pixels = colorizeRasterTile(rgbaMetadata, plan, {
      width: 8,
      height: 8,
      data: Array.from({ length: 4 }, () => new Float32Array(64).fill(0.5)),
    });
    expect(Array.from(pixels.slice(0, 4))).toEqual([128, 128, 128, 128]);
  });

  it('maps display pixel centers into bounded original windows without flipping or shifting rows', () => {
    const plan = planRasterTile(metadata, [0, 0, 8, 8], identity, {}, 8)!;
    expect(plan.request).toEqual({ level: 0, window: [0, 0, 8, 8], samples: [0] });
    expect(plan.locate(0.5, 0.5)).toEqual([0.5, 0.5]);
    expect(plan.locate(7.5, 7.5)).toEqual([7.5, 7.5]);
    const data = Uint8Array.from({ length: 64 }, (_, i) => i);
    const rgba = colorizeRasterTile(metadata, plan, { width: 8, height: 8, data: [data] });
    expect(Array.from(rgba.slice(0, 8))).toEqual([0, 0, 0, 255, 1, 1, 1, 255]);
    expect(Array.from(rgba.slice(-4))).toEqual([63, 63, 63, 255]);
    expect(data[63]).toBe(63);
  });
  it('selects a real overview rather than requesting full-resolution pixels then resizing', () => {
    const overview = {
      ...metadata.levels[0],
      id: 1,
      width: 2,
      height: 2,
      tileWidth: 2,
      tileHeight: 2,
      subfileType: 1,
    };
    const plan = planRasterTile(
      { ...metadata, levels: [metadata.levels[0], overview] },
      [0, 0, 8, 8],
      identity,
      {},
      2,
    )!;
    expect(plan.request.level).toBe(1);
    expect(plan.request.window).toEqual([0, 0, 2, 2]);
  });
  it('uses the same source-pixel ratio thresholds for lightweight LOD diagnostics', () => {
    const twoX = {
      ...metadata.levels[0],
      id: 1,
      source: 'external-overview' as const,
      width: 4,
      height: 4,
      tileWidth: 2,
      tileHeight: 2,
      subfileType: 1,
    };
    const fourX = {
      ...twoX,
      id: 2,
      width: 2,
      height: 2,
    };
    const pyramid = {
      ...metadata,
      levels: [{ ...metadata.levels[0], source: 'base' as const }, twoX, fourX],
    };
    const zoomed = selectRasterLevel(pyramid, [0, 0, 8, 8], identity, 16);
    expect(zoomed.level.id).toBe(0);
    expect(zoomed.sourcePixelsPerDisplayPixel).toBeCloseTo(0.5);
    const medium = selectRasterLevel(pyramid, [0, 0, 8, 8], identity, 4);
    expect(medium.level.id).toBe(1);
    expect(medium.sourcePixelsPerDisplayPixel).toBeCloseTo(2);
    const distant = selectRasterLevel(pyramid, [0, 0, 8, 8], identity, 2);
    expect(distant.level.id).toBe(2);
    expect(distant.sourcePixelsPerDisplayPixel).toBeCloseTo(4);
    expect(planRasterTile(pyramid, [0, 0, 8, 8], identity, {}, 2)?.request.level).toBe(
      distant.level.id,
    );
  });
  it('allows modest overview oversampling for tiled overviews, including strip-backed bases', () => {
    const tiledBase = {
      ...metadata.levels[0],
      source: 'base' as const,
      tileWidth: 4,
      tileHeight: 4,
    };
    const tiledOverview = {
      ...tiledBase,
      id: 1,
      source: 'internal-overview' as const,
      width: 4,
      height: 4,
      tileWidth: 2,
      tileHeight: 2,
      subfileType: 1,
    };
    const tiled = selectRasterLevel(
      { ...metadata, levels: [tiledBase, tiledOverview] },
      [0, 0, 6, 6],
      identity,
      4,
    );
    expect(tiled.sourcePixelsPerDisplayPixel).toBeCloseTo(1.5);
    expect(tiled.level.id).toBe(1);

    const stripedBase = { ...tiledBase, tileWidth: 8, tileHeight: 1 };
    const striped = selectRasterLevel(
      { ...metadata, levels: [stripedBase, tiledOverview] },
      [0, 0, 6, 6],
      identity,
      4,
    );
    expect(striped.level.id).toBe(1);

    const stripedTooClose = selectRasterLevel(
      { ...metadata, levels: [stripedBase, tiledOverview] },
      [0, 0, 5.6, 5.6],
      identity,
      4,
    );
    expect(stripedTooClose.level.id).toBe(0);

    const tooClose = selectRasterLevel(
      { ...metadata, levels: [tiledBase, tiledOverview] },
      [0, 0, 5.6, 5.6],
      identity,
      4,
    );
    expect(tooClose.sourcePixelsPerDisplayPixel).toBeCloseTo(1.4);
    expect(tooClose.level.id).toBe(0);
  });

  it('renders NoData and out-of-coverage pixels transparent', () => {
    const nd = { ...metadata, noData: 0 },
      plan = planRasterTile(nd, [0, 0, 8, 8], identity, {}, 8)!;
    const rgba = colorizeRasterTile(nd, plan, {
      width: 8,
      height: 8,
      data: [Uint8Array.from({ length: 64 }, (_, i) => i)],
    });
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(255);
    expect(planRasterTile(metadata, [20, 20, 30, 30], identity)).toBeNull();
  });
  it('uses stable explicit ranges for floats and supports palette display', () => {
    const floats = { ...metadata, levels: [{ ...metadata.levels[0], bits: [32], formats: [3] }] };
    const style = { ranges: [[0, 3000] as const] },
      plan = planRasterTile(floats, [0, 0, 8, 8], identity, style, 8)!;
    const rgba = colorizeRasterTile(
      floats,
      plan,
      { width: 8, height: 8, data: [new Float32Array(64).fill(1500)] },
      style,
    );
    expect(Array.from(rgba.slice(0, 4))).toEqual([128, 128, 128, 255]);
    const palette = Array(768).fill(0);
    palette[5] = 65535;
    const pal = { ...metadata, palette, levels: [{ ...metadata.levels[0], photometric: 3 }] };
    const palPlan = planRasterTile(pal, [0, 0, 8, 8], identity, {}, 8)!;
    expect(
      Array.from(
        colorizeRasterTile(pal, palPlan, {
          width: 8,
          height: 8,
          data: [new Uint8Array(64).fill(5)],
        }).slice(0, 4),
      ),
    ).toEqual([255, 0, 0, 255]);
  });
  it('keeps band sampling independent from opacity and rejects invalid styles', () => {
    const style = { bands: [0, 0, 0], opacity: 0.5 };
    const plan = planRasterTile(metadata, [0, 0, 8, 8], identity, style, 8)!;
    expect(plan.request.samples).toEqual([0]);
    for (const invalid of [
      { opacity: NaN },
      { opacity: 2 },
      { bands: [1] },
      { ranges: [[2, 1] as const] },
      { bands: [0, 0] },
    ])
      expect(() => validateRasterStyle(metadata, invalid)).toThrow();
  });
  it('bilinear interpolation ignores nodata contributors', () => {
    const meta = { ...metadata, noData: 0 };
    const style = { resampling: 'bilinear' as const };
    const plan = planRasterTile(meta, [0, 0, 8, 8], identity, style, 16)!;
    const data = new Uint8Array(64).fill(100);
    data[0] = 0;
    const rgba = colorizeRasterTile(meta, plan, { width: 8, height: 8, data: [data] }, style);
    expect(rgba[3]).toBe(0);
    expect(Array.from(rgba.slice(4, 8))).toEqual([100, 100, 100, 255]);
  });
  it('defaults multiband data to RGB without using an alpha band as a color channel', () => {
    const multiband = {
      ...metadata,
      alphaBand: 1,
      levels: [
        { ...metadata.levels[0], samples: 4, bits: [16, 16, 16, 16], formats: [1, 1, 1, 1] },
      ],
    };
    expect(rasterBands(multiband, {})).toEqual([0, 2, 3]);
    expect(rasterBands(metadata, {})).toEqual([0]);
    expect(rasterBands(multiband, { bands: [2] })).toEqual([2]);
  });
  it('renders an individually selected RGB channel as grayscale and preserves its alpha', () => {
    const rgb = {
      ...metadata,
      alphaBand: 3,
      levels: [
        {
          ...metadata.levels[0],
          samples: 4,
          photometric: 2,
          bits: [8, 8, 8, 8],
          formats: [1, 1, 1, 1],
        },
      ],
    };
    const style = { bands: [1] };
    const plan = planRasterTile(rgb, metadata.bounds, identity, style, 8)!;
    expect(plan.request.samples).toEqual([1, 3]);
    const pixels = colorizeRasterTile(
      rgb,
      plan,
      { width: 8, height: 8, data: [new Uint8Array(64).fill(75), new Uint8Array(64).fill(128)] },
      style,
    );
    expect(Array.from(pixels.slice(0, 4))).toEqual([75, 75, 75, 128]);
  });
  it('uses the selected source band statistics rather than the first band statistics', () => {
    const numeric = {
      ...metadata,
      levels: [
        {
          ...metadata.levels[0],
          samples: 3,
          photometric: 2,
          bits: [16, 16, 16],
          formats: [1, 1, 1],
        },
      ],
      statistics: [
        { min: 0, max: 100, p02: 0, p98: 100, count: 64, approximate: false },
        { min: 1000, max: 2000, p02: 1000, p98: 2000, count: 64, approximate: false },
        { min: 10000, max: 20000, p02: 10000, p98: 20000, count: 64, approximate: false },
      ],
    };
    const style = { bands: [1] };
    const plan = planRasterTile(numeric, metadata.bounds, identity, style, 8)!;
    const pixels = colorizeRasterTile(
      numeric,
      plan,
      { width: 8, height: 8, data: [new Uint16Array(64).fill(1500)] },
      style,
    );
    expect(Array.from(pixels.slice(0, 4))).toEqual([128, 128, 128, 255]);
  });
  it('keeps native palette display by default but renders explicitly selected samples as gray', () => {
    const palette = Array(768).fill(0);
    palette[5] = 65535;
    const pal = { ...metadata, palette, levels: [{ ...metadata.levels[0], photometric: 3 }] };
    const style = { bands: [0] };
    const plan = planRasterTile(pal, metadata.bounds, identity, style, 8)!;
    expect(
      Array.from(
        colorizeRasterTile(
          pal,
          plan,
          { width: 8, height: 8, data: [new Uint8Array(64).fill(5)] },
          style,
        ).slice(0, 4),
      ),
    ).toEqual([5, 5, 5, 255]);
  });
});

describe('allocation-light bilinear display', () => {
  const meta: RasterMetadata = {
    ...metadata,
    bounds: [0, 0, 2, 2],
    origin: [0, 2],
    alphaBand: 3,
    levels: [
      {
        ...metadata.levels[0],
        width: 2,
        height: 2,
        tileWidth: 2,
        tileHeight: 2,
        samples: 4,
        bits: [32, 32, 32, 32],
        formats: [3, 3, 3, 3],
        photometric: 2,
      },
    ],
  };
  it('preserves channel order, interpolation weights, edge clamping and unassociated alpha', () => {
    const style = {
      bands: [2, 0, 1],
      ranges: [
        [0, 100],
        [0, 100],
        [0, 100],
      ] as const,
      resampling: 'bilinear' as const,
    };
    const plan = planRasterTile(meta, meta.bounds, identity, style, 4)!;
    const data = [
      new Float32Array([30, 50, 70, 90]),
      new Float32Array([10, 30, 50, 70]),
      new Float32Array([20, 40, 60, 80]),
      new Float32Array([0.25, 0.5, 0.75, 1]),
    ];
    const rgba = colorizeRasterTile(meta, plan, { width: 2, height: 2, data }, style);
    expect(Array.from(rgba.slice(20, 24))).toEqual([115, 64, 89, 64]);
    expect(Array.from(rgba.slice(0, 4))).toEqual([77, 26, 51, 64]);
    expect(Array.from(rgba.slice(-4))).toEqual([230, 179, 204, 255]);
    expect(Array.from(data[0])).toEqual([30, 50, 70, 90]);
  });
  it('does not classify an interpolated value equal to nodata as an invalid source sample', () => {
    const gray = {
      ...metadata,
      origin: [0, 2] as const,
      bounds: [0, 0, 2, 2] as const,
      noData: 0,
      levels: [
        {
          ...metadata.levels[0],
          width: 2,
          height: 2,
          tileWidth: 2,
          tileHeight: 2,
          bits: [32],
          formats: [3],
        },
      ],
    };
    const style = { bands: [0], ranges: [[-1, 1]] as const, resampling: 'bilinear' as const };
    const plan = planRasterTile(gray, gray.bounds, identity, style, 1)!;
    const rgba = colorizeRasterTile(
      gray,
      plan,
      { width: 2, height: 2, data: [new Float32Array([-1, 1, 1, -1])] },
      style,
    );
    expect(Array.from(rgba)).toEqual([128, 128, 128, 255]);
  });
});
