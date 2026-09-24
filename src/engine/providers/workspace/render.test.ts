import { describe, expect, it, vi } from 'vitest';
import { CanvasRenderService } from './render';

describe('map canvas teardown', () => {
  it('releases backing pixel storage before detaching canvases, even if handles remain reachable', () => {
    const render = new CanvasRenderService({} as never);
    const main = { width: 1920, height: 1080, remove: vi.fn() };
    const overlay = { width: 1920, height: 1080, remove: vi.fn() };
    Reflect.set(render, '_canvas', main);
    Reflect.set(render, '_overlayCanvas', overlay);
    render.dispose();
    expect([main.width, main.height, overlay.width, overlay.height]).toEqual([0, 0, 0, 0]);
    expect(main.remove).toHaveBeenCalledOnce();
    expect(overlay.remove).toHaveBeenCalledOnce();
  });
});

describe('live vertex geometry invalidation', () => {
  it('invalidates only edited source buffers on preview changes, including clearing the preview', () => {
    const arcs = {},
      other = {};
    const state = { mode: 'vertex', vertex: { arcs } };
    const render = new CanvasRenderService({
      editState: { _editState: state },
      document: {
        _sources: new Map([
          ['edited', { getArcs: () => arcs }],
          ['other', { getArcs: () => other }],
        ]),
      },
    } as never);
    const clearGeometryCache = vi.fn();
    Reflect.set(render, '_painter', { clearGeometryCache });
    const sync = () => Reflect.get(render, '_syncLiveEditGeometry').call(render);
    sync();
    sync();
    expect(clearGeometryCache.mock.calls).toEqual([[{ sourceId: 'edited' }]]);
    state.vertex = { arcs };
    sync();
    expect(clearGeometryCache).toHaveBeenCalledTimes(2);
    state.mode = 'none';
    sync();
    sync();
    expect(clearGeometryCache).toHaveBeenCalledTimes(3);
    expect(clearGeometryCache).toHaveBeenLastCalledWith({ sourceId: 'edited' });
  });
});

describe('navigation snapshot reference frame', () => {
  it('keeps the last painted transform when a new gesture overtakes a queued settle redraw', () => {
    const transform = { mx: 2, my: -2, bx: 0, by: 0 };
    const render = new CanvasRenderService({
      view: { _viewport: { transform } },
      events: { fire: vi.fn() },
    } as never);
    Reflect.set(render, '_clearFastTransform', vi.fn());
    Reflect.set(render, '_renderImpl', vi.fn());
    Reflect.set(render, '_captureRenderSnapshot', () => ({
      canvasWidth: 800,
      canvasHeight: 600,
      pixelRatio: 1,
    }));
    Reflect.set(render, '_scheduler', { recordFrame: vi.fn(), notifyInteractionEnd: vi.fn() });
    render._renderFull();
    render.beginNavigation();
    transform.bx = 40;
    expect(render._computeNavDelta().tx).toBe(40);
    render.endNavigation();
    render.beginNavigation();
    transform.bx = 60;
    expect(render._computeNavDelta().tx).toBe(60);
    render._renderFull();
    transform.bx = 70;
    expect(render._computeNavDelta().tx).toBe(10);
  });
});
