import { describe, it, expect, vi } from 'vitest';
import { RenderScheduler, SLOW_FRAME_MS, FAST_SETTLE_FALLBACK_MS } from './render-scheduler';

function makeCbs() {
  return {
    fullRedraw: vi.fn(),
    overlayOnly: vi.fn(),
    fastNav: vi.fn(),
  };
}

describe('RenderScheduler — constants', () => {
  it('SLOW_FRAME_MS = 100 (mapshaper gui-layer-renderer.mjs:31)', () => {
    expect(SLOW_FRAME_MS).toBe(100);
  });
  it('FAST_SETTLE_FALLBACK_MS = 2000 (mapshaper gui-layer-renderer.mjs:36)', () => {
    expect(FAST_SETTLE_FALLBACK_MS).toBe(2000);
  });
});

describe('RenderScheduler — decision table', () => {
  it('action=redraw triggers full redraw', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.schedule({ action: 'redraw' });
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
    expect(cbs.overlayOnly).not.toHaveBeenCalled();
    expect(cbs.fastNav).not.toHaveBeenCalled();
  });

  it('undefined action defaults to redraw', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.schedule({});
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
  });

  it('action=hover routes to overlayOnly', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.schedule({ action: 'hover' });
    expect(cbs.overlayOnly).toHaveBeenCalledTimes(1);
    expect(cbs.fullRedraw).not.toHaveBeenCalled();
  });

  it('action=nav with fast frame (<= 100ms) triggers full redraw, not fastNav', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.recordFrame(50, { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 });
    s.schedule({ action: 'nav', navDelta: { tx: 0, ty: 0, sx: 1, sy: 1 } });
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
    expect(cbs.fastNav).not.toHaveBeenCalled();
  });

  it('action=nav with slow frame (> 100ms) AND snapshot triggers fastNav', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.recordFrame(150, { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 });
    s.schedule({ action: 'nav', navDelta: { tx: 10, ty: 0, sx: 1, sy: 1 } });
    expect(cbs.fastNav).toHaveBeenCalledWith({ tx: 10, ty: 0, sx: 1, sy: 1 });
    expect(cbs.fullRedraw).not.toHaveBeenCalled();
  });

  it('action=nav without snapshot falls back to full redraw', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    // No recordFrame call — no snapshot
    s.schedule({ action: 'nav', navDelta: { tx: 10, ty: 0, sx: 1, sy: 1 } });
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
    expect(cbs.fastNav).not.toHaveBeenCalled();
  });

  it('action=nav without navDelta cannot fastNav (full redraw instead)', () => {
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.recordFrame(150, { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 });
    s.schedule({ action: 'nav' });
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
    expect(cbs.fastNav).not.toHaveBeenCalled();
  });
});

describe('RenderScheduler — settle latch', () => {
  it('notifyInteractionEnd while fast-active triggers immediate full redraw', () => {
    vi.useFakeTimers();
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.recordFrame(150, { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 });
    s.schedule({ action: 'nav', navDelta: { tx: 10, ty: 0, sx: 1, sy: 1 } });
    expect(cbs.fastNav).toHaveBeenCalled();
    cbs.fullRedraw.mockClear();
    s.notifyInteractionEnd();
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('fallback timer settles after FAST_SETTLE_FALLBACK_MS if no interactionend', () => {
    vi.useFakeTimers();
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.recordFrame(150, { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 });
    s.schedule({ action: 'nav', navDelta: { tx: 10, ty: 0, sx: 1, sy: 1 } });
    cbs.fullRedraw.mockClear();
    vi.advanceTimersByTime(FAST_SETTLE_FALLBACK_MS + 1);
    expect(cbs.fullRedraw).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('full redraw cancels pending settle timer', () => {
    vi.useFakeTimers();
    const cbs = makeCbs();
    const s = new RenderScheduler(cbs);
    s.recordFrame(150, { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 });
    s.schedule({ action: 'nav', navDelta: { tx: 10, ty: 0, sx: 1, sy: 1 } });
    s.schedule({ action: 'redraw' });
    cbs.fullRedraw.mockClear();
    vi.advanceTimersByTime(FAST_SETTLE_FALLBACK_MS + 1);
    // Should NOT trigger a second redraw — timer was canceled
    expect(cbs.fullRedraw).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
