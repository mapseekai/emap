import type { RasterSource } from '../../src/domain/raster/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeRasterLayer } from '../../packages/examples/src/luma-raster/native-layer';
import { AffineTransform } from '../../src/domain/geo/transform';
import { registerPerformanceSource } from '../../packages/examples/src/performance-monitor';

// These cache contracts run without a browser; the monitor's DOM lifecycle is tested separately.
vi.mock('../../packages/examples/src/performance-monitor', () => ({
  registerPerformanceSource: vi.fn(() => vi.fn()),
}));

// Small structural fixtures are only lifecycle contracts, never performance evidence.
const metadata = {
  filename: 'contract',
  fileSize: 1,
  lastModified: 0,
  crs: 'EPSG:32651',
  origin: [0, 1024],
  resolution: [1, -1],
  bounds: [0, 0, 1024, 1024],
  noData: 0,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 1024,
      height: 1024,
      tileWidth: 256,
      tileHeight: 256,
      samples: 3,
      bits: [16, 16, 16],
      formats: [1, 1, 1],
      photometric: 1,
      subfileType: 0,
    },
  ],
};
function setup(width = 1024, height = 1024) {
  const source = {
    metadata: {
      ...metadata,
      origin: [0, height],
      bounds: [0, 0, width, height],
      levels: metadata.levels.map((l) => ({ ...l, width, height })),
    },
    dispose: vi.fn(),
    readWindow: vi.fn<RasterSource['readWindow']>(async (r) => ({
      width: r.window[2] - r.window[0],
      height: r.window[3] - r.window[1],
      data: Array.from(
        { length: 3 },
        () => new Uint16Array((r.window[2] - r.window[0]) * (r.window[3] - r.window[1])),
      ),
    })),
  };
  let lose!: () => void;
  const gpu = {
    recreate: vi.fn(),
    available: true,
    lost: new Promise<void>((resolve) => {
      lose = resolve;
    }),
    canvas: { ownerDocument: {} },
    stats: { liveTextureBytes: 0, textureUploads: 0 },
    upload: vi.fn((tile: any, _r: any) => {
      const bytes = (tile.window[2] - tile.window[0]) * (tile.window[3] - tile.window[1]) * 8;
      gpu.stats.liveTextureBytes += bytes;
      gpu.stats.textureUploads++;
      return { tile, bytes };
    }),
    release: vi.fn((e: any) => {
      gpu.stats.liveTextureBytes -= e.bytes;
    }),
    draw: vi.fn(),
    dispose: vi.fn(),
  };
  const report = vi.fn(),
    invalidate = vi.fn(),
    layer = new NativeRasterLayer(source as any, gpu as any, invalidate, report);
  return { layer, source, gpu, report, invalidate, lose };
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => vi.unstubAllGlobals());
describe('dynamic native raster cache lifecycle', () => {
  it('keeps a source open and reuses loaded textures on view/style-only redraws', async () => {
    const { layer, source, gpu } = setup(),
      v = new AffineTransform(1, -1, 0, 1024);
    layer.update(v, 120, 120, 1);
    await vi.waitFor(() => expect(layer.ready).toBe(true));
    const uploads = gpu.stats.textureUploads,
      reads = source.readWindow.mock.calls.length;
    v.translate(-10, 0);
    layer.update(v, 120, 120, 1);
    await vi.waitFor(() => expect(layer.ready).toBe(true));
    layer.draw(v, 120, 120, 1, { stretch: 'minmax', opacity: 0.5 });
    expect(gpu.stats.textureUploads).toBe(uploads);
    expect(source.readWindow).toHaveBeenCalledTimes(reads);
    expect(source.dispose).not.toHaveBeenCalled();
    layer.dispose();
    layer.dispose();
    const unregister = vi.mocked(registerPerformanceSource).mock.results.at(-1)!.value;
    expect(unregister).toHaveBeenCalledOnce();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(gpu.stats.liveTextureBytes).toBe(0);
  });
  it('pauses new reads during gestures, resumes, and never installs a disposed late result', async () => {
    const { layer, source, gpu } = setup();
    let resolve: any;
    source.readWindow.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    layer.setInteracting(true);
    layer.update(new AffineTransform(1, -1, 0, 1024), 120, 120, 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(source.readWindow).not.toHaveBeenCalled();
    layer.setInteracting(false);
    await vi.waitFor(() => expect(source.readWindow).toHaveBeenCalledOnce());
    const signal = source.readWindow.mock.calls[0][1];
    if (!signal) throw new Error('Expected raster cancellation signal');
    layer.dispose();
    expect(signal.aborted).toBe(true);
    resolve({ width: 257, height: 257, data: [new Uint16Array(257 * 257)] });
    await new Promise((r) => setTimeout(r, 10));
    expect(gpu.upload).not.toHaveBeenCalled();
  });
  it('does not replay obsolete requested blocks into a new viewport', async () => {
    const { layer, source, gpu } = setup();
    const original = source.readWindow.getMockImplementation()!,
      promises: { resolve: () => Promise<void>; signal: AbortSignal }[] = [];
    source.readWindow.mockImplementation(
      (request: any, signal: any) =>
        new Promise((resolve) => {
          promises.push({ resolve: async () => resolve(await original(request)), signal });
        }),
    );
    layer.update(new AffineTransform(1, -1, 0, 1024), 120, 120, 1);
    await vi.waitFor(() => expect(promises).toHaveLength(1));
    layer.update(new AffineTransform(1, -1, -800, 1024), 120, 120, 1);
    expect(promises[0].signal.aborted).toBe(true);
    await promises[0].resolve();
    await vi.waitFor(() => expect(promises.length).toBeGreaterThan(1));
    await promises[1].resolve();
    await vi.waitFor(() => expect(layer.ready).toBe(true));
    expect(gpu.upload.mock.calls.every(([t]: any) => t.key === '0:1:0')).toBe(true);
    layer.dispose();
  });
});

it('combines neighboring halo windows into one bounded read without changing texture extents', async () => {
  const { layer, source, gpu } = setup();
  layer.update(new AffineTransform(1, -1, 0, 1024), 1024, 120, 1);
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  expect(gpu.upload).toHaveBeenCalledTimes(2);
  expect(source.readWindow).toHaveBeenCalledTimes(1);
  expect(source.readWindow.mock.calls[0][0].window).toEqual([0, 0, 1024, 513]);
  layer.dispose();
});

it('publishes ready rectangles before the remaining view is loaded', async () => {
  const { layer, source, gpu } = setup(1024, 1536);
  const original = source.readWindow.getMockImplementation()!;
  const pending: { request: any; resolve: () => Promise<void> }[] = [];
  source.readWindow.mockImplementation(
    (request: any) =>
      new Promise((resolve) => {
        pending.push({ request, resolve: async () => resolve(await original(request)) });
      }),
  );
  const view = new AffineTransform(1, -1, 0, 1536);
  layer.update(view, 1024, 1536, 1);
  await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
  await pending[0].resolve();
  await vi.waitFor(() => expect(gpu.upload).toHaveBeenCalledTimes(4));
  expect(layer.ready).toBe(false);
  layer.draw(view, 1024, 1536, 1, {});
  expect(gpu.draw.mock.calls.at(-1)![0]).toHaveLength(4);
  expect(layer.stats.visible).toBe(4);
  await pending[1].resolve();
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  layer.dispose();
});

it('does not upload a completed read during an active gesture', async () => {
  const { layer, source, gpu } = setup();
  const original = source.readWindow.getMockImplementation()!;
  let finish: () => Promise<void> = async () => {};
  source.readWindow.mockImplementation(
    (r: any) =>
      new Promise((resolve) => {
        finish = async () => resolve(await original(r));
      }),
  );
  layer.update(new AffineTransform(1, -1, 0, 1024), 120, 120, 1);
  await vi.waitFor(() => expect(source.readWindow).toHaveBeenCalledOnce());
  layer.setInteracting(true);
  await finish();
  await new Promise((r) => setTimeout(r, 20));
  expect(gpu.upload).not.toHaveBeenCalled();
  layer.setInteracting(false);
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  expect(gpu.upload).toHaveBeenCalledOnce();
  layer.dispose();
});

it('replaces parent coverage as children arrive without any overlapping opacity', async () => {
  const { layer, source, gpu } = setup(1024, 1536);
  (source.metadata as any).levels.push({
    ...metadata.levels[0],
    id: 1,
    width: 256,
    height: 384,
    tileWidth: 128,
    tileHeight: 128,
  });
  const far = new AffineTransform(0.125, -0.125, 0, 192);
  layer.update(far, 128, 192, 1);
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  const original = source.readWindow.getMockImplementation()!;
  const done: (() => Promise<void>)[] = [];
  source.readWindow.mockImplementation(
    (r: any) =>
      new Promise((resolve) => {
        done.push(async () => resolve(await original(r)));
      }),
  );
  const near = new AffineTransform(1, -1, 0, 1536);
  layer.update(near, 1024, 1536, 1);
  await vi.waitFor(() => expect(done).toHaveLength(2));
  await done[0]();
  await vi.waitFor(() => expect(layer.stats.pending).toBe(2));
  layer.draw(near, 1024, 1536, 1, { opacity: 0.5 });
  const regions = [...(gpu.draw.mock.calls.at(-1)![7] as Map<string, number[][]>).values()].flat();
  for (let i = 0; i < regions.length; i++)
    for (let j = 0; j < i; j++) {
      const a = regions[i],
        b = regions[j];
      expect(
        Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
          Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])),
      ).toBe(0);
    }
  expect(regions.reduce((sum, r) => sum + (r[2] - r[0]) * (r[3] - r[1]), 0)).toBe(1024 * 1536);
  await done[1]();
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  layer.dispose();
  (source.metadata as any).levels.pop();
});

