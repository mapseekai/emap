import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAST_SETTLE_FALLBACK_MS, RenderScheduler, type RenderSnapshot } from './render-scheduler';

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  return {
    canvasWidth: 800,
    canvasHeight: 600,
    pixelRatio: 1,
    ...overrides,
  };
}

describe('RenderScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses fast-nav after a slow full frame when the snapshot is still valid', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw: vi.fn(),
      fastNav,
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 10, ty: 2, sx: 1, sy: 1 } });

    expect(fastNav).toHaveBeenCalledWith({ tx: 10, ty: 2, sx: 1, sy: 1 });
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('falls back to a full redraw when the latest frame was fast', () => {
    const fullRedraw = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw: vi.fn(),
      fastNav: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(16, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 1, ty: 1, sx: 1, sy: 1 } });

    expect(fullRedraw).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full redraw when canvas dimensions changed', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw: vi.fn(),
      fastNav,
      getSnapshot: () => snapshot({ canvasWidth: 900 }),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 1, ty: 1, sx: 1, sy: 1 } });

    expect(fastNav).not.toHaveBeenCalled();
    expect(fullRedraw).toHaveBeenCalledTimes(1);
  });

  it('uses the existing navigation snapshot when drawing exceeds a 30fps budget', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      fastNav,
      requestRedraw: vi.fn(),
      getSnapshot: () => snapshot(),
    });
    scheduler.recordFrame(50, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 2, ty: 3, sx: 1, sy: 1 } });
    expect(fullRedraw).not.toHaveBeenCalled();
    expect(fastNav).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('requests a redraw if interaction end arrived before the fast-nav frame ran', () => {
    const fullRedraw = vi.fn();
    const requestRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw,
      fastNav,
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.notifyInteractionEnd(true);
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });

    expect(fastNav).toHaveBeenCalledTimes(1);
    expect(fullRedraw).not.toHaveBeenCalled();
    expect(requestRedraw).toHaveBeenCalledTimes(1);
  });

  it('does not leave a stale settle request when interaction end has no pending nav frame', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw: vi.fn(),
      fastNav,
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.notifyInteractionEnd();
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });

    expect(fastNav).toHaveBeenCalledTimes(1);
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('requests redraw instead of redrawing synchronously when fast-nav interaction ends', () => {
    const fullRedraw = vi.fn();
    const requestRedraw = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw,
      fastNav: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });
    scheduler.notifyInteractionEnd();

    expect(fullRedraw).not.toHaveBeenCalled();
    expect(requestRedraw).toHaveBeenCalledTimes(1);
  });

  it('does not request duplicate redraws after a pending fast-nav redraw has settled', () => {
    const requestRedraw = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw: vi.fn(),
      requestRedraw,
      fastNav: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });
    scheduler.notifyInteractionEnd();
    scheduler.notifyInteractionEnd();

    expect(requestRedraw).toHaveBeenCalledTimes(1);
  });

  it('settles via fallback timer if no interaction end arrives', () => {
    vi.useFakeTimers();
    const fullRedraw = vi.fn();
    const requestRedraw = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      requestRedraw,
      fastNav: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });
    expect(fullRedraw).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FAST_SETTLE_FALLBACK_MS);

    expect(fullRedraw).not.toHaveBeenCalled();
    expect(requestRedraw).toHaveBeenCalledTimes(1);
  });
});

describe('GPU navigation policy', () => {
  afterEach(() => vi.useRealTimers());
  function gpu(current = snapshot()) {
    const callbacks = {
      fullRedraw: vi.fn(),
      requestRedraw: vi.fn(),
      fastNav: vi.fn(),
      getSnapshot: () => current,
    };
    return { callbacks, scheduler: new RenderScheduler(callbacks, 'snapshot') };
  }
  const nav = { action: 'nav' as const, navDelta: { tx: 12, ty: 3, sx: 1.2, sy: 1.2 } };
  it('reuses a valid GPU frame even when CPU submission took less than one millisecond', () => {
    const { scheduler, callbacks } = gpu();
    scheduler.recordFrame(0.1, snapshot());
    scheduler.schedule(nav);
    expect(callbacks.fastNav).toHaveBeenCalledOnce();
    expect(callbacks.fullRedraw).not.toHaveBeenCalled();
    scheduler.notifyInteractionEnd();
    scheduler.notifyInteractionEnd();
    expect(callbacks.requestRedraw).toHaveBeenCalledOnce();
    scheduler.dispose();
  });
  it('does not snapshot before a full frame, after a failed frame, or after resize/DPR changes', () => {
    const { scheduler, callbacks } = gpu();
    scheduler.schedule(nav);
    expect(callbacks.fullRedraw).toHaveBeenCalledOnce();
    scheduler.recordFrame(0.1, snapshot());
    callbacks.fullRedraw.mockImplementationOnce(() => {
      throw new Error('draw failed');
    });
    expect(() => scheduler.schedule()).toThrow('draw failed');
    scheduler.schedule(nav);
    expect(callbacks.fastNav).not.toHaveBeenCalled();
    scheduler.dispose();
    for (const changed of [
      snapshot({ canvasWidth: 901 }),
      snapshot({ canvasHeight: 601 }),
      snapshot({ pixelRatio: 2 }),
      snapshot({ canvasWidth: 0 }),
    ]) {
      const next = gpu(changed);
      next.scheduler.recordFrame(0.1, snapshot());
      next.scheduler.schedule(nav);
      expect(next.callbacks.fastNav).not.toHaveBeenCalled();
      next.scheduler.dispose();
    }
  });
  it('redraws a content invalidation during navigation and subsequently resumes from the new frame', () => {
    const { scheduler, callbacks } = gpu();
    scheduler.recordFrame(0.1, snapshot());
    scheduler.schedule(nav);
    scheduler.schedule({ action: 'redraw' });
    expect(callbacks.fullRedraw).toHaveBeenCalledOnce();
    expect(scheduler.fastActive).toBe(false);
    scheduler.recordFrame(0.2, snapshot());
    scheduler.schedule(nav);
    expect(callbacks.fastNav).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
  it('settles a late navigation frame and cancels fallback timers on dispose', () => {
    vi.useFakeTimers();
    const { scheduler, callbacks } = gpu();
    scheduler.recordFrame(0.1, snapshot());
    scheduler.notifyInteractionEnd(true);
    scheduler.schedule(nav);
    expect(callbacks.requestRedraw).toHaveBeenCalledOnce();
    scheduler.schedule(nav);
    scheduler.dispose();
    vi.advanceTimersByTime(FAST_SETTLE_FALLBACK_MS);
    expect(callbacks.requestRedraw).toHaveBeenCalledOnce();
  });
});
