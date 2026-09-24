import { rasterWarpLocator } from '../../engine/rendering/raster/warp';
import { describe, expect, it, vi } from 'vitest';
import { GeoTIFFReader } from './reader';
import { renderRasterBatch, renderRasterWindow } from './render-window';
import { planRasterTile, colorizeRasterTile } from '../../engine/rendering/raster/tile';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';

describe('off-thread raster pipeline', () => {
  it.each([
    [8, 3, 'nearest'],
    [16, 3, 'nearest'],
    [16, 3, 'bilinear'],
    [8, 4, 'nearest'],
    [8, 4, 'bilinear'],
  ] as const)('reuses only final RGBA across chunks (%i-bit, %i bands, %s)', async (bits, bands, resampling) => {
    const reader = await GeoTIFFReader.open(
      new File(
        [
          makeRasterFixture({
            width: 32,
            height: 16,
            bits,
            bands,
            noData: 0,
            compression: 'lzw',
            pixelValue: (x, y, band) =>
              band === 3
                ? x % 3 === 0
                  ? 0
                  : x % 3 === 1
                    ? 128
                    : 255
                : (x * 7 + y * 13 + band * 17) % 255,
          }),
        ],
        'chunked-lzw.tif',
      ),
    );
    try {
      const style = { resampling };
      const plan = planRasterTile(
        reader.metadata,
        reader.metadata.bounds,
        (x, y) => [x, y],
        style,
        64,
      )!;
      const request = { read: plan.request, warp: plan.warp, width: 64, height: 64, style };
      const overlap = resampling === 'bilinear' ? 1 : 0;
      const chunks = [
        { ...plan.request, window: [0, 0, 32, 6 + overlap] as const },
        { ...plan.request, window: [0, 6 - overlap, 32, 11 + overlap] as const },
        { ...plan.request, window: [0, 11 - overlap, 32, 16] as const },
      ];
      const expected = new Uint8ClampedArray(64 * 64 * 4);
      for (const chunk of chunks) {
        const data = await reader.readWindow(chunk);
        const partial = colorizeRasterTile(
          reader.metadata,
          { ...plan, request: chunk, locate: rasterWarpLocator(plan.warp, 64) },
          data,
          style,
        );
        for (let i = 0; i < partial.length; i += 4)
          if (partial[i + 3]) expected.set(partial.subarray(i, i + 4), i);
      }
      vi.spyOn(reader, 'splitRowStripedReadRequests').mockReturnValue(chunks);
      let rgbaAllocations = 0;
      vi.stubGlobal(
        'Uint8ClampedArray',
        new Proxy(Uint8ClampedArray, {
          construct(target, args) {
            if (args[0] === 64 * 64 * 4) rgbaAllocations++;
            return Reflect.construct(target, args);
          },
        }),
      );
      const actual = await renderRasterBatch(reader, [request, structuredClone(request)]);
      expect(actual[0].canonicalBinaryAlpha).toBe(
        reader.metadata.alphaBand === null ? true : undefined,
      );
      if (actual[0].canonicalBinaryAlpha)
        for (let i = 0; i < actual[0].rgba.length; i += 4) {
          const alpha = actual[0].rgba[i + 3];
          expect(alpha === 0 || alpha === 255).toBe(true);
          if (!alpha) expect([...actual[0].rgba.subarray(i, i + 3)]).toEqual([0, 0, 0]);
        }
      expect(actual[0].rgba).toEqual(expected);
      expect(actual[1].rgba).toEqual(expected);
      expect(actual[0].rgba.buffer).not.toBe(actual[1].rgba.buffer);
      expect(rgbaAllocations).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      reader.dispose();
    }
  });

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

  it('shares one union source read across sibling display tiles', async () => {
    const reader = await GeoTIFFReader.open(
      new File([makeRasterFixture({ width: 32, height: 16, bits: 16, bands: 3 })], 'image.tif'),
    );
    try {
      const plan = planRasterTile(
        reader.metadata,
        reader.metadata.bounds,
        (x, y) => [x, y],
        {},
        64,
      )!;
      const request = {
        read: plan.request,
        warp: plan.warp,
        width: plan.width,
        height: plan.height,
        style: {},
      };
      const read = vi.spyOn(reader, 'readWindow');
      const results = await renderRasterBatch(reader, [request, structuredClone(request)]);
      expect(results).toHaveLength(2);
      expect(read).toHaveBeenCalledTimes(1);
      expect(results[0].rgba).toEqual(results[1].rgba);
      expect(results[0].diagnostics).toBeDefined();
      expect(results[1].diagnostics).toBeUndefined();
    } finally {
      reader.dispose();
    }
  });

  it('chunks a large row-striped union window before physical reads', async () => {
    const reader = await GeoTIFFReader.open(
      new File([makeRasterFixture({ bits: 16, bands: 3 })], 'image.tif'),
    );
    try {
      Object.assign(reader.metadata.levels[0], {
        width: 54_798,
        height: 1_000,
        tileWidth: 54_798,
        tileHeight: 1,
        decodedBlockConcurrency: 4,
      });
      const bytes = 54_798 * 3 * 2;
      (
        reader as unknown as { physicalBlockBytes: Map<number, readonly number[]> }
      ).physicalBlockBytes = new Map([[0, Array(1_000).fill(bytes)]]);
      const chunks = reader.splitRowStripedReadRequests({
        level: 0,
        window: [10_000, 0, 13_000, 500],
        samples: [0, 1, 2],
      });
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].window[1]).toBe(0);
      expect(chunks.at(-1)?.window[3]).toBe(500);
      for (const chunk of chunks)
        expect((chunk.window[3] - chunk.window[1]) * bytes).toBeLessThanOrEqual(64 * 1024 ** 2);
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
