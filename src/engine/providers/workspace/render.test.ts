import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderService } from './render';
import { AffineTransform } from '../../../domain/geo/transform';
import { RenderScheduler } from '../../rendering/render-scheduler';

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

describe('navigation snapshots during a continuous gesture', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fixture() {
    vi.useFakeTimers();
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const view = { transform: new AffineTransform(1, -1, 0, 0) };
    const render = new CanvasRenderService({
      view: { _viewport: view },
      document: { _removed: false },
      signal: new AbortController().signal,
      events: { fire: vi.fn() },
    } as never);
    const style = { transform: '', transformOrigin: '' };
    render._canvas = { width: 800, height: 600, style, remove() {} } as never;
    Reflect.set(render, '_paintedTransform', { mx: 1, my: -1, bx: 0, by: 0 });
    let cost = 100;
    let redraws = 0;
    let replays = 0;
    render._painter = {
      get navigationFrameMs() {
        return cost;
      },
      renderNavigation() {
        replays++;
        return true;
      },
    } as never;
    render._renderImpl = () => {
      redraws++;
      cost = 5;
    };
    render._renderEditOverlay = () => {};
    render._scheduler = new RenderScheduler(
      {
        fullRedraw: () => render._renderFull(),
        requestRedraw: () => render._scheduleRender('redraw', undefined, true),
        fastNav: (delta) => render._applyFastTransform(delta),
        getSnapshot: () => render._captureRenderSnapshot(),
      },
      'snapshot',
    );
    render._scheduler.recordFrame(5, render._captureRenderSnapshot());
    render.beginNavigation();
    const step = () => {
      view.transform.bx++;
      render.updateNavigation();
      vi.advanceTimersByTime(16);
    };
    return {
      render,
      style,
      step,
      setCost(value: number) {
        cost = value;
      },
      get redraws() {
        return redraws;
      },
      get replays() {
        return replays;
      },
    };
  }

  it('keeps the last full-size frame frozen until the slow gesture ends, even after timing improves', () => {
    const f = fixture();
    f.step();
    expect(f.style.transform).not.toBe('');
    f.setCost(5);
    for (let i = 0; i < 50; i++) f.step();
    expect(f.render._navSnapshotTransform).not.toBeNull();
    expect(f.redraws).toBe(0);
    expect(f.replays).toBe(0);
    expect(f.style.transform).not.toBe('');
    expect([f.render._canvas.width, f.render._canvas.height]).toEqual([800, 600]);
    f.render.endNavigation();
    const before = f.redraws;
    vi.advanceTimersByTime(32);
    expect(f.redraws).toBe(before + 1);
    expect(f.style.transform).toBe('');
    f.render.beginNavigation();
    f.step();
    expect(f.replays).toBe(1);
    f.render.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not redraw or replay a slow scene during two seconds of continuous navigation', () => {
    const f = fixture();
    let redraws = 0;
    f.render._renderImpl = () => {
      redraws++;
    };
    for (let i = 0; i < 125; i++) f.step();
    expect(redraws).toBe(0);
    expect(f.replays).toBe(0);
    expect(f.style.transform).not.toBe('');
    f.render.endNavigation();
    vi.advanceTimersByTime(32);
    expect(redraws).toBe(1);
    f.render.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a frozen frame when another gesture overtakes its queued settle redraw', () => {
    const f = fixture();
    f.step();
    f.render.endNavigation();
    f.render.beginNavigation();
    f.setCost(5);
    f.step();
    expect(f.redraws).toBe(0);
    expect(f.replays).toBe(0);
    expect(f.render._computeNavDelta().tx).toBe(2);
    expect(f.style.transform).toBe('translate(2px,0px) scale(1,1)');
    f.render.endNavigation();
    vi.advanceTimersByTime(32);
    expect(f.redraws).toBe(1);
    expect(f.style.transform).toBe('');
    f.render.dispose();
  });

  it('uses the same frozen-frame policy for a slow Canvas2D gesture', () => {
    const f = fixture();
    Reflect.set(f.render._painter, 'renderNavigation', undefined);
    f.render._scheduler = new RenderScheduler({
      fullRedraw: () => f.render._renderFull(),
      requestRedraw: () => f.render._scheduleRender('redraw', undefined, true),
      fastNav: (delta) => f.render._applyFastTransform(delta),
      getSnapshot: () => f.render._captureRenderSnapshot(),
    });
    f.render._scheduler.recordFrame(100, f.render._captureRenderSnapshot());
    for (let i = 0; i < 50; i++) f.step();
    expect(f.redraws).toBe(0);
    expect(f.style.transform).toBe('translate(50px,0px) scale(1,1)');
    f.render.endNavigation();
    vi.advanceTimersByTime(32);
    expect(f.redraws).toBe(1);
    expect(f.style.transform).toBe('');
    f.render.dispose();
  });

  it('keeps healthy camera replay free of geometry preparation during continuous navigation', () => {
    const f = fixture();
    f.render._renderImpl();
    const before = f.redraws;
    for (let i = 0; i < 125; i++) f.step();
    expect(f.replays).toBeGreaterThan(100);
    expect(f.redraws).toBe(before);
    f.render.endNavigation();
    vi.advanceTimersByTime(32);
    expect(f.redraws).toBe(before + 1);
    f.render.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    5, 100,
  ])('defers prepared geometry without blocking explicit redraws at %sms', (cost) => {
    const f = fixture();
    f.render._renderImpl();
    f.setCost(cost);
    f.step();
    const before = f.redraws;
    Reflect.get(f.render, '_schedulePreparedRender').call(f.render);
    f.step();
    expect(f.redraws).toBe(before);
    f.render._scheduleRender();
    vi.advanceTimersByTime(16);
    expect(f.redraws).toBe(before + 1);
    f.render.endNavigation();
    f.render.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes paused Canvas2D labels after an adaptive gesture that needed no snapshot redraw', () => {
    const f = fixture();
    Reflect.set(f.render._painter, 'renderNavigation', undefined);
    Reflect.set(f.render, '_labels', {});
    f.render._scheduler = new RenderScheduler({
      fullRedraw: () => f.render._renderFull(),
      requestRedraw: () => f.render._scheduleRender('redraw', undefined, true),
      fastNav: (delta) => f.render._applyFastTransform(delta),
      getSnapshot: () => f.render._captureRenderSnapshot(),
    });
    f.render._scheduler.recordFrame(5, f.render._captureRenderSnapshot());
    f.step();
    expect(f.redraws).toBe(1);
    const before = f.redraws;
    f.render.endNavigation();
    vi.advanceTimersByTime(32);
    expect(f.redraws).toBe(before + 1);
    Reflect.set(f.render, '_labels', null);
    f.render.dispose();
  });

  it('keeps using the snapshot after an unfinished GPU queue completes during the gesture', () => {
    const f = fixture();
    Object.defineProperty(f.render._painter, 'navigationPending', {
      value: true,
      configurable: true,
    });
    for (let i = 0; i < 125; i++) f.step();
    expect(f.redraws).toBe(0);
    Object.defineProperty(f.render._painter, 'navigationPending', { value: false });
    f.setCost(5);
    for (let i = 0; i < 40; i++) f.step();
    expect(f.replays).toBe(0);
    expect(f.redraws).toBe(0);
    f.render.dispose();
  });

  it.each([
    [33, 1],
    [34, 0],
    [Infinity, 0],
  ])('uses the shared frame budget when the GPU timing estimate is %sms', (cost, replays) => {
    const f = fixture();
    f.setCost(cost);
    f.step();
    expect(f.replays).toBe(replays);
    expect(f.redraws).toBe(0);
    expect(f.style.transform === '').toBe(replays === 1);
    f.render.dispose();
  });

  it.each([
    'cancelNavigation',
    'endNavigation',
    'dispose',
  ] as const)('does not leave recovery work after %s', (action) => {
    const f = fixture();
    f.step();
    f.render[action]();
    vi.advanceTimersByTime(32);
    const before = f.redraws;
    vi.advanceTimersByTime(3000);
    expect(f.redraws).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
    f.render.dispose();
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
