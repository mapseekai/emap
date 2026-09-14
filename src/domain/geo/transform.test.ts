import { describe, expect, it } from 'vitest';
import { AffineTransform, Transform } from './transform';
import { Bounds } from './bounds';

describe('AffineTransform construction', () => {
  it('default constructor is the identity', () => {
    const t = new AffineTransform();
    expect(t.mx).toBe(1);
    expect(t.my).toBe(1);
    expect(t.bx).toBe(0);
    expect(t.by).toBe(0);
  });

  it('explicit constructor fills the values', () => {
    const t = new AffineTransform(2, 3, 4, 5);
    expect([t.mx, t.my, t.bx, t.by]).toEqual([2, 3, 4, 5]);
  });

  it('Transform alias is the same class (back-compat)', () => {
    expect(Transform).toBe(AffineTransform);
  });
});

describe('AffineTransform.project / unproject', () => {
  it('identity transform leaves coords unchanged', () => {
    const t = new AffineTransform();
    expect(t.project(3, 4)).toEqual([3, 4]);
    expect(t.unproject(3, 4)).toEqual([3, 4]);
  });

  it('project applies scale + translate per axis', () => {
    const t = new AffineTransform(2, 3, 10, 20);
    expect(t.project(1, 2)).toEqual([12, 26]); // 1*2+10, 2*3+20
  });

  it('unproject is the inverse of project', () => {
    const t = new AffineTransform(2, -3, 10, 20);
    const [x, y] = [7, 11];
    const [px, py] = t.project(x, y);
    const [ux, uy] = t.unproject(px, py);
    expect(ux).toBeCloseTo(x);
    expect(uy).toBeCloseTo(y);
  });
});

describe('AffineTransform.fromBounds', () => {
  it('maps src bounds to dst bounds without flip', () => {
    const src = new Bounds(0, 0, 100, 50);
    const dst = new Bounds(0, 0, 200, 100);
    const t = AffineTransform.fromBounds(src, dst);
    // Corners should map to corners.
    expect(t.project(0, 0)).toEqual([0, 0]);
    expect(t.project(100, 50)).toEqual([200, 100]);
  });

  it('flipY=true flips the y axis (canvas convention)', () => {
    const src = new Bounds(0, 0, 100, 50);
    const dst = new Bounds(0, 0, 200, 100);
    const t = AffineTransform.fromBounds(src, dst, true);
    // src ymin=0 (geo south) → dst ymax=100 (canvas south of viewport top)
    expect(t.project(0, 0)).toEqual([0, 100]);
    expect(t.project(100, 50)).toEqual([200, 0]);
  });

  // Note: a zero-width src bbox would produce mx=Infinity (the `|| 1`
  // fallback only catches `0/x = 0`, not `x/0 = Infinity`). Callers
  // should reject degenerate-bbox sources before calling fromBounds.
  // Documented here so a future "fix" doesn't get reverted by surprise.
});

describe('AffineTransform.translate', () => {
  it('shifts the origin without affecting scale', () => {
    const t = new AffineTransform(2, 3, 10, 20);
    t.translate(5, -7);
    expect(t.bx).toBe(15);
    expect(t.by).toBe(13);
    expect(t.mx).toBe(2);
    expect(t.my).toBe(3);
  });

  it('the translation affects projected output', () => {
    const t = new AffineTransform();
    t.translate(10, 20);
    expect(t.project(0, 0)).toEqual([10, 20]);
  });
});

describe('AffineTransform.scale', () => {
  it('scales around the given pixel pivot — pivot stays put', () => {
    const t = new AffineTransform(); // identity
    // Project the pivot (5, 5) to whatever it maps to (also (5,5) for identity).
    // After scaling by k at pivot p, the projected pivot should still be p.
    const px = 5;
    const py = 5;
    t.scale(2, px, py);
    expect(t.project(px, py)[0]).toBeCloseTo(px);
    expect(t.project(px, py)[1]).toBeCloseTo(py);
    // scale factor doubled
    expect(t.mx).toBe(2);
    expect(t.my).toBe(2);
  });

  it('repeated scaling compounds multiplicatively', () => {
    const t = new AffineTransform(); // identity
    t.scale(2, 0, 0);
    t.scale(3, 0, 0);
    expect(t.mx).toBe(6);
    expect(t.my).toBe(6);
  });
});

describe('AffineTransform.clone', () => {
  it('produces an independent copy', () => {
    const a = new AffineTransform(2, 3, 10, 20);
    const b = a.clone();
    b.translate(5, 5);
    expect(a.bx).toBe(10); // unchanged
    expect(b.bx).toBe(15);
  });
});
