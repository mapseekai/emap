import { describe, expect, it, vi } from 'vitest';
import { GeoTIFF } from 'geotiff';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';
import { LocalRasterFileSource } from './file-source';
import { readUncompressedStripWindow } from './uncompressed-window';
import { readNumericWindow } from './read-window';

async function open(options: Parameters<typeof makeRasterFixture>[0] = {}) {
  const raw = makeRasterFixture({
    width: 200,
    height: 12,
    bands: 3,
    bits: 16,
    pixelValue: (x, y, b) => 1000 * b + x + 20 * y,
    ...options,
  });
  const source = new LocalRasterFileSource(new Blob([raw as Uint8Array<ArrayBuffer>]));
  const tiff = await GeoTIFF.fromSource(source, { cache: false });
  const image = await tiff.getImage();
  source.beginRead();
  return { source, image };
}
describe('exact uncompressed strip windows', () => {
  for (const bits of [8, 16, 32] as const)
    for (const bigTiff of [false, true])
      it(`${bits} bits / BigTIFF ${bigTiff}: matches original values and only reads requested columns`, async () => {
        const { image, source } = await open({ bits, bigTiff });
        const request = { level: 0, window: [51, 2, 68, 11] as const, samples: [2, 0] };
        const expected = await image.readRasters({
          window: [...request.window],
          samples: [...request.samples],
          interleave: false,
        });
        const bytes = source.getDiagnostics().readBytes;
        const actual = await readNumericWindow(image, request);
        expect(actual.data).toEqual(Array.from(expected));
        expect(source.getDiagnostics().readBytes - bytes).toBe((17 * 9 * 3 * bits) / 8);
        await source.close();
      });
  it('keeps compressed, planar, opposite-endian and predicted images on the existing path', async () => {
    const request = { level: 0, window: [1, 1, 5, 5] as const, samples: [0, 1, 2] };
    const a = await open({ compression: 'deflate' });
    expect(await readUncompressedStripWindow(a.image, request)).toBeNull();
    await a.source.close();
    const b = await open();
    b.image.planarConfiguration = 2;
    expect(await readUncompressedStripWindow(b.image, request)).toBeNull();
    b.image.planarConfiguration = 1;
    b.image.littleEndian = !b.image.littleEndian;
    expect(await readUncompressedStripWindow(b.image, request)).toBeNull();
    b.image.littleEndian = !b.image.littleEndian;
    const fd = b.image.getFileDirectory(),
      load = fd.loadValue.bind(fd);
    vi.spyOn(fd, 'loadValue').mockImplementation((tag: any) =>
      tag === 'Predictor' ? Promise.resolve(2) : load(tag),
    );
    expect(await readUncompressedStripWindow(b.image, request)).toBeNull();
    await b.source.close();
  });
  it('rejects cancelled and truncated exact reads; does not leave tasks active', async () => {
    const { image, source } = await open();
    await expect(
      readUncompressedStripWindow(
        image,
        { level: 0, window: [1, 1, 8, 8], samples: [0] },
        AbortSignal.abort(),
      ),
    ).rejects.toThrow();
    await expect(
      source.fetchPackedRanges([{ offset: source.fileSize - 4, length: 8 }]),
    ).rejects.toThrow('truncated');
    await source.close();
    await expect(source.fetchPackedRanges([{ offset: 0, length: 8 }])).rejects.toThrow('closed');
  });
  it('handles many noncontiguous strips with exact row offsets', async () => {
    const pixels = Uint16Array.from({ length: 5 * 4 * 3 }, (_, i) => i + 1),
      prefix = new Uint8Array(24);
    const source = new LocalRasterFileSource(new Blob([prefix, pixels]));
    source.beginRead();
    const fake = {
      source,
      isTiled: false,
      planarConfiguration: 1,
      littleEndian: true,
      getFileDirectory: () => ({
        hasTag: () => true,
        getValue: () => 1,
        loadValue: async (t: string) =>
          t === 'Predictor' ? 1 : t === 'StripOffsets' ? [24, 72] : [48, 72],
      }),
      getBitsPerSample: () => 16,
      getSampleFormat: () => 1,
      getSamplesPerPixel: () => 3,
      getWidth: () => 4,
      getHeight: () => 5,
      getTileHeight: () => 2,
      getBlockHeight: (s: number) => (s === 2 ? 1 : 2),
      getArrayForSample: (_: number, n: number | ArrayBuffer) =>
        typeof n === 'number' ? new Uint16Array(n) : new Uint16Array(n),
    };
    // Two full rows per strip; third strip is shorter.
    fake.getFileDirectory = () => ({
      hasTag: () => true,
      getValue: () => 1,
      loadValue: async (t: string) =>
        t === 'Predictor' ? 1 : t === 'StripOffsets' ? [24, 72, 120] : [48, 48, 24],
    });
    const r = await readUncompressedStripWindow(fake as any, {
      level: 0,
      window: [1, 1, 3, 5],
      samples: [2, 0],
    });
    expect([...r!.data[0]]).toEqual([18, 21, 30, 33, 42, 45, 54, 57]);
    expect(source.getDiagnostics().readBytes).toBe(48);
    await source.close();
  });
});
