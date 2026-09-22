import { describe, it, expect } from 'vitest';
import { packRasterWindow } from './raster-packing';
describe('UInt16 texture packing from a shared read', () => {
  it.each([
    1, 2, 3, 4,
  ])('preserves all %i channels, high values, and correct row stride', (count) => {
    const data = Array.from({ length: count }, (_, b) =>
      Uint16Array.from([0, 1, 255, 256, 65535, 32768, 1024, 7, 8, 9, 10, 11].map((v) => v - b)),
    );
    const before = data.map((a) => a.slice());
    const out = packRasterWindow(
      { width: 4, height: 3, data },
      [100, 200, 104, 203],
      [101, 201, 104, 203],
    );
    expect(out).toHaveLength(3 * 2 * 4);
    [5, 6, 7, 9, 10, 11].forEach((source, pixel) => {
      for (let b = 0; b < 4; b++) expect(out[pixel * 4 + b]).toBe(data[b]?.[source] ?? 0);
    });
    expect(data).toEqual(before);
  });
  it('rejects mismatched stride, unsupported sample types and out-of-read windows', () => {
    const result = { width: 4, height: 4, data: [new Uint16Array(16)] };
    expect(() => packRasterWindow(result, [0, 0, 4, 4], [1, 0, 5, 3])).toThrow();
    expect(() => packRasterWindow({ ...result, width: 3 }, [0, 0, 4, 4], [0, 0, 2, 2])).toThrow();
    expect(() =>
      packRasterWindow({ ...result, data: [new Int8Array(16)] }, [0, 0, 4, 4], [0, 0, 2, 2]),
    ).toThrow();
  });
  it('reuses caller-owned storage and clears missing channels without touching original samples', () => {
    const data = [new Uint16Array([65535, 256])];
    const target = new Uint16Array(8).fill(123);
    expect(
      packRasterWindow({ width: 2, height: 1, data }, [0, 0, 2, 1], [0, 0, 2, 1], target),
    ).toBe(target);
    expect(Array.from(target)).toEqual([65535, 0, 0, 0, 256, 0, 0, 0]);
    expect(Array.from(data[0])).toEqual([65535, 256]);
    expect(() =>
      packRasterWindow(
        { width: 2, height: 1, data },
        [0, 0, 2, 1],
        [0, 0, 2, 1],
        new Uint16Array(4),
      ),
    ).toThrow();
  });
  it('rejects packing storage that aliases original raster values', () => {
    const buffer = new ArrayBuffer(16);
    const data = [new Uint16Array(buffer, 0, 2)];
    expect(() =>
      packRasterWindow(
        { width: 2, height: 1, data },
        [0, 0, 2, 1],
        [0, 0, 2, 1],
        new Uint16Array(buffer),
      ),
    ).toThrow();
  });
});

it('preserves UInt8 storage rather than widening it to UInt16', () => {
  const a = new Uint8Array([0, 127, 128, 255]);
  const r = packRasterWindow({ width: 2, height: 2, data: [a] }, [0, 0, 2, 2], [0, 0, 2, 2]);
  expect(r).toBeInstanceOf(Uint8Array);
  expect(Array.from(r)).toEqual([0, 0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0, 0]);
  expect(r.byteLength).toBe(16);
});
