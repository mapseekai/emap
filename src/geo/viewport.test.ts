import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';
import { Bounds } from './bounds';

function vp(): Viewport {
  const v = new Viewport();
  v.updateSize(800, 600);
  v.setExtent(new Bounds(0, 0, 100, 100));
  return v;
}

describe('Viewport camera-state primitives', () => {
  it('getCameraState returns center (data coords) + positive scale', () => {
    const v = vp();
    const s = v.getCameraState();
    expect(s.scale).toBeGreaterThan(0);
    expect(s.center).toHaveLength(2);
    expect(Number.isFinite(s.center[0])).toBe(true);
    expect(Number.isFinite(s.center[1])).toBe(true);
  });
  it('applyCameraState then getCameraState round-trips center+scale', () => {
    const v = vp();
    v.applyCameraState([42, 17], 3);
    const s = v.getCameraState();
    expect(s.center[0]).toBeCloseTo(42, 6);
    expect(s.center[1]).toBeCloseTo(17, 6);
    expect(s.scale).toBeCloseTo(3, 9);
  });
  it('applyCameraState centers the data point at the viewport middle', () => {
    const v = vp();
    v.applyCameraState([10, 20], 2);
    const t = v.transform;
    const [px, py] = t.project(10, 20);
    expect(px).toBeCloseTo(400, 6); // width/2
    expect(py).toBeCloseTo(300, 6); // height/2
  });
});

describe('Viewport arc filtering', () => {
  it('passes all arcs near full extent without running per-arc checks', () => {
    const v = vp();
    let smallerCalls = 0;
    let bboxCalls = 0;
    const filter = v.getArcFilter({
      arcIsSmaller: () => {
        smallerCalls++;
        return true;
      },
      arcIntersectsBBox: () => {
        bboxCalls++;
        return false;
      },
    });

    expect(filter(0)).toBe(true);
    expect(smallerCalls).toBe(0);
    expect(bboxCalls).toBe(0);
  });

  it('uses the 0.35 pixel path-length threshold once zoomed in', () => {
    const v = vp();
    v.applyCameraState([50, 50], Math.abs(v.transform.mx) * 2);
    let minLen = 0;
    const filter = v.getArcFilter({
      arcIsSmaller: (_i, value) => {
        minLen = value;
        return false;
      },
    });

    expect(filter(0)).toBe(true);
    expect(minLen).toBeCloseTo((1 / Math.abs(v.transform.mx)) * 0.35, 12);
  });
});
