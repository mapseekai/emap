// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { canvasPainterPlugin } from '../../../src/engine/providers/workspace/canvas-plugin';
import { resolvePlugins } from '../../../src/runtime/presets';
import { Emap } from '../../../src/engine/map/map';
import type { EditPainter } from '../../../src/engine/rendering/painter';
import type { PainterFactoryContract } from '../../../src/runtime/services/contracts/painter-factory';
import type { Plugin } from 'cordis';
function fakePainter(): EditPainter {
  return {
    backend: 'canvas2d',
    resize: vi.fn(),
    setPixelRatio: vi.fn(),
    setTransform: vi.fn(),
    clear: vi.fn(),
    drawPaths: vi.fn(),
    drawArcs: vi.fn(),
    drawPoints: vi.fn(),
    drawPolygonFill: vi.fn(),
    drawRasterImage: vi.fn(),
    drawVertexDots: vi.fn(),
    drawVertexBand: vi.fn(),
    drawDrawingOverlay: vi.fn(),
    drawMeasurementOverlay: vi.fn(),
    dispose: vi.fn(),
  };
}
function provider(create: PainterFactoryContract['create']): Plugin.Object {
  return {
    name: 'provider.renderer',
    provide: ['painterFactory'],
    apply(ctx) {
      ctx.provide('painterFactory', { create });
    },
  };
}
describe('asynchronous formal renderer lifecycle', () => {
  it('preserves an explicit legacy Canvas factory instead of installing competing factories', () => {
    const plugins = resolvePlugins({ plugins: [canvasPainterPlugin] });
    expect(plugins.some((p) => p.name === 'provider.renderer')).toBe(false);
    expect(plugins.filter((p) => p.name === 'provider.canvas2d')).toHaveLength(1);
  });
  it('waits for both painters and dependent interaction plugins before readiness', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const painters = [fakePainter(), fakePainter()];
    let resolve!: (p: EditPainter) => void;
    const create = vi
      .fn<PainterFactoryContract['create']>()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(painters[1]);
    const map = new Emap({ container: host, plugins: [provider(create)] });
    let ready = false;
    void map.ready.then(() => {
      ready = true;
    });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(ready).toBe(false);
    resolve(painters[0]);
    await map.ready;
    expect(map.getRenderer()).toBe('canvas2d');
    expect(map.ctx.get('dragPan')).toBeDefined();
    expect(map.ctx.get('scrollZoom')).toBeDefined();
    expect(create.mock.calls.map(([, o]) => o?.role)).toEqual(['main', 'overlay']);
    await map.dispose();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    for (const p of painters) expect(p.dispose).toHaveBeenCalledOnce();
    host.remove();
  });
  it('cancels map initialization promptly and disposes a device that resolves late', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let resolve!: (p: EditPainter) => void;
    const create = vi.fn<PainterFactoryContract['create']>(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const map = new Emap({ container: host, plugins: [provider(create)] });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    await map.dispose();
    await expect(map.ready).rejects.toThrow();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    const late = fakePainter();
    resolve(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    host.remove();
  });
  it('rejects an unavailable painter and cleans already-created DOM without mounting a fallback', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const create = vi
      .fn<PainterFactoryContract['create']>()
      .mockRejectedValue(new Error('GPU unavailable'));
    await expect(Emap.create({ container: host, plugins: [provider(create)] })).rejects.toThrow(
      'GPU unavailable',
    );
    expect(create).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    host.remove();
  });
});