it('stays stopped after a source error and releases its resources on disposal', async () => {
  const { layer, source, gpu, report } = setup(1024, 1536);
  source.readWindow.mockRejectedValue(new Error('read failed'));
  layer.update(new AffineTransform(1, -1, 0, 1536), 1024, 1536, 1);
  await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
  const calls = source.readWindow.mock.calls.length;
  layer.setInteracting(false);
  await new Promise((r) => setTimeout(r, 20));
  expect(source.readWindow).toHaveBeenCalledTimes(calls);
  expect(gpu.upload).not.toHaveBeenCalled();
  expect(layer.ready).toBe(false);
  layer.dispose();
  expect(source.dispose).toHaveBeenCalledOnce();
});

it('falls back to the bounded raw reader when a nonaligned texture exceeds the packed-output cap', async () => {
  const { layer, source, gpu, report } = setup(3072, 3072);
  Object.assign(source.metadata.levels[0], { tileWidth: 1536, tileHeight: 1536 });
  const packed = vi.fn();
  Object.assign(source, { readTexture: packed });
  const view = new AffineTransform(1, -1, -100, 2972);
  layer.update(view, 120, 120, 1);
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  expect(source.readWindow).toHaveBeenCalledOnce();
  expect(packed).not.toHaveBeenCalled();
  expect(gpu.upload).toHaveBeenCalledOnce();
  expect(report).not.toHaveBeenCalled();
  layer.dispose();
});

