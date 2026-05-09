import { describe, expect, it } from 'vitest';
import { Bounds } from './bounds';

describe('Bounds construction', () => {
  it('default constructor produces an empty (uninitialized) bounds', () => {
    const b = new Bounds();
    expect(b.xmin).toBe(Infinity);
    expect(b.ymin).toBe(Infinity);
    expect(b.xmax).toBe(-Infinity);
    expect(b.ymax).toBe(-Infinity);
    expect(b.hasBounds()).toBe(false);
  });

  it('explicit constructor fills the values', () => {
    const b = new Bounds(0, 1, 10, 11);
    expect([b.xmin, b.ymin, b.xmax, b.ymax]).toEqual([0, 1, 10, 11]);
    expect(b.hasBounds()).toBe(true);
  });

  it('fromArray builds from a flat tuple', () => {
    const b = Bounds.fromArray([1, 2, 3, 4]);
    expect([b.xmin, b.ymin, b.xmax, b.ymax]).toEqual([1, 2, 3, 4]);
  });
});

describe('Bounds.width / height / center', () => {
  it('computes width and height', () => {
    const b = new Bounds(10, 20, 30, 70);
    expect(b.width).toBe(20);
    expect(b.height).toBe(50);
  });

  it('computes center coordinates', () => {
    const b = new Bounds(10, 20, 30, 70);
    expect(b.centerX).toBe(20);
    expect(b.centerY).toBe(45);
  });

  it('zero-area bounds return 0 width/height', () => {
    const b = new Bounds(5, 5, 5, 5);
    expect(b.width).toBe(0);
    expect(b.height).toBe(0);
    expect(b.hasBounds()).toBe(true);
  });
});

describe('Bounds.hasBounds', () => {
  it('returns false on the default empty Bounds', () => {
    expect(new Bounds().hasBounds()).toBe(false);
  });

  it('returns true on a normal bounds', () => {
    expect(new Bounds(0, 0, 1, 1).hasBounds()).toBe(true);
  });

  it('returns true on a degenerate (point) bounds', () => {
    expect(new Bounds(5, 5, 5, 5).hasBounds()).toBe(true);
  });

  it('returns false on inverted bounds (xmin > xmax)', () => {
    expect(new Bounds(10, 0, 0, 10).hasBounds()).toBe(false);
  });
});

describe('Bounds.clone', () => {
  it('produces an independent copy', () => {
    const a = new Bounds(0, 0, 10, 10);
    const b = a.clone();
    b.xmin = -5;
    expect(a.xmin).toBe(0);
    expect(b.xmin).toBe(-5);
  });
});

describe('Bounds.mergePoint', () => {
  it('expands an empty bounds to wrap a single point', () => {
    const b = new Bounds();
    b.mergePoint(5, 7);
    expect([b.xmin, b.ymin, b.xmax, b.ymax]).toEqual([5, 7, 5, 7]);
  });

  it('expands an existing bounds when the point is outside', () => {
    const b = new Bounds(0, 0, 10, 10);
    b.mergePoint(15, 12);
    expect([b.xmin, b.ymin, b.xmax, b.ymax]).toEqual([0, 0, 15, 12]);
  });

  it('does nothing when the point is already inside', () => {
    const b = new Bounds(0, 0, 10, 10);
    b.mergePoint(5, 5);
    expect([b.xmin, b.ymin, b.xmax, b.ymax]).toEqual([0, 0, 10, 10]);
  });

  it('handles negative-direction expansion', () => {
    const b = new Bounds(0, 0, 10, 10);
    b.mergePoint(-5, -3);
    expect([b.xmin, b.ymin, b.xmax, b.ymax]).toEqual([-5, -3, 10, 10]);
  });
});

describe('Bounds.merge', () => {
  it('takes the union of two bounds', () => {
    const a = new Bounds(0, 0, 10, 10);
    const b = new Bounds(5, 5, 20, 25);
    a.merge(b);
    expect([a.xmin, a.ymin, a.xmax, a.ymax]).toEqual([0, 0, 20, 25]);
  });

  it('is a no-op when merging an empty (invalid) bounds in', () => {
    const a = new Bounds(0, 0, 10, 10);
    const b = new Bounds(); // empty
    a.merge(b);
    expect([a.xmin, a.ymin, a.xmax, a.ymax]).toEqual([0, 0, 10, 10]);
  });

  it('initialises an empty bounds from a valid one', () => {
    const a = new Bounds();
    a.merge(new Bounds(0, 0, 5, 5));
    expect([a.xmin, a.ymin, a.xmax, a.ymax]).toEqual([0, 0, 5, 5]);
  });

  it('subset other does not shrink target', () => {
    const a = new Bounds(0, 0, 100, 100);
    a.merge(new Bounds(10, 10, 90, 90));
    expect([a.xmin, a.ymin, a.xmax, a.ymax]).toEqual([0, 0, 100, 100]);
  });
});

describe('Bounds.fillOut', () => {
  it('pads horizontally when current aspect < target aspect (too tall)', () => {
    const b = new Bounds(0, 0, 10, 20); // aspect 0.5
    b.fillOut(1.0, 0.5, 0.5); // target aspect 1.0, centred
    // h=20, w should become 20 → pad 10 split equally → xmin=-5, xmax=15
    expect(b.width).toBeCloseTo(20);
    expect(b.height).toBe(20);
    expect(b.xmin).toBeCloseTo(-5);
    expect(b.xmax).toBeCloseTo(15);
  });

  it('pads vertically when current aspect > target aspect (too wide)', () => {
    const b = new Bounds(0, 0, 20, 10); // aspect 2.0
    b.fillOut(1.0, 0.5, 0.5); // target aspect 1.0
    // w=20, h should become 20 → pad 10 split equally
    expect(b.width).toBe(20);
    expect(b.height).toBeCloseTo(20);
    expect(b.ymin).toBeCloseTo(-5);
    expect(b.ymax).toBeCloseTo(15);
  });

  it('returns `this` for chaining', () => {
    const b = new Bounds(0, 0, 10, 5);
    expect(b.fillOut(1.0)).toBe(b);
  });

  it('asymmetric focus shifts the padding distribution', () => {
    const b = new Bounds(0, 0, 10, 20); // aspect 0.5, padding goes horizontal
    b.fillOut(1.0, 0.0, 0.5); // focusX=0 → pad ALL goes to xmin side
    // pad = 10, all on xmin side → xmin=-10, xmax=10
    expect(b.xmin).toBeCloseTo(-10);
    expect(b.xmax).toBeCloseTo(10);
  });
});

describe('Bounds.scale', () => {
  it('scales around the center', () => {
    const b = new Bounds(0, 0, 10, 10);
    b.scale(2);
    // center (5,5) preserved, w/h doubled to 20
    expect(b.centerX).toBe(5);
    expect(b.centerY).toBe(5);
    expect(b.width).toBe(20);
    expect(b.height).toBe(20);
  });

  it('shrinks when k < 1', () => {
    const b = new Bounds(0, 0, 10, 10);
    b.scale(0.5);
    expect(b.width).toBe(5);
    expect(b.height).toBe(5);
    expect(b.centerX).toBe(5); // center unchanged
  });
});
