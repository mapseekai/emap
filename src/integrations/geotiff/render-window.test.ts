import { describe, expect, it, vi } from 'vitest';
import { GeoTIFFReader } from './reader';
import { renderRasterWindow } from './render-window';
import { planRasterTile, colorizeRasterTile } from '../../engine/rendering/raster/tile';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';

describe('off-thread raster pipeline', () => {
  it.each([
    [8, 1],
    [16, 1],
    [16, 2],
    [32, 3],
    [64, 3],
  ] as const)('preserves %i-bit/%i RGB and grayscale bytes for both resamplers', async (bits, sampleFormat) => {
    const file = new File(
      [
        makeRasterFixture({
          width: 32,
          height: 16,
          bits,
          sampleFormat,
          bands: 3,
          compression: 'deflate',
          noData: 0,
          pixelValue: (x, y, b) => x + y + b * 10,
        }),
      ],
      'image.tif',
    );
    const reader = await GeoTIFFReader.open(file);
    try {
      for (const bands of [[0, 1, 2], [2]])
        for (const resampling of ['nearest', 'bilinear'] as const) {
          const style = { bands, resampling };
          const plan = planRasterTile(
            reader.metadata,
            reader.metadata.bounds,
            (x, y) => [x, y],
            style,
            64,
          )!;
          const samples = await reader.readWindow(plan.request);
          const expected = colorizeRasterTile(reader.metadata, plan, samples, style);
          const actual = await renderRasterWindow(
            reader,
            structuredClone({
              read: plan.request,
              warp: plan.warp,
              width: plan.width,
              height: plan.height,
              style,
            }),
          );
          expect(actual.rgba).toEqual(expected);
          expect(actual.width).toBe(64);
          expect(await reader.readWindow(plan.request)).toEqual(samples);
        }
    } finally {
      reader.dispose();
    }
  });
  it('renders chunky UInt8 RGB nearest-neighbor directly without planar deinterleave', async () => {
    const reader = await GeoTIFFReader.open(
      new File(
        [
          makeRasterFixture({
            width: 32,
            height: 16,
            bits: 8,
            bands: 3,
            compression: 'deflate',
            noData: 0,
            pixelValue: (x, y, band) => (x * 5 + y * 7 + band * 43) & 255,
          }),
        ],
        'rgb8.tif',
      ),
    );
    try {
      const style = { bands: [2, 0, 1], resampling: 'nearest' as const },
        plan = planRasterTile(
          reader.metadata,
          reader.metadata.bounds,
          (x, y) => [x, y],
          style,
          64,
        )!,
        samples = await reader.readWindow(plan.request),
        expected = colorizeRasterTile(reader.metadata, plan, samples, style),
        actual = await renderRasterWindow(reader, {
          read: plan.request,
          warp: plan.warp,
          width: plan.width,
          height: plan.height,
          style,
        });
      expect(actual.rgba).toEqual(expected);
      expect(actual.diagnostics).toMatchObject({ directRgb8Tiles: 1, deinterleaveMs: 0 });
    } finally {
      reader.dispose();
    }
  });

  it('does not read pixels after cancellation or for an invalid render request', async () => {
    const reader = await GeoTIFFReader.open(new File([makeRasterFixture()], 'image.tif'));
    const plan = planRasterTile(reader.metadata, reader.metadata.bounds, (x, y) => [x, y], {}, 8)!;
    const request = { read: plan.request, warp: plan.warp, width: 8, height: 8, style: {} };
    const read = vi.spyOn(reader, 'readWindow');
    const controller = new AbortController();
    controller.abort();
    await expect(renderRasterWindow(reader, request, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(renderRasterWindow(reader, { ...request, width: 1e8 })).rejects.toMatchObject({
      code: 'INVALID_RASTER_RENDER',
    });
    expect(read).not.toHaveBeenCalled();
    reader.dispose();
  });
  it('reuses primary statistics in a parallel replica instead of rescanning the file', async () => {
    const file = new File([makeRasterFixture({ bits: 16, bands: 3 })], 'image.tif');
    const primary = await GeoTIFFReader.open(file);
    const read = vi.spyOn(GeoTIFFReader.prototype, 'readWindow');
    try {
      const replica = await GeoTIFFReader.open(
        file,
        {},
        { statistics: primary.metadata.statistics, cacheBytes: 4 * 1024 ** 2, pageLimit: 8 },
      );
      expect(read).not.toHaveBeenCalled();
      expect(replica.metadata.statistics).toEqual(primary.metadata.statistics);
      expect(replica.directoryBytes).toBe(primary.directoryBytes);
      replica.dispose();
    } finally {
      read.mockRestore();
      primary.dispose();
    }
  });
});
