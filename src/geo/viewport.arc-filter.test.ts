import { describe, it, expect, vi } from 'vitest';
import { Viewport } from './viewport';
import { AffineTransform } from './transform';
import { Bounds } from './bounds';

function makeViewport(mx = 1, initialMx = 1) {
  const vp = new Viewport();
  vp.updateSize(800, 600);
  const t = new AffineTransform();
  t.mx = mx;
  t.my = -mx;
  t.bx = 0;
  t.by = 0;
  (vp as any)._transform = t;
  (vp as any)._initialMX = initialMx;
  (vp as any)._extent = new Bounds(-100, -100, 100, 100);
  return vp;
}

describe('Viewport.getArcFilter — MIN_PATH_LEN mapshaper 0.7.19 parity', () => {
  it('passes minLen = pixelSize * 0.35 to arcIsSmaller (was 0.1)', () => {
    const vp = makeViewport(2, 1); // mapScale = 2 (above fast-path threshold); pixelSize = 0.5
    const arcs = {
      arcIsSmaller: vi.fn(() => false),
      arcIntersectsBBox: vi.fn(() => true),
    };
    const filter = vp.getArcFilter(arcs as any);
    filter(0);
    // pixelSize 0.5 * MIN_PATH_LEN 0.35 = 0.175
    expect(arcs.arcIsSmaller).toHaveBeenCalledWith(0, 0.175);
  });

  // A3: scale<1.1 fast path (mapshaper gui-canvas.mjs:103)
  it('skips per-arc bbox/size check when mapScale < 1.1 (fast path)', () => {
    const vp = makeViewport(1.05, 1); // mapScale = 1.05 < 1.1
    const arcs = {
      arcIsSmaller: vi.fn(() => false),
      arcIntersectsBBox: vi.fn(() => false), // would normally reject
    };
    const filter = vp.getArcFilter(arcs as any);
    // Should return true unconditionally; arcs methods should never be called
    expect(filter(0)).toBe(true);
    expect(arcs.arcIsSmaller).not.toHaveBeenCalled();
    expect(arcs.arcIntersectsBBox).not.toHaveBeenCalled();
  });

  it('still applies per-arc checks when mapScale >= 1.1', () => {
    const vp = makeViewport(2, 1); // mapScale = 2 >= 1.1
    const arcs = {
      arcIsSmaller: vi.fn(() => false),
      arcIntersectsBBox: vi.fn(() => true),
    };
    const filter = vp.getArcFilter(arcs as any);
    filter(0);
    expect(arcs.arcIsSmaller).toHaveBeenCalled();
  });
});
