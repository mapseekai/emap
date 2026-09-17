import { colorizeRasterTile, planRasterTile } from '../../engine/rendering/raster/tile';
import { describe, expect, it, vi } from 'vitest';
import { GeoTIFFImage } from 'geotiff';
import { GeoTIFFReader } from './reader';
import { RASTER_PYRAMID_THRESHOLD } from '../../domain/raster/policy';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';

function file(
  options: Parameters<typeof makeRasterFixture>[0] = {},
  name = 'image.tif',
  size?: number,
): File {
  const input = new File([makeRasterFixture(options)], name, { lastModified: 100 });
  if (size !== undefined) Object.defineProperty(input, 'size', { value: size });
  return input;
}
describe('local GeoTIFF source', () => {
  it.each([
    [8, 2, -100, Int8Array],
    [16, 1, 1000, Uint16Array],
    [16, 2, -2000, Int16Array],
    [32, 1, 3000000000, Uint32Array],
    [32, 2, -1000000000, Int32Array],
    [16, 3, 1200, Float32Array],
    [32, 3, 1200.5, Float32Array],
    [64, 3, -1200.125, Float64Array],
  ] as const)('auto-stretches %i-bit format %i while preserving original samples', async (bits, sampleFormat, offset, ArrayType) => {
    const input = file({
      bits,
      sampleFormat,
      bands: 1,
      compression: 'deflate',
      pixelValue: (x, y) => offset + x * 2 + y * 4,
    });
    const source = await GeoTIFFReader.open(input);
    expect(source.metadata.statistics?.[0]).toMatchObject({
      min: offset,
      max: offset + 42,
      count: 64,
      approximate: false,
    });
    const result = await source.readWindow({ level: 0, window: [0, 0, 8, 8], samples: [0] });
    expect(result.data[0]).toBeInstanceOf(ArrayType);
    expect(result.data[0][0]).toBe(offset);
    const plan = planRasterTile(source.metadata, source.metadata.bounds, (x, y) => [x, y], {}, 8)!;
    const rgba = colorizeRasterTile(source.metadata, plan, result);
    expect(rgba[0]).toBe(0);
    expect(rgba[rgba.length - 4]).toBe(255);
    expect(result.data[0][0]).toBe(offset);
    expect(rgba[3]).toBe(255);
    source.dispose();
  });
  it('allows NoData to inherit, override, or explicitly disable the TIFF value', async () => {
    const input = file({
      bits: 16,
      bands: 1,
      noData: 0,
      pixelValue: (x, y) => (x === 0 && y === 0 ? 0 : x + y + 1),
    });
    const inherited = await GeoTIFFReader.open(input);
    expect(inherited.metadata.noData).toBe(0);
    expect(inherited.metadata.statistics?.[0].count).toBe(63);
    inherited.dispose();

    const overridden = await GeoTIFFReader.open(input, { noData: 2 });
    expect(overridden.metadata.noData).toBe(2);
    expect(overridden.metadata.statistics?.[0].count).toBe(62);
    overridden.dispose();

    const disabled = await GeoTIFFReader.open(input, { noData: null });
    expect(disabled.metadata.noData).toBeNull();
    expect(disabled.metadata.statistics?.[0].count).toBe(64);
    disabled.dispose();
  });

  it('rejects non-finite manual NoData overrides before TIFF decoding', async () => {
    await expect(GeoTIFFReader.open(file(), { noData: Number.NaN })).rejects.toMatchObject({
      code: 'INVALID_NODATA',
    });
  });

  it('excludes NaN, infinity and nodata from Float32 statistics and visible coverage', async () => {
    const input = file({
      bits: 32,
      sampleFormat: 3,
      bands: 1,
      noData: -9999,
      pixelValue: (x, y) =>
        y === 0 ? [NaN, Infinity, -Infinity, -9999, 1000, 1100, 1200, 1300][x] : 1000 + x * 50,
    });
    const source = await GeoTIFFReader.open(input);
    expect(source.metadata.statistics?.[0].count).toBe(60);
    const result = await source.readWindow({ level: 0, window: [0, 0, 8, 8], samples: [0] });
    const plan = planRasterTile(source.metadata, source.metadata.bounds, (x, y) => [x, y], {}, 8)!;
    const rgba = colorizeRasterTile(source.metadata, plan, result);
    for (let i = 0; i < 4; i++) expect(rgba[i * 4 + 3]).toBe(0);
    source.dispose();
  });
  it('decodes Deflate-compressed UInt16 windows and overviews', async () => {
    const source = await GeoTIFFReader.open(
      file({ bits: 16, bands: 1, compression: 'deflate', overviews: [2, 4] }),
    );
    for (const level of source.metadata.levels) {
      const result = await source.readWindow({
        level: level.id,
        window: [0, 0, 1, 1],
        samples: [0],
      });
      expect(result.data[0]).toBeInstanceOf(Uint16Array);
      expect(result.data[0][0]).toBe(18000);
    }
    source.dispose();
  });

  it('reads bounded windows from the original file, not file.arrayBuffer()', async () => {
    const input = file(),
      fullRead = vi.spyOn(input, 'arrayBuffer');
    const source = await GeoTIFFReader.open(input);
    expect(source.metadata.crs).toBe('EPSG:4326');
    expect(source.metadata.bounds).toEqual([116, 39.92, 116.08, 40]);
    const result = await source.readWindow({ level: 0, window: [1, 2, 3, 4], samples: [0, 2] });
    expect([result.width, result.height]).toEqual([2, 2]);
    expect(Array.from(result.data[0])).toEqual([180, 180, 180, 180]);
    expect(fullRead).not.toHaveBeenCalled();
    expect(source.toReference()).toEqual({
      kind: 'raster',
      storage: 'external-file',
      format: 'geotiff',
      filename: 'image.tif',
      fileSize: input.size,
      lastModified: 100,
      crs: 'EPSG:4326',
    });
    source.dispose();
    await expect(
      source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] }),
    ).rejects.toThrow();
  });
  it('blocks >2GiB before decoding and accepts actual reduced-resolution IFDs', async () => {
    const decode = vi.spyOn(GeoTIFFImage.prototype, 'readRasters');
    await expect(
      GeoTIFFReader.open(file({}, 'large.tif', RASTER_PYRAMID_THRESHOLD + 1)),
    ).rejects.toMatchObject({ code: 'PYRAMID_REQUIRED' });
    expect(decode).not.toHaveBeenCalled();
    const source = await GeoTIFFReader.open(
      file({ overviews: [2, 4] }, 'large.tif', RASTER_PYRAMID_THRESHOLD + 1),
    );
    expect(source.metadata.levels).toHaveLength(3);
    expect(source.metadata.levels.map((level) => level.source)).toEqual([
      'base',
      'internal-overview',
      'internal-overview',
    ]);
    const result = await source.readWindow({ level: 2, window: [0, 0, 1, 1], samples: [0] });
    expect(result.data[0][0]).toBe(180);
    source.dispose();
    decode.mockRestore();
  });
  it('accepts BigTIFF, SubIFDs and external .ovr; excludes masks', async () => {
    for (const options of [
      { bigTiff: true, overviews: [2] },
      { subIfd: true, overviews: [2] },
    ]) {
      const source = await GeoTIFFReader.open(file(options));
      expect(source.metadata.levels).toHaveLength(2);
      expect(
        (await source.readWindow({ level: 1, window: [0, 0, 1, 1], samples: [0] })).data[0][0],
      ).toBe(180);
      source.dispose();
    }
    await expect(GeoTIFFReader.open(file({ overviews: [2], mask: true }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_MASK',
    });
    await expect(
      GeoTIFFReader.open(file({ mask: true }, 'mask-only.tif', RASTER_PYRAMID_THRESHOLD + 1)),
    ).rejects.toMatchObject({ code: 'PYRAMID_REQUIRED' });
    const external = file({ subfileType: 1, width: 4, height: 4 }, 'image.tif.ovr');
    // Reject unrelated extents even if the supplied .ovr has the expected name.
    await expect(
      GeoTIFFReader.open(file({}, 'image.tif', RASTER_PYRAMID_THRESHOLD + 1), {
        overviewFile: external,
      }),
    ).rejects.toMatchObject({ code: 'OVERVIEW_MISMATCH' });
  });
  it('accepts a matching external pyramid and records a reference without its bytes', async () => {
    const original = file({}, 'external.tif', RASTER_PYRAMID_THRESHOLD + 1);
    const overviewFile = file(
      { width: 4, height: 4, subfileType: 1, scaleFactor: 2 },
      'external.tif.ovr',
    );
    const source = await GeoTIFFReader.open(original, { overviewFile });
    expect(source.metadata.levels).toHaveLength(2);
    expect(source.metadata.levels.map((level) => level.source)).toEqual([
      'base',
      'external-overview',
    ]);
    expect(source.toReference().overviewFile?.filename).toBe('external.tif.ovr');
    const pixels = await source.readWindow({ level: 1, window: [0, 0, 1, 1], samples: [0] });
    expect(pixels.data[0][0]).toBe(180);
    source.dispose();
  });
  it('requires known CRS instead of silently defaulting to 4326', async () => {
    await expect(GeoTIFFReader.open(file({ epsg: null }))).rejects.toMatchObject({
      code: 'RASTER_CRS_REQUIRED',
    });
    const source = await GeoTIFFReader.open(file({ epsg: null }), { crs: 'EPSG:3857' });
    expect(source.metadata.crs).toBe('EPSG:3857');
    source.dispose();
  });
  it('normalizes pixel-center referencing and preserves UInt16 samples', async () => {
    const source = await GeoTIFFReader.open(file({ pixelIsPoint: true, bits: 16, bands: 1 }));
    expect(source.metadata.origin).toEqual([115.995, 40.005]);
    const result = await source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] });
    expect(result.data[0]).toBeInstanceOf(Uint16Array);
    expect(result.data[0][0]).toBe(18000);
    source.dispose();
  });
  it('honors cancellation before opening and reading', async () => {
    const c = new AbortController();
    c.abort();
    await expect(GeoTIFFReader.open(file(), { signal: c.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    const source = await GeoTIFFReader.open(file());
    await expect(
      source.readWindow({ level: 0, window: [0, 0, 1, 1], samples: [0] }, c.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    source.dispose();
  });
  it('does not retain decoded pixels in the serial queue tail', async () => {
    const reader = await GeoTIFFReader.open(file());
    try {
      await reader.readWindow({ level: 0, window: [0, 0, 8, 8], samples: [0, 1, 2] });
      expect(await Reflect.get(reader, 'tail')).toBeUndefined();
    } finally {
      reader.dispose();
    }
  });
  it('clears TIFF directories and file references even when a disposed reader is retained', async () => {
    const reader = await GeoTIFFReader.open(file());
    const sources = [...Reflect.get(reader, 'sources')];
    reader.dispose();
    expect(Reflect.get(reader, 'images').size).toBe(0);
    expect(Reflect.get(reader, 'sources')).toHaveLength(0);
    expect(sources.every((source) => Reflect.get(source, 'file') === null)).toBe(true);
  });
});

describe('external overview sample compatibility', () => {
  it.each([
    [1, 2],
    [2, 1],
  ])('reads numerical bands across MINISBLACK/RGB tags (%i → %i)', async (from, to) => {
    const common = {
      bits: 16 as const,
      bands: 3 as const,
      compression: 'deflate' as const,
      pixelValue: (_x: number, _y: number, b: number) => 40 + b * 60,
    };
    const original = file(
      { ...common, width: 64, height: 32, photometric: from },
      'external.tif',
      RASTER_PYRAMID_THRESHOLD + 1,
    );
    const overviewFile = file(
      {
        ...common,
        width: 32,
        height: 16,
        photometric: to,
        subfileType: 1,
        scaleFactor: 2,
        overviews: [2, 4],
      },
      'external.tif.ovr',
    );
    const source = await GeoTIFFReader.open(original, { overviewFile });
    try {
      expect(source.metadata.levels).toHaveLength(4);
      expect(source.metadata.levels.map((level) => level.photometric)).toEqual([from, to, to, to]);
      const plan = planRasterTile(
        source.metadata,
        source.metadata.bounds,
        (x, y) => [x, y],
        {},
        8,
      )!;
      expect(plan.level.id).toBeGreaterThan(0);
      const pixels = await source.readWindow(plan.request);
      expect(pixels.data.every((band) => band instanceof Uint16Array)).toBe(true);
      expect(pixels.data.map((band) => band[0])).toEqual([40, 100, 160]);
      const rgba = colorizeRasterTile(source.metadata, plan, pixels, {
        ranges: [
          [0, 255],
          [0, 255],
          [0, 255],
        ],
      });
      expect(Array.from(rgba.slice(0, 4))).toEqual([40, 100, 160, 255]);
    } finally {
      source.dispose();
    }
  });
  it.each([
    false,
    true,
  ])('rejects an unusable explicit .ovr even with internal overviews=%s', async (internal) => {
    const original = file({ overviews: internal ? [2] : [] }, 'external.tif');
    const overviewFile = file(
      { width: 4, height: 4, bits: 16, subfileType: 1, scaleFactor: 2 },
      'external.tif.ovr',
    );
    const decode = vi.spyOn(GeoTIFFImage.prototype, 'readRasters');
    try {
      await expect(GeoTIFFReader.open(original, { overviewFile })).rejects.toMatchObject({
        code: 'OVERVIEW_MISMATCH',
      });
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });
  it('does not reinterpret grayscale alpha as an RGB color channel', async () => {
    const original = file({ photometric: 1, extraSamples: [0, 2] }, 'external.tif');
    const overviewFile = file(
      { width: 4, height: 4, subfileType: 1, scaleFactor: 2 },
      'external.tif.ovr',
    );
    await expect(GeoTIFFReader.open(original, { overviewFile })).rejects.toMatchObject({
      code: 'OVERVIEW_MISMATCH',
    });
  });
});

describe('decoded block reuse without retaining output arrays', () => {
  it('avoids file I/O and decompression when querying the same original block again', async () => {
    const reader = await GeoTIFFReader.open(
      file({ compression: 'deflate', overviews: [2], pixelValue: (x, y, b) => x + y + b }),
    );
    const spy = vi.spyOn(GeoTIFFImage.prototype, 'getTileOrStrip');
    try {
      const request = { level: 0, window: [0, 0, 2, 2] as const, samples: [0, 1, 2] };
      const first = await reader.readWindow(request);
      const calls = spy.mock.calls.length;
      const next = await reader.readWindow({ ...request, window: [1, 1, 3, 3] });
      expect(spy.mock.calls.length).toBe(calls);
      expect(next.data[0][0]).toBe(2);
      first.data[0][0] = 99;
      expect((await reader.readWindow(request)).data[0][0]).toBe(0);
      expect(Reflect.get(reader, 'blockCache').bytes).toBeGreaterThan(0);
    } finally {
      reader.dispose();
      spy.mockRestore();
    }
    expect(Reflect.get(reader, 'blockCache').bytes).toBe(0);
  });
});
