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

    scheduler.recordFrame(100, snapshot());
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
