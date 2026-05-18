// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Camera } from './camera';

/** Minimal viewport-host stub: in-memory camera state + spy. */
function hostStub() {
  let st = { center: [0, 0] as [number, number], scale: 1 };
  const fired: Array<{ type: string; e: any }> = [];
  return {
    host: {
      getCameraState: () => ({ center: [...st.center] as [number, number], scale: st.scale }),
      applyCameraState: (c: [number, number], s: number) => { st = { center: [c[0], c[1]], scale: s }; },
      scaleFromZoom: (z: number) => Math.pow(2, z),     // pretend WebMercator-ish
      fire: (type: string, e: any) => fired.push({ type, e }),
      requestRender: vi.fn(),
    },
    fired,
    state: () => st,
  };
}

describe('Camera.jumpTo', () => {
  it('applies center+scale instantly and fires move/zoom lifecycle synchronously', () => {
    const { host, fired, state } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ center: [10, 20], zoom: 3 });   // scale = 2^3 = 8
    expect(state()).toEqual({ center: [10, 20], scale: 8 });
    const types = fired.map((f) => f.type);
    expect(types).toEqual(['movestart', 'zoomstart', 'move', 'zoom', 'moveend', 'zoomend']);
    expect(fired.at(-1)!.e).toMatchObject({ center: [10, 20], zoom: expect.any(Number) });
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('pure pan (zoom unchanged) fires only move* — no zoom*', () => {
    const { host, fired } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ center: [5, 5] });               // scale stays 1
    expect(fired.map((f) => f.type)).toEqual(['movestart', 'move', 'moveend']);
  });

  it('accepts scale directly (CRS-agnostic path) and omitted fields keep current', () => {
    const { host, state } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ scale: 4 });
    expect(state()).toEqual({ center: [0, 0], scale: 4 });
    cam.jumpTo({ center: [9, 9] });
    expect(state()).toEqual({ center: [9, 9], scale: 4 });
  });

  it('throws on non-finite center/zoom/scale', () => {
    const { host } = hostStub();
    const cam = new Camera(host as any);
    expect(() => cam.jumpTo({ center: [NaN, 0] })).toThrow(/finite/);
    expect(() => cam.jumpTo({ zoom: Infinity })).toThrow(/finite/);
    expect(() => cam.jumpTo({ scale: -1 })).toThrow(/finite|positive/);
  });
});

describe('Camera.easeTo', () => {
  it('duration:0 / animate:false delegates to the jump path (no tween, sync lifecycle)', () => {
    const { host, fired, state } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [7, 8], scale: 5, duration: 0 });
    expect(state()).toEqual({ center: [7, 8], scale: 5 });
    expect(fired.map((f) => f.type)).toEqual(['movestart', 'zoomstart', 'move', 'zoom', 'moveend', 'zoomend']);
    expect(cam.isMoving()).toBe(false);
  });

  it('animates over ticks: one movestart, ≥1 move, lands exactly on target, one moveend', () => {
    vi.useFakeTimers();
    const { host, fired, state } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [100, 0], scale: 4, duration: 100, easing: (t) => t });
    expect(cam.isMoving()).toBe(true);
    expect(fired.filter((f) => f.type === 'movestart')).toHaveLength(1);
    vi.advanceTimersByTime(200);              // run all rAF/timeout ticks
    const t = fired.map((f) => f.type);
    expect(t.filter((x) => x === 'movestart')).toHaveLength(1);
    expect(t.filter((x) => x === 'move').length).toBeGreaterThanOrEqual(1);
    expect(t.filter((x) => x === 'moveend')).toHaveLength(1);
    expect(state().center[0]).toBeCloseTo(100, 6);
    expect(state().scale).toBeCloseTo(4, 6);
    expect(cam.isMoving()).toBe(false);
    vi.useRealTimers();
  });

  it('a second easeTo mid-flight cancels the first; first moveend precedes second movestart', () => {
    vi.useFakeTimers();
    const { host, fired } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [50, 50], scale: 2, duration: 100, easing: (t) => t });
    vi.advanceTimersByTime(30);
    cam.easeTo({ center: [0, 0], scale: 1, duration: 100, easing: (t) => t });
    const types = fired.map((f) => f.type);
    const firstEnd = types.indexOf('moveend');
    const secondStart = types.indexOf('movestart', types.indexOf('movestart') + 1);
    expect(firstEnd).toBeGreaterThanOrEqual(0);
    expect(secondStart).toBeGreaterThan(firstEnd);
    vi.advanceTimersByTime(200);
    // second animation completes cleanly: idle + exactly two moveends total
    expect(cam.isMoving()).toBe(false);
    expect(fired.filter((f) => f.type === 'moveend')).toHaveLength(2);
    vi.useRealTimers();
  });

  it('stop() mid-flight cancels and fires terminal events; no-op when idle', () => {
    vi.useFakeTimers();
    const { host, fired } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [9, 9], scale: 3, duration: 100, easing: (t) => t });
    vi.advanceTimersByTime(20);
    cam.stop();
    expect(fired.map((f) => f.type)).toContain('moveend');
    expect(cam.isMoving()).toBe(false);
    const n = fired.length;
    cam.stop();                                // idle → no-op
    expect(fired.length).toBe(n);
    vi.useRealTimers();
  });
});
