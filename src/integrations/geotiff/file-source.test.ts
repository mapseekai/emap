import { describe, expect, it, vi } from 'vitest';
import { LocalRasterFileSource, validateTiffDirectory } from './file-source';
import { makeRasterFixture } from '../../../test/utils/raster-fixture';

describe('bounded local range source', () => {
  it('slices only the requested bytes and never reads the original blob in full', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
    const read = vi.spyOn(blob, 'arrayBuffer'),
      slice = vi.spyOn(blob, 'slice');
    const source = new LocalRasterFileSource(blob);
    const [bytes] = await source.fetch([{ offset: 1, length: 2 }]);
    expect(Array.from(new Uint8Array(bytes))).toEqual([2, 3]);
    expect(slice).toHaveBeenCalledWith(1, 3);
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects invalid offsets, excessive reads and closed/aborted sources', async () => {
    const source = new LocalRasterFileSource(new Blob([new Uint8Array(8)]));
    for (const range of [
      { offset: -1, length: 1 },
      { offset: 0.5, length: 1 },
      { offset: NaN, length: 1 },
      { offset: 8, length: 1 },
      { offset: 0, length: 65 * 1024 ** 2 },
    ])
      await expect(source.fetch([range])).rejects.toThrow();
    const c = new AbortController();
    c.abort();
    await expect(source.fetch([{ offset: 0, length: 1 }], c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await source.close();
    await expect(source.fetch([{ offset: 0, length: 1 }])).rejects.toThrow(/SOURCE_CLOSED/);
  });
  it('allows a 256MiB cumulative strip budget without allowing a single range above 64MiB', async () => {
    const blob = new Blob([new Uint8Array(1)]);
    Object.defineProperty(blob, 'size', { value: 512 * 1024 ** 2 });
    const source = new LocalRasterFileSource(blob);
    source.beginRead(256 * 1024 ** 2);
    for (let i = 0; i < 6; i++)
      await source.fetch([{ offset: i * 40 * 1024 ** 2, length: 40 * 1024 ** 2 }]);
    await expect(
      source.fetch([{ offset: 6 * 40 * 1024 ** 2, length: 40 * 1024 ** 2 }]),
    ).rejects.toThrow(/RASTER_IO_BUDGET/);
    source.beginRead(256 * 1024 ** 2);
    await expect(source.fetch([{ offset: 0, length: 65 * 1024 ** 2 }])).rejects.toThrow(
      /RASTER_IO_BUDGET/,
    );
    expect(() => source.beginRead(256 * 1024 ** 2 + 1)).toThrow(/64–256MiB/);
    await source.close();
  });
  it('guards malicious directory entry counts before decoder allocations', async () => {
    const bytes = makeRasterFixture();
    new DataView(bytes.buffer).setUint16(8, 65535, true);
    const source = new LocalRasterFileSource(new Blob([bytes]));
    await expect(validateTiffDirectory(source, 8, true, false)).rejects.toThrow(
      /TIFF_DIRECTORY_BUDGET/,
    );
  });
  it('rejects TIFF tags whose array pointers extend outside the original file', async () => {
    const bytes = makeRasterFixture();
    const view = new DataView(bytes.buffer);
    const count = view.getUint16(8, true);
    for (let i = 0; i < count; i++) {
      const p = 10 + i * 12;
      if (view.getUint16(p, true) === 33550) view.setUint32(p + 8, bytes.length + 100, true);
    }
    await expect(
      validateTiffDirectory(new LocalRasterFileSource(new Blob([bytes])), 8, true, false),
    ).rejects.toThrow(/INVALID_TIFF_OFFSET/);
  });
  it('drops its strong Blob reference on close', async () => {
    const source = new LocalRasterFileSource(new Blob([new Uint8Array(16)]));
    await source.close();
    expect(Reflect.get(source, 'file')).toBeNull();
  });
  it('coalesces neighboring pixel-range reads into bounded pages and preserves exact bytes', async () => {
    const input = Uint8Array.from({ length: 200000 }, (_, i) => i % 251),
      blob = new Blob([input]);
    const slice = vi.spyOn(blob, 'slice'),
      source = new LocalRasterFileSource(blob);
    source.beginRead();
    const values = await Promise.all([
      source.fetch([{ offset: 100, length: 200 }]),
      source.fetch([{ offset: 300, length: 400 }]),
    ]);
    expect(slice).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(values[0][0])).toEqual(input.slice(100, 300));
    const [cross] = await source.fetch([{ offset: 65000, length: 2000 }]);
    expect(new Uint8Array(cross)).toEqual(input.slice(65000, 67000));
    expect(slice).toHaveBeenCalledTimes(2);
    const [tail] = await source.fetch([{ offset: 199990, length: 50 }]);
    expect(tail.byteLength).toBe(10);
    await source.close();
    expect(Reflect.get(source, 'pages').size).toBe(0);
    expect(Reflect.get(source, 'pendingPages').size).toBe(0);
  });
  it('limits retained compressed pages instead of caching the entire local file', async () => {
    const source = new LocalRasterFileSource(new Blob([new Uint8Array(2 * 1024 ** 2)]));
    source.beginRead();
    for (let i = 0; i < 30; i++) await source.fetch([{ offset: i * 65536, length: 1 }]);
    const pages = Reflect.get(source, 'pages') as Map<number, ArrayBuffer>;
    expect(pages.size).toBe(16);
    expect([...pages.values()].reduce((sum, p) => sum + p.byteLength, 0)).toBe(1024 ** 2);
    await source.close();
    expect(pages.size).toBe(0);
  });
  it('bounds page read concurrency under a large upstream fanout', async () => {
    const blob = new Blob([new Uint8Array(40 * 65536)]),
      slice = blob.slice.bind(blob);
    let active = 0,
      peak = 0;
    vi.spyOn(blob, 'slice').mockImplementation((start, end, type) => {
      const part = slice(start, end, type),
        read = part.arrayBuffer.bind(part);
      vi.spyOn(part, 'arrayBuffer').mockImplementation(async () => {
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return await read();
        } finally {
          active--;
        }
      });
      return part;
    });
    const source = new LocalRasterFileSource(blob);
    source.beginRead();
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => source.fetch([{ offset: i * 65536, length: 1 }])),
    );
    expect(peak).toBeLessThanOrEqual(16);
    expect(Reflect.get(source, 'pendingPages').size).toBe(0);
    await source.close();
  });
  it('rejects a truncated backing blob instead of looping over an empty page', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    Object.defineProperty(blob, 'size', { value: 65536 });
    const source = new LocalRasterFileSource(blob);
    source.beginRead();
    await expect(source.fetch([{ offset: 16, length: 1 }])).rejects.toThrow('TRUNCATED_TIFF_RANGE');
    await source.close();
  });
});

describe('compressed-page cancellation and release', () => {
  it('does not let one cancelled consumer poison a shared page', async () => {
    const blob = new Blob([new Uint8Array(65536).fill(23)]),
      nativeSlice = blob.slice.bind(blob);
    let release!: () => void;
    vi.spyOn(blob, 'slice').mockImplementation((...args) => {
      const part = nativeSlice(...args),
        read = part.arrayBuffer.bind(part);
      vi.spyOn(part, 'arrayBuffer').mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return read();
      });
      return part;
    });
    const source = new LocalRasterFileSource(blob),
      controller = new AbortController();
    source.beginRead();
    const first = source.fetch([{ offset: 1, length: 16 }], controller.signal);
    const second = source.fetch([{ offset: 20, length: 16 }]);
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    release();
    await cancelled;
    expect(new Uint8Array((await second)[0])).toEqual(new Uint8Array(16).fill(23));
    expect(blob.slice).toHaveBeenCalledTimes(1);
    expect(Reflect.get(source, 'pendingPages').size).toBe(0);
    await source.close();
    expect(Reflect.get(source, 'pages').size).toBe(0);
  });
});