it('recovers the GPU without reopening the source or uploading an obsolete read', async () => {
  const { layer, source, gpu, lose, invalidate, report } = setup();
  const replacement = {
    ...gpu,
    lost: new Promise<void>(() => {}),
    upload: vi.fn(gpu.upload),
    dispose: vi.fn(),
  };
  let restore!: (value: any) => void;
  gpu.recreate.mockImplementation(
    () =>
      new Promise((resolve) => {
        restore = resolve;
      }),
  );
  const original = source.readWindow.getMockImplementation()!;
  let finish!: () => Promise<void>;
  source.readWindow.mockImplementationOnce(
    (r: any) =>
      new Promise((resolve) => {
        finish = async () => resolve(await original(r));
      }),
  );
  const view = new AffineTransform(1, -1, 0, 1024);
  layer.update(view, 120, 120, 1);
  await vi.waitFor(() => expect(source.readWindow).toHaveBeenCalledOnce());
  lose();
  await vi.waitFor(() => expect(gpu.recreate).toHaveBeenCalledOnce());
  expect(source.readWindow.mock.calls[0][1]?.aborted).toBe(true);
  expect(layer.ready).toBe(false);
  await finish();
  layer.update(view, 120, 120, 1);
  expect(gpu.upload).not.toHaveBeenCalled();
  expect(source.readWindow).toHaveBeenCalledOnce();
  restore(replacement);
  await vi.waitFor(() => expect(layer.gpu).toBe(replacement));
  expect(invalidate).toHaveBeenCalled();
  layer.update(view, 120, 120, 1);
  await vi.waitFor(() => expect(layer.ready).toBe(true));
  expect(replacement.upload).toHaveBeenCalledOnce();
  expect(source.dispose).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
  layer.dispose();
  expect(replacement.dispose).toHaveBeenCalledOnce();
});

it('destroys a replacement delivered after disposal and cancels recovery', async () => {
  const { layer, gpu, lose, invalidate, report } = setup();
  const next = { dispose: vi.fn() };
  let restore!: (value: any) => void;
  gpu.recreate.mockImplementation(
    () =>
      new Promise((resolve) => {
        restore = resolve;
      }),
  );
  lose();
  await vi.waitFor(() => expect(gpu.recreate).toHaveBeenCalledOnce());
  layer.dispose();
  expect(gpu.recreate.mock.calls[0][0].aborted).toBe(true);
  restore(next);
  await vi.waitFor(() => expect(next.dispose).toHaveBeenCalledOnce());
  expect(invalidate).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

it('reports recovery failure once and stops scheduling reads', async () => {
  const { layer, source, gpu, lose, report } = setup();
  gpu.recreate.mockRejectedValue(new Error('replacement unavailable'));
  lose();
  await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
  layer.update(new AffineTransform(1, -1, 0, 1024), 120, 120, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(source.readWindow).not.toHaveBeenCalled();
  expect(gpu.recreate).toHaveBeenCalledOnce();
  layer.dispose();
});
