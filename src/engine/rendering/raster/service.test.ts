import type { RenderPass } from '../../../runtime/services/contracts/render-pass';
import { AffineTransform } from '../../../domain/geo/transform';
import type { RenderFrame } from '../../../runtime/services/contracts/render-pass';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RasterRenderService } from './service';
import { GeoTIFFReader } from '../../../integrations/geotiff/reader';
import { makeRasterFixture } from '../../../../test/utils/raster-fixture';
async function source() {
  return GeoTIFFReader.open(new File([makeRasterFixture()], 'test.tif', { lastModified: 12 }));
}
const deps = () => ({ getCRS: () => 'EPSG:4326', requestRender: vi.fn(), reportError: vi.fn() });

describe('raster service contracts', () => {
  it('owns independent raster order, source disposal and reference-only serialization', async () => {
    const d = deps(),
      service = new RasterRenderService(d),
      a = await source(),
      b = await source();
    const disposeA = vi.spyOn(a, 'dispose');
    service.addSource('a', a);
    service.addSource('b', b);
    expect(service.getLayers().map((l) => l.id)).toEqual(['a', 'b']);
    service.moveLayer('a');
    expect(service.getLayers().map((l) => l.id)).toEqual(['b', 'a']);
    service.moveLayer('a', 'b');
    expect(service.getLayers().map((l) => l.id)).toEqual(['a', 'b']);
    service.setVisibility('b', false);
    service.setStyle('a', { opacity: 0.25 });
    const refs = service.toReferences();
    expect(refs[0].style.opacity).toBe(0.25);
    expect(refs[1].visible).toBe(false);
    expect(JSON.stringify(refs)).not.toMatch(/samples|Blob|palette|levels|data/);
    expect(await service.queryPixel('a', 116.005, 39.995)).toEqual([180, 0, 0]);
    expect(await service.queryPixel('a', 0, 0)).toBeNull();
    service.remove('a');
    expect(disposeA).toHaveBeenCalledTimes(1);
    service.dispose();
    service.dispose();
    expect(service.getLayers()).toEqual([]);
    expect(service.getStats().cachedBytes).toBe(0);
  });
  it('registers and releases one source-scoped render pass per raster layer', async () => {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const registerLayerPass = vi.fn((_id: string, _pass: RenderPass) => {
      const release = vi.fn();
      releases.push(release);
      return release;
    });
    const service = new RasterRenderService({ ...deps(), registerLayerPass });
    service.addSource('a', await source());
    service.addSource('b', await source());
    expect(registerLayerPass.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);

    service.moveLayer('a');
    expect(releases.slice(0, 2).every((release) => release.mock.calls.length === 1)).toBe(true);
    expect(registerLayerPass.mock.calls.slice(2).map(([id]) => id)).toEqual(['b', 'a']);

    service.remove('b');
    expect(releases[2]).toHaveBeenCalledTimes(1);
    service.dispose();
    expect(releases[3]).toHaveBeenCalledTimes(1);
  });

  it('validates ids, budgets and style before acquiring source ownership', async () => {
    for (const options of [
      { cacheBytes: 0 },
      { concurrency: 0 },
      { concurrency: 100 },
      { presentationInterval: -1 },
      { presentationInterval: 251 },
      { presentationInterval: NaN },
    ])
      expect(() => new RasterRenderService(deps(), options)).toThrow();
    const service = new RasterRenderService(deps()),
      a = await source();
    expect(() => service.addSource('', a)).toThrow();
    expect(() => service.addSource('a', a, { opacity: 3 })).toThrow();
    service.addSource('a', a);
    expect(() => service.addSource('a', a)).toThrow();
    expect(() => service.moveLayer('a', 'unknown')).toThrow();
    expect(service.getLayers().map((l) => l.id)).toEqual(['a']);
    service.dispose();
  });
  it('returns cloned styles so caller mutation cannot bypass invalidation', async () => {
    const service = new RasterRenderService(deps()),
      bands = [0],
      style = { bands };
    service.addSource('a', await source(), style);
    bands[0] = 99;
    expect(service.getLayers()[0].style.bands).toEqual([0]);
    const returned = service.getLayers()[0].style.bands as number[];
    returned[0] = 99;
    expect(service.getLayers()[0].style.bands).toEqual([0]);
    service.dispose();
  });
  it('clears inherited channel ranges when switching bands but honors explicit replacement ranges', async () => {
    const service = new RasterRenderService(deps()),
      raster = await source();
    service.addSource('a', raster, {
      bands: [0, 1, 2],
      ranges: [
        [0, 255],
        [0, 200],
        [0, 100],
      ],
    });
    service.setStyle('a', { bands: [1] });
    expect(service.getLayers()[0].style.bands).toEqual([1]);
    expect(service.getLayers()[0].style.ranges).toBeUndefined();
    service.setStyle('a', {
      bands: [0, 1, 2],
      ranges: [
        [0, 255],
        [0, 200],
        [0, 100],
      ],
    });
    expect(service.getLayers()[0].style.ranges).toHaveLength(3);
    expect(service.toReferences()[0].style.bands).toEqual([0, 1, 2]);
    service.dispose();
  });
});

