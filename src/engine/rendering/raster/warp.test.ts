import { describe, expect, it } from 'vitest';
import { planRasterTile, colorizeRasterTile } from './tile';
import { makeRasterWarp, rasterWarpLocator, validateRasterRender } from './warp';
import type { RasterMetadata } from '../../../domain/raster/types';
const meta: RasterMetadata = {
  filename: 'image.tif',
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
      bits: [16],
      formats: [1],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
describe('serializable raster rendering', () => {
  it('preserves mesh interpolation exactly across structured cloning', () => {
    const grid: [[number, number], [number, number], [number, number], [number, number]] = [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ];
    const warp = makeRasterWarp(grid, 2, 8, 8, (x, y) => [x, y]);
    const locate = rasterWarpLocator(structuredClone(warp), 8);
    expect(locate(0.5, 0.5)).toEqual([0.5, 0.5]);
    expect(locate(7.5, 7.5)).toEqual([7.5, 7.5]);
  });
  it('preserves exact fallback coordinates at projection validity boundaries', () => {
    const warp = makeRasterWarp([[0, 0], null, [0, 8], [8, 8]], 2, 8, 8, (x, y) =>
      x > 4 ? null : [x * 0.75, y],
    );
    const locate = rasterWarpLocator(structuredClone(warp), 8);
    expect(locate(1.5, 2.5)).toEqual([1.125, 2.5]);
    expect(locate(6.5, 2.5)).toBeNull();
  });
  it.each([
    'nearest',
    'bilinear',
  ] as const)('renders identical %s bytes after serialization', (resampling) => {
    const style = { ranges: [[0, 255] as const], resampling };
    const plan = planRasterTile(meta, meta.bounds, (x, y) => [x, y], style, 16)!;
    const request = structuredClone({
      read: plan.request,
      warp: plan.warp,
      width: plan.width,
      height: plan.height,
      style,
    });
    validateRasterRender(meta, request);
    const restored = { ...plan, locate: rasterWarpLocator(request.warp, request.width) };
    const result = {
      width: 8,
      height: 8,
      data: [Uint16Array.from({ length: 64 }, (_, i) => i * 3)],
    };
    expect(colorizeRasterTile(meta, restored, result, style)).toEqual(
      colorizeRasterTile(meta, plan, result, style),
    );
  });
  it('rejects excessive display allocation and malformed mesh buffers before reading', () => {
    const plan = planRasterTile(meta, meta.bounds, (x, y) => [x, y], {}, 8)!;
    const request = { read: plan.request, warp: plan.warp, width: 8, height: 8, style: {} };
    expect(() => validateRasterRender(meta, { ...request, width: 1e9, height: 1e9 })).toThrow();
    expect(() =>
      validateRasterRender(meta, {
        ...request,
        warp: { ...request.warp, points: new Float64Array(0) },
      }),
    ).toThrow();
    expect(() =>
      validateRasterRender(meta, { ...request, read: { ...request.read, samples: [1] } }),
    ).toThrow();
  });
});
