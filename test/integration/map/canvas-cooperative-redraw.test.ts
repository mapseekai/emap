// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserTestMap } from '../../utils/plugin-test-map';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { Bounds } from '../../../src/domain/geo/bounds';
import type { Emap } from '../../../src/engine/map/map';
import type { CanvasRenderService } from '../../../src/engine/providers/workspace/render';

const contexts = new Map<HTMLCanvasElement, Record<string, unknown>>();
let frames: Map<number, FrameRequestCallback>;
let map: Emap;
let render: CanvasRenderService;
function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}
function flushAll() {
  let n = 0;
  while (frames.size) {
    if (++n > 200) throw Error('endless frames');
    flushFrame();
  }
  return n;
}
function mainContext() {
  return contexts.get(render._canvas)! as Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock++);
  frames = new Map();
  let id = 0;
  contexts.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = new Proxy(
        { canvas: this, globalAlpha: 1 },
        {
          get(target, key) {
            if (!(key in target)) Reflect.set(target, key, vi.fn());
            return Reflect.get(target, key);
          },
        },
      );
      contexts.set(this, ctx);
    }
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  const container = document.createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  document.body.appendChild(container);
  map = await createBrowserTestMap({ container, geometryLod: false, screenPathFiltering: false });
  render = map.ctx.render as CanvasRenderService;
  map.setExtent(new Bounds(-100, -60, 100, 60));
  flushAll();
});
afterEach(async () => {
  await map?.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function addPolygons(count = 2) {
  const source = new TopologySource('data');
  const arcs = getDefaultMapshaperAdapter().createArcCollection(
    Array.from({ length: count }, (_, i) => ({
      xx: new Float64Array([i % 50, (i % 50) + 10, (i % 50) + 10, i % 50, i % 50]),
      yy: new Float64Array([0, 0, 10, 10, 0]),
    })),
  );
  source.setDataset(
    {
      arcs,
      layers: [
        {
          name: 'polygons',
          geometry_type: 'polygon',
          shapes: Array.from({ length: count }, (_, i) => [[i]]),
        },
      ],
      info: { crs_string: 'EPSG:4326' },
    },
    false,
  );
  await map.addSource('data', source);
  map.addLayer({
    id: 'polygons',
    source: 'data',
    type: 'fill',
    paint: { 'fill-color': '#345678', 'fill-opacity': 0.5, 'line-width': 0 },
  });
  flushAll();
  return source;
}

describe('Canvas provider cooperative publication and deletion', () => {
  it('publishes a large frame once without scheduling a second full build', async () => {
    await addPolygons(6000);
    const base = mainContext();
    base.drawImage.mockClear();
    const full = vi.spyOn(render, '_renderFull');
    render._scheduleRender();
    flushFrame();
    expect(render._painter.frameComplete).toBe(false);
    expect(base.drawImage).not.toHaveBeenCalled();
    expect(flushAll()).toBeGreaterThan(1);
    expect(base.drawImage).toHaveBeenCalledOnce();
    expect(full).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it.each([
    'mutate',
    'close',
  ] as const)('consumes pass-owned image synchronously before %s and resumes cooperation after pass removal', async (action) => {
    await addPolygons(6000);
    const image = { color: 'red', closed: false };
    const consumed: string[] = [];
    const errors = vi.fn();
    map.on('error', errors);
    for (const ctx of contexts.values()) {
      Reflect.set(
        ctx,
        'drawImage',
        vi.fn((source: unknown) => {
          if (source !== image) return;
          if (image.closed) throw Error('source already closed');
          consumed.push(image.color);
        }),
      );
    }
    const remove = map.ctx.render.registerPass(({ painter }) => {
      painter.drawRasterImage(image as unknown as CanvasImageSource, [0, 0, 10, 10]);
      if (action === 'close') image.closed = true;
      else image.color = 'blue';
    });
    flushAll();
    expect(consumed).toEqual(['red']);
    expect(errors).not.toHaveBeenCalled();
    expect(render._painter.frameComplete).toBe(true);
    remove();
    flushFrame();
    expect(render._painter.frameComplete).toBe(false);
    flushAll();
    expect(render._painter.frameComplete).toBe(true);
  });

  it('keeps before/after passes around all polygon fills in synchronous fallback', async () => {
    await addPolygons(6000);
    map.ctx.render.registerPass(
      ({ painter }) => painter.drawPoints([[[0, 0]]], { color: '#abcdef' }),
      'before-layers',
    );
    map.ctx.render.registerPass(
      ({ painter }) => painter.drawPoints([[[0, 0]]], { color: '#fedcba' }),
      'after-layers',
    );
    const base = mainContext();
    const colors: string[] = [];
    base.fill.mockImplementation(() => colors.push(String(Reflect.get(base, 'fillStyle'))));
    base.drawImage.mockClear();
    flushFrame();
    expect(render._painter.frameComplete).toBe(true);
    expect(colors[0]).toBe('#abcdef');
    expect(colors.at(-1)).toBe('#fedcba');
    expect(base.drawImage).not.toHaveBeenCalled();
  });

  it('replaces a suspended frame after public spatial-index invalidation', async () => {
    await addPolygons(6000);
    const base = mainContext();
    base.drawImage.mockClear();
    render._scheduleRender();
    flushFrame();
    expect(render._painter.frameComplete).toBe(false);
    map.clearSpatialIndex('data');
    flushAll();
    expect(render._painter.frameComplete).toBe(true);
    expect(base.drawImage).toHaveBeenCalledOnce();
  });

  it('rejects a prepared frame when source revision changes without a new render request', async () => {
    const source = await addPolygons(6000);
    const base = mainContext();
    base.drawImage.mockClear();
    render._scheduleRender();
    flushFrame();
    expect(render._painter.frameComplete).toBe(false);
    const dataset = source.getDataset()!;
    Reflect.set(dataset, 'editVersion', (dataset.editVersion ?? 0) + 1);
    flushAll();
    expect(base.drawImage).not.toHaveBeenCalled();
  });

  it('cancels unfinished replacement on navigation and keeps the painted transform as its snapshot', async () => {
    await addPolygons(6000);
    const base = mainContext();
    base.drawImage.mockClear();
    const painted = { ...Reflect.get(render, '_paintedTransform') };
    render._scheduleRender();
    flushFrame();
    render.beginNavigation();
    expect(render._navSnapshotTransform).toEqual(painted);
    flushAll();
    expect(base.drawImage).not.toHaveBeenCalled();
  });

  it('repaints only a bounded region after deleting a transparent fill and restores it through undo', async () => {
    await addPolygons();
    const base = mainContext();
    base.clearRect.mockClear();
    base.drawImage.mockClear();
    map.select([{ source: 'data', layer: 'polygons', id: 0 }]);
    flushAll();
    map.deleteSelected();
    flushAll();
    expect(base.clearRect).toHaveBeenCalledOnce();
    const [, , width, height] = base.clearRect.mock.calls[0];
    expect(width).toBeLessThan(800);
    expect(height).toBeLessThan(600);
    expect(base.drawImage.mock.calls[0]).toHaveLength(9);
    base.clearRect.mockClear();
    map.undo();
    flushAll();
    expect(base.clearRect).toHaveBeenLastCalledWith(0, 0, 800, 600);
  });

  it.each([
    'outline',
    'pass',
    'pending',
    'filter',
    'lod',
    'navigation',
    'gpu',
  ] as const)('falls back to a full redraw for %s', async (unsafe) => {
    await addPolygons(unsafe === 'outline' ? 300 : 2);
    if (unsafe === 'outline') map.setPaintProperty('polygons', 'line-width', 2);
    if (unsafe === 'pass') map.ctx.render.registerPass(() => {});
    if (unsafe === 'filter') map.setFilter('polygons', ['==', 1, 1]);
    if (unsafe === 'lod') map.setGeometryLod({ pixelTolerance: 1 });
    if (unsafe === 'gpu') Reflect.set(render._painter, 'backend', 'webgl2');
    flushAll();
    const base = mainContext();
    base.clearRect.mockClear();
    map.select([{ source: 'data', layer: 'polygons', id: 0 }]);
    flushAll();
    if (unsafe === 'pending') render._scheduleRender();
    if (unsafe === 'navigation') render.beginNavigation();
    map.deleteSelected();
    flushAll();
    expect(base.clearRect).toHaveBeenLastCalledWith(0, 0, 800, 600);
  });
});