describe('settled, progressive raster frames', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function harness(
    size = 256,
    cacheBytes = 64 * 1024 ** 2,
    presentationInterval = 0,
    pixels = false,
  ) {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const canvases: Array<{
      width: number;
      height: number;
      style: object;
      getContext: () => object;
    }> = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          style: {},
          getContext: () => ({
            putImageData: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            beginPath: vi.fn(),
            rect: vi.fn(),
            clip: vi.fn(),
            drawImage: vi.fn(),
          }),
        };
        canvases.push(canvas);
        return canvas;
      },
    });
    const original = await source(),
      service = new RasterRenderService(deps(), {
        settleDelay: 150,
        cacheBytes,
        presentationInterval,
      });
    const read = vi.spyOn(original, 'readWindow');
    service.addSource('test', original);
    const painter = {
      drawRasterImage: vi.fn(),
      ...(pixels ? { drawRasterPixels: vi.fn() } : {}),
    } as unknown as RenderFrame['painter'];
    const frame: RenderFrame = {
      width: size,
      height: size,
      pixelRatio: 1,
      painter,
      transform: new AffineTransform(
        size / 0.08,
        -size / 0.08,
        (-116 * size) / 0.08,
        (40 * size) / 0.08,
      ),
    };
    service.render(frame);
    await vi.advanceTimersByTimeAsync(100);
    expect(service.getStats().pendingFrames).toBe(0);
    service.render(frame);
    expect(pixels ? painter.drawRasterPixels : painter.drawRasterImage).toHaveBeenCalled();
    read.mockClear();
    vi.mocked(painter.drawRasterImage).mockClear();
    return { original, service, read, frame, painter, canvases };
  }
  it('GPU-capable painters retain exact owned RGBA snapshots with no Canvas cache copy', async () => {
    const { service, frame, painter, canvases, read } = await harness(512, 32 * 1024 ** 2, 0, true);
    const stats = service.getStats();
    expect(canvases).toHaveLength(0);
    expect(stats.pixelCacheBytes).toBe(stats.cachedBytes);
    expect(stats.canvasCacheBytes).toBe(0);
    expect(stats.performance.pixelPreparedTiles).toBeGreaterThan(0);
    expect(painter.drawRasterImage).not.toHaveBeenCalled();
    const before = stats.cachedBytes;
    service.render(frame);
    expect(read).not.toHaveBeenCalled();
    expect(service.getStats().cachedBytes).toBe(before);
    const backing = new Uint8ClampedArray(4096),
      rgba = backing.subarray(10, 34);
    rgba.set([123, 45, 67, 255]);
    const image = Reflect.get(service, 'prepareRasterImage').call(service, rgba, 3, 2) as ImageData;
    rgba.fill(0);
    expect(image.data.slice(0, 4)).toEqual(new Uint8ClampedArray([123, 45, 67, 255]));
    expect(image.data.buffer.byteLength).toBe(24);
    service.dispose();
    expect(service.getStats().cachedBytes).toBe(0);
    expect(service.getStats().pixelCacheBytes).toBe(0);
  });
  it('normalizes hidden RGB for NoData and keeps continuous-alpha tiles on the exact Canvas path', async () => {
    const { service, canvases } = await harness(256, 32 * 1024 ** 2, 0, true);
    const prepare = Reflect.get(service, 'prepareRasterImage').bind(service);
    const input = new Uint8ClampedArray([100, 50, 25, 0, 100, 50, 25, 255]);
    const binary = prepare(input, 2, 1) as ImageData;
    expect(binary.data).toEqual(new Uint8ClampedArray([0, 0, 0, 0, 100, 50, 25, 255]));
    expect(input[0]).toBe(100);
    input[3] = 128;
    const partial = prepare(input, 2, 1);
    expect('data' in partial).toBe(false);
    expect(canvases).toHaveLength(1);
    expect(service.getStats().performance.pixelAlphaFallbackTiles).toBe(1);
    partial.width = partial.height = 0;
    service.dispose();
  });
  it('switching to a custom Canvas-only painter converts and replaces pixel cache ownership', async () => {
    const { service, frame, canvases } = await harness(512, 32 * 1024 ** 2, 0, true);
    const before = service.getStats().cachedBytes;
    const drawRasterImage = vi.fn();
    service.render({ ...frame, painter: { drawRasterImage } as unknown as RenderFrame['painter'] });
    expect(drawRasterImage).toHaveBeenCalled();
    expect(canvases.length).toBeGreaterThan(0);
    expect(service.getStats().cachedBytes).toBe(before);
    expect(service.getStats().pixelCacheBytes).toBe(0);
    expect(service.getStats().canvasCacheBytes).toBe(before);
    service.dispose();
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });
  it('pressure fallback composites pixel tiles through temporary canvases without keeping duplicate cache copies', async () => {
    const { service, frame, canvases } = await harness(512, 32 * 1024 ** 2, 0, true);
    const before = service.getStats().pixelCacheBytes;
    const layer = Reflect.get(service, 'layers').get('test');
    const bounds = Reflect.get(service, 'displayed').get('test').bounds;
    Reflect.get(service, 'preparePresentation').call(service, layer, bounds, 'EPSG:4326', frame, 1);
    expect(canvases.length).toBeGreaterThan(1);
    expect(canvases.slice(1).every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(service.getStats().pixelCacheBytes).toBe(before);
    expect(service.getStats().canvasCacheBytes).toBeGreaterThan(0);
    service.dispose();
    expect(service.getStats().cachedBytes).toBe(0);
  });
  it('reports current tile grid separately from cumulative planned/rendered work', async () => {
    const { service, frame } = await harness(512, 32 * 1024 ** 2);
    const before = service.getStats();
    expect(before.planning).not.toBeNull();
    expect(before.planning?.viewportCss).toEqual([512, 512]);
    expect(before.planning?.displayTileSize).toBe(256);
    expect(before.planning?.tileBudgetPerLayer).toBe(64);
    const layer = before.planning?.layers[0];
    if (!layer) throw new Error('Missing planned raster layer');
    expect(layer?.tiles).toBeGreaterThan(0);
    expect(layer?.tiles).toBeLessThanOrEqual(64);
    expect(layer?.grid[0] * layer?.grid[1]).toBe(layer?.tiles);
    expect(layer?.selectedLevel).toBe(0);
    expect(layer?.selectedLevelSource).toBe('base');
    expect(layer?.selectedLevelSize).toEqual([8, 8]);
    expect(layer?.selectedLevelReduction).toBe(1);
    expect(layer?.sourcePixelsPerDisplayPixel?.[0]).toBeGreaterThan(0);
    expect(layer?.selectedLevels).toEqual([
      expect.objectContaining({
        level: 0,
        tiles: layer?.tiles,
        size: [8, 8],
        blockSize: [8, 8],
        reduction: 1,
        source: 'base',
      }),
    ]);
    const passes = before.performance.planningPasses;
    const planned = before.performance.plannedTiles;
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(2, 256, 256);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    const after = service.getStats();
    expect(after.performance.planningPasses).toBe(passes + 1);
    expect(after.performance.plannedTiles).toBeGreaterThan(planned);
    expect(after.planning?.layers[0].tiles).toBeLessThanOrEqual(64);
    service.dispose();
  });
  it('does not decode or replace the visible image while a wheel/drag gesture is active', async () => {
    const { service, read, frame, painter } = await harness();
    service.beginNavigation('pointer');
    service.viewChanged();
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(1.5, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(800);
    expect(read).not.toHaveBeenCalled();
    expect(painter.drawRasterImage).toHaveBeenCalled();
    service.endNavigation('pointer');
    await vi.advanceTimersByTimeAsync(160);
    service.render(next);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalled();
    service.dispose();
  });
  it('presents the first completed replacement while slower tiles retain old coverage', async () => {
    const { service, read, frame, painter } = await harness();
    const releases: Array<() => void> = [];
    read.mockImplementation(
      (request) =>
        new Promise((resolve) =>
          releases.push(() =>
            resolve({
              width: request.window[2] - request.window[0],
              height: request.window[3] - request.window[1],
              data: request.samples.map(() =>
                new Uint8Array(
                  (request.window[2] - request.window[0]) * (request.window[3] - request.window[1]),
                ).fill(100),
              ),
            }),
          ),
        ),
    );
    const before = service.getStats().committedFrames;
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(1.7, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    expect(service.getStats().pendingFrames).toBe(1);
    service.render(next);
    expect(painter.drawRasterImage).toHaveBeenCalled();
    expect(service.getStats().committedFrames).toBe(before);
    const oldImages = new Set(vi.mocked(painter.drawRasterImage).mock.calls.map((call) => call[0]));
    const presented = service.getStats().presentedTiles;
    expect(releases.length).toBeGreaterThan(1);
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(1);
    vi.mocked(painter.drawRasterImage).mockClear();
    service.render(next);
    const calls = vi.mocked(painter.drawRasterImage).mock.calls;
    expect(service.getStats().pendingFrames).toBe(1);
    expect(service.getStats().presentedTiles).toBe(presented + 1);
    expect(calls.some((call) => !oldImages.has(call[0]))).toBe(true);
    expect(calls.some((call) => oldImages.has(call[0]))).toBe(true);
    while (releases.length) {
      releases.shift()!();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(service.getStats().committedFrames).toBe(before + 1);
    expect(service.getStats().pendingFrames).toBe(0);
    service.dispose();
  });
  it('retains the previous frame when a replacement read fails', async () => {
    const { service, read, frame, painter } = await harness();
    const before = service.getStats().committedFrames;
    read.mockRejectedValue(new Error('simulated decoder failure'));
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(2, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(100);
    service.render(next);
    expect(service.getStats().committedFrames).toBe(before);
    expect(service.getStats().pendingFrames).toBe(0);
    expect(painter.drawRasterImage).toHaveBeenCalled();
    service.dispose();
  });
  it('debounces unbracketed view changes and releases pending timers on disposal', async () => {
    const { service, read, frame } = await harness();
    service.viewChanged();
    service.render(frame);
    await vi.advanceTimersByTimeAsync(100);
    service.viewChanged();
    service.render(frame);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).not.toHaveBeenCalled();
    expect(service.getStats().interacting).toBe(true);
    service.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(service.getStats().interacting).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it('changes opacity without new tile reads or discarding the committed batch', async () => {
    const { service, read, frame, painter } = await harness();
    const before = service.getStats().committedFrames;
    service.setStyle('test', { opacity: 0.4 });
    service.render(frame);
    await vi.advanceTimersByTimeAsync(50);
    expect(read).not.toHaveBeenCalled();
    expect(service.getStats().committedFrames).toBe(before);
    expect(vi.mocked(painter.drawRasterImage).mock.calls.every((call) => call[2] === 0.4)).toBe(
      true,
    );
    service.dispose();
  });
  it('does not let one failed tile cancel successfully completing siblings', async () => {
    const { service, read, frame } = await harness();
    const requests: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    read.mockImplementation(
      (request) =>
        new Promise((resolve, reject) =>
          requests.push({
            reject,
            resolve: () =>
              resolve({
                width: request.window[2] - request.window[0],
                height: request.window[3] - request.window[1],
                data: request.samples.map(() =>
                  new Uint8Array(
                    (request.window[2] - request.window[0]) *
                      (request.window[3] - request.window[1]),
                  ).fill(100),
                ),
              }),
          }),
        ),
    );
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(1.7, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    expect(requests.length).toBeGreaterThan(1);
    const presented = service.getStats().presentedTiles;
    requests.shift()!.reject(new Error('one corrupt block'));
    await vi.advanceTimersByTimeAsync(1);
    while (requests.length) {
      requests.shift()!.resolve();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(service.getStats().presentedTiles).toBeGreaterThan(presented);
    expect(service.getStats().pendingFrames).toBe(0);
    service.dispose();
  });
  it('keeps already presented patches while ignoring late replies from an interrupted zoom', async () => {
    const { service, read, frame, painter } = await harness();
    const releases: Array<() => void> = [];
    read.mockImplementation(
      (request) =>
        new Promise((resolve) =>
          releases.push(() =>
            resolve({
              width: request.window[2] - request.window[0],
              height: request.window[3] - request.window[1],
              data: request.samples.map(() =>
                new Uint8Array(
                  (request.window[2] - request.window[0]) * (request.window[3] - request.window[1]),
                ).fill(99),
              ),
            }),
          ),
        ),
    );
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(1.7, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(1);
    const presented = service.getStats().presentedTiles;
    service.beginNavigation('pointer');
    while (releases.length) {
      releases.shift()!();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(service.getStats().presentedTiles).toBe(presented);
    vi.mocked(painter.drawRasterImage).mockClear();
    service.render(next);
    expect(painter.drawRasterImage).toHaveBeenCalled();
    service.dispose();
  });
  it('compacts retained mixed generations under pressure without exceeding the cache budget', async () => {
    const budget = 8 * 1024 ** 2;
    const { service, read, frame, canvases } = await harness(800, budget);
    const releases: Array<() => void> = [];
    read.mockImplementation(
      (request) =>
        new Promise((resolve) =>
          releases.push(() =>
            resolve({
              width: request.window[2] - request.window[0],
              height: request.window[3] - request.window[1],
              data: request.samples.map(() =>
                new Uint8Array(
                  (request.window[2] - request.window[0]) * (request.window[3] - request.window[1]),
                ).fill(99),
              ),
            }),
          ),
        ),
    );
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(2.3, 400, 400);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(1);
    service.render(frame);
    await vi.advanceTimersByTimeAsync(20);
    expect(canvases.some((canvas) => canvas.width > 256 || canvas.height > 256)).toBe(true);
    expect(service.getStats().cachedBytes).toBeLessThanOrEqual(budget);
    while (releases.length) {
      releases.shift()!();
      await vi.advanceTimersByTimeAsync(1);
    }
    service.dispose();
    expect(service.getStats().cachedBytes).toBe(0);
  });
  it('finishes releasing every cache and source when one custom source dispose throws', async () => {
    const { service, original, canvases } = await harness();
    const second = await source();
    const closeSecond = vi.spyOn(second, 'dispose');
    service.addSource('second', second);
    vi.spyOn(original, 'dispose').mockImplementation(() => {
      throw new Error('custom close failure');
    });
    let error: unknown;
    try {
      service.dispose();
    } catch (failure) {
      error = failure;
    }
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(service.getLayers()).toHaveLength(0);
    expect(service.getStats().cachedBytes).toBe(0);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(error).toBeInstanceOf(AggregateError);
  });
  it('releases in-flight work on cancellation even when an external source ignores its signal', async () => {
    const { service, read, frame } = await harness();
    read.mockImplementation(() => new Promise(() => {}));
    const next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(2.3, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    expect(service.getStats().activeReads).toBeGreaterThan(0);
    service.beginNavigation('pointer');
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getStats().activeReads).toBe(0);
    expect(service.getStats().queuedReads).toBe(0);
    service.dispose();
  });
  it('groups readiness for 60ms without waiting for slow siblings, and clears timers on removal', async () => {
    const { service, read, frame } = await harness(256, 64 * 1024 ** 2, 60);
    const releases: Array<() => void> = [];
    read.mockImplementation(
      (request) =>
        new Promise((resolve) =>
          releases.push(() =>
            resolve({
              width: request.window[2] - request.window[0],
              height: request.window[3] - request.window[1],
              data: request.samples.map(() =>
                new Uint8Array(
                  (request.window[2] - request.window[0]) * (request.window[3] - request.window[1]),
                ).fill(100),
              ),
            }),
          ),
        ),
    );
    const before = service.getStats().presentedTiles,
      next = { ...frame, transform: frame.transform.clone() };
    next.transform.scale(1.7, 128, 128);
    service.render(next);
    await vi.advanceTimersByTimeAsync(20);
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(20);
    expect(service.getStats().presentedTiles).toBe(before);
    await vi.advanceTimersByTimeAsync(41);
    expect(service.getStats().presentedTiles).toBe(before + 1);
    expect(service.getStats().pendingFrames).toBe(1);
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(1);
    service.remove('test');
    await vi.advanceTimersByTimeAsync(100);
    expect(service.getStats().cachedBytes).toBe(0);
    expect(service.getStats().pendingFrames).toBe(0);
    service.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('batches row-striped sibling tiles by display grid row', async () => {
    const { service, original, read, frame } = await harness(800);
    Object.assign(original.metadata.levels[0], {
      tileWidth: original.metadata.levels[0].width,
      tileHeight: 1,
      decodedBlockConcurrency: 4,
    });
    const renderTiles = vi.fn(
      async (
        requests: readonly {
          width: number;
          height: number;
          read: { window: readonly [number, number, number, number] };
        }[],
      ) =>
        requests.map((request) => ({
          width: request.width,
          height: request.height,
          rgba: new Uint8ClampedArray(request.width * request.height * 4),
        })),
    );
    Object.assign(original, { renderTiles });
    read.mockRejectedValue(new Error('row-striped batch should not use the main-thread read path'));
    service.setStyle('test', { stretch: 'minmax' });
    service.render(frame);
    await vi.advanceTimersByTimeAsync(100);
    expect(renderTiles).toHaveBeenCalled();
    expect(renderTiles.mock.calls.some(([requests]) => requests.length > 1)).toBe(true);
    const sourceRows = renderTiles.mock.calls.map(([requests]) =>
      Math.min(...requests.map((request) => request.read.window[1])),
    );
    expect(new Set(sourceRows).size).toBeGreaterThan(1);
    expect(sourceRows).toEqual([...sourceRows].sort((a, b) => a - b));
    expect(read).not.toHaveBeenCalled();
    expect(service.getStats().taskLifecycle.loadTileFailed).toBe(0);
    service.dispose();
  });

  it('uses a provider-rendered RGBA tile instead of reading/colorizing samples on the main thread', async () => {
    const { service, original, read, frame } = await harness();
    const renderTile = vi.fn(async (request) => ({
      width: request.width,
      height: request.height,
      rgba: new Uint8ClampedArray(request.width * request.height * 4),
    }));
    Object.assign(original, { renderTile });
    read.mockRejectedValue(new Error('raw main-thread path should not run'));
    service.setStyle('test', { stretch: 'minmax' });
    service.render(frame);
    await vi.advanceTimersByTimeAsync(100);
    expect(renderTile).toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(service.getStats().pendingFrames).toBe(0);
    service.dispose();
  });
});
