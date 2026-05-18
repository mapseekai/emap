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
