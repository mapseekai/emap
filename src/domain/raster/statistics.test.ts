import { describe, expect, it, vi } from 'vitest';
import { collectRasterStatistics, resolveRasterRanges, stretchRasterValue } from './statistics';
import type { RasterMetadata, RasterSource } from './types';

const metadata: RasterMetadata = {
  filename: 'dem.tif',
  fileSize: 1000,
  lastModified: 0,
  crs: 'EPSG:4326',
  bounds: [0, 0, 4, 4],
  origin: [0, 4],
  resolution: [1, -1],
  noData: -9999,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 4,
      height: 4,
      tileWidth: 4,
      tileHeight: 4,
      samples: 1,
      bits: [32],
      formats: [3],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
function source(values: number[], meta = metadata): RasterSource {
  return {
    metadata: meta,
    dispose: vi.fn(),
    toReference: vi.fn(),
    readWindow: vi.fn(async (request) => {
      const [l, t, r, b] = request.window;
      const data: number[] = [];
      for (let y = t; y < b; y++)
        for (let x = l; x < r; x++) data.push(values[y * meta.levels[0].width + x]);
      return { width: r - l, height: b - t, data: [new Float64Array(data)] };
    }),
  };
}
describe('stable high-depth display stretch', () => {
  it('ignores nodata and non-finite samples and maps real values to display bytes', async () => {
    const stats = await collectRasterStatistics(
      source([
        -9999,
        NaN,
        Infinity,
        -Infinity,
        ...Array.from({ length: 12 }, (_, i) => 1000 + i * 10),
      ]),
    );
    expect(stats[0]).toMatchObject({ min: 1000, max: 1110, count: 12, approximate: false });
    const ranges = resolveRasterRanges({ ...metadata, statistics: stats }, {}, [0]);
    expect(stretchRasterValue(1000, ranges[0])).toBe(0);
    expect(stretchRasterValue(1110, ranges[0])).toBe(255);
  });
  it('keeps constant-valued rasters visible and all-invalid pixels transparent', async () => {
    const stats = await collectRasterStatistics(source(Array(16).fill(1200)));
    const range = resolveRasterRanges({ ...metadata, statistics: stats }, {}, [0])[0];
    expect(stretchRasterValue(1200, range)).toBe(128);
    expect((await collectRasterStatistics(source(Array(16).fill(-9999))))[0].count).toBe(0);
  });
  it('preserves UInt8 colors, honors manual ranges, and handles extreme finite Float64 values', () => {
    const byte = { ...metadata, levels: [{ ...metadata.levels[0], bits: [8], formats: [1] }] };
    expect(resolveRasterRanges(byte, {}, [0])).toEqual([[0, 255]]);
    expect(resolveRasterRanges(metadata, { ranges: [[500, 1500]] }, [0])).toEqual([[500, 1500]]);
    expect(stretchRasterValue(0, [-Number.MAX_VALUE, Number.MAX_VALUE])).toBe(128);
  });
  it('never exceeds 65536 source sample positions and prefers an overview', async () => {
    const base = {
      ...metadata.levels[0],
      width: 100000,
      height: 100000,
      tileWidth: 256,
      tileHeight: 256,
    };
    const meta = {
      ...metadata,
      levels: [base, { ...base, id: 1, width: 512, height: 512, subfileType: 1 }],
    };
    let pixels = 0;
    const reader = {
      metadata: meta,
      readWindow: vi.fn(async (request) => {
        expect(request.level).toBe(1);
        const [l, t, r, b] = request.window;
        pixels += (r - l) * (b - t);
        return {
          width: r - l,
          height: b - t,
          data: [new Float32Array((r - l) * (b - t)).fill(2000)],
        };
      }),
    } as unknown as RasterSource;
    expect((await collectRasterStatistics(reader))[0].approximate).toBe(true);
    expect(pixels).toBeLessThanOrEqual(65536);
  });
  it('aborts without starting a pixel read', async () => {
    const reader = source(Array(16).fill(100));
    const controller = new AbortController();
    controller.abort();
    await expect(collectRasterStatistics(reader, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(reader.readWindow).not.toHaveBeenCalled();
  });
});
