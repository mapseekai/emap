import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FAST_SETTLE_FALLBACK_MS,
  RenderScheduler,
  type RenderSnapshot,
} from './render-scheduler';

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

  it('uses fast-nav for nav frames when the snapshot is still valid', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw: vi.fn(),
      fastNav,
      overlayRedraw: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(1, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 10, ty: 2, sx: 1, sy: 1 } });

    expect(fastNav).toHaveBeenCalledWith({ tx: 10, ty: 2, sx: 1, sy: 1 });
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('falls back to a full redraw when canvas dimensions changed', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw: vi.fn(),
      fastNav,
      overlayRedraw: vi.fn(),
      getSnapshot: () => snapshot({ canvasWidth: 900 }),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 1, ty: 1, sx: 1, sy: 1 } });

    expect(fastNav).not.toHaveBeenCalled();
    expect(fullRedraw).toHaveBeenCalledTimes(1);
  });

  it('settles immediately if interaction end arrived before the fast-nav frame ran', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw: vi.fn(),
      fastNav,
      overlayRedraw: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.notifyInteractionEnd(true);
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });

    expect(fastNav).toHaveBeenCalledTimes(1);
    expect(fullRedraw).toHaveBeenCalledTimes(1);
  });

  it('does not leave a stale settle request when interaction end has no pending nav frame', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw: vi.fn(),
      fastNav,
      overlayRedraw: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.notifyInteractionEnd();
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });

    expect(fastNav).toHaveBeenCalledTimes(1);
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('settles via fallback timer if no interaction end arrives', () => {
    vi.useFakeTimers();
    const fullRedraw = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw: vi.fn(),
      fastNav: vi.fn(),
      overlayRedraw: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.recordFrame(101, snapshot());
    scheduler.schedule({ action: 'nav', navDelta: { tx: 4, ty: 5, sx: 1, sy: 1 } });
    expect(fullRedraw).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FAST_SETTLE_FALLBACK_MS);

    expect(fullRedraw).toHaveBeenCalledTimes(1);
  });

  it('renders overlay-only frames without promoting to full redraw', () => {
    const fullRedraw = vi.fn();
    const overlayRedraw = vi.fn();
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw: vi.fn(),
      fastNav: vi.fn(),
      overlayRedraw,
      getSnapshot: () => snapshot(),
    });

    scheduler.schedule({ action: 'overlay' });

    expect(overlayRedraw).toHaveBeenCalledTimes(1);
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('renders dirty-rect frames without promoting to full redraw', () => {
    const fullRedraw = vi.fn();
    const dirtyRedraw = vi.fn();
    const dirtyRect = { x: 1, y: 2, width: 3, height: 4 };
    const scheduler = new RenderScheduler({
      fullRedraw,
      dirtyRedraw,
      fastNav: vi.fn(),
      overlayRedraw: vi.fn(),
      getSnapshot: () => snapshot(),
    });

    scheduler.schedule({ action: 'dirty', dirtyRect });

    expect(dirtyRedraw).toHaveBeenCalledWith(dirtyRect);
    expect(fullRedraw).not.toHaveBeenCalled();
  });
});
