import { describe, it, expect } from 'vitest';
import { AffineTransform } from './transform';
import { PerspectiveTransform, groundBounds, groundSnapshotMatrix } from './perspective-transform';

const flat = new AffineTransform(0.12, -0.12, 600 - 13000000 * 0.12, 400 + 4000000 * 0.12);
function close(a: readonly number[], b: readonly number[], digits = 6) {
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i], digits));
}
describe('luma ground-plane perspective', () => {
  it('is exactly the original transform at pitch/bearing zero', () => {
    const view = new PerspectiveTransform(flat, 1200, 800);
    expect(view.project(13000230, 4000380)).toEqual(flat.project(13000230, 4000380));
    expect(view.unproject(700, 300)).toEqual(flat.unproject(700, 300));
    expect(view.clone().active).toBe(false);
  });
  for (const pitch of [0, 35, 60])
    for (const bearing of [-170, -45, 0, 90, 180]) {
      it(`round-trips viewport rays at pitch ${pitch}, bearing ${bearing}`, () => {
        const view = new PerspectiveTransform(flat, 1200, 800, { pitch, bearing });
        for (const x of [0, 130, 600, 1111, 1200])
          for (const y of [0, 37, 400, 715, 800])
            close(view.project(...view.unproject(x, y)), [x, y]);
        close(view.project(...flat.unproject(600, 400)), [600, 400]);
        close(view.clone().project(13000230, 4000380), view.project(13000230, 4000380));
      });
    }
  it('makes the near side larger and rotates north left at bearing 90', () => {
    const view = new PerspectiveTransform(new AffineTransform(), 1000, 800, { pitch: 50 });
    expect(view.project(600, 600)[0] - 500).toBeGreaterThan(view.project(600, 200)[0] - 500);
    view.setOrientation({ pitch: 0, bearing: 90 });
    close(view.project(500, 300), [400, 400]);
  });
  it('keeps the wheel anchor and grabbed point fixed at noncentral screen positions', () => {
    const view = new PerspectiveTransform(flat, 1200, 800, { pitch: 60, bearing: 73 });
    const anchor = view.unproject(1013, 670);
    view.scale(2.3, 1013, 670);
    close(view.project(...anchor), [1013, 670]);
    const grabbed = view.unproject(315, 167);
    view.pan(51, -37, 366, 130);
    close(view.project(...grabbed), [366, 130]);
  });
  it('preserves center and orientation on resize', () => {
    const view = new PerspectiveTransform(flat, 1200, 800, { pitch: 60, bearing: -43 });
    const center = view.center;
    view.resize(900, 1300);
    close(view.center, center);
    close(view.project(...center), [450, 650]);
    expect(view.pitch).toBe(60);
  });
  it('covers all four inverse-projected corners, not only the diagonal', () => {
    const view = new PerspectiveTransform(flat, 1200, 800, { pitch: 50, bearing: 60 });
    const b = groundBounds(view, 1200, 800, 8);
    for (const [x, y] of [
      [-8, -8],
      [1208, -8],
      [-8, 808],
      [1208, 808],
    ]) {
      const p = view.unproject(x, y);
      expect(p[0]).toBeGreaterThanOrEqual(b[0]);
      expect(p[0]).toBeLessThanOrEqual(b[2]);
      expect(p[1]).toBeGreaterThanOrEqual(b[1]);
      expect(p[1]).toBeLessThanOrEqual(b[3]);
    }
  });
  it('rejects invalid camera values atomically and normalizes bearing', () => {
    const view = new PerspectiveTransform(flat, 1200, 800, { pitch: 30, bearing: 450 });
    expect(view.bearing).toBe(90);
    for (const pitch of [-1, 61, NaN, Infinity])
      expect(() => view.setOrientation({ pitch })).toThrow();
    expect(view.pitch).toBe(30);
    expect(() => view.setOrientation({ bearing: NaN })).toThrow();
    expect(() => view.resize(0, 800)).toThrow();
    expect(view.width).toBe(1200);
  });
});

it('selects near-side raster detail without losing large-coordinate precision', () => {
  const view = new PerspectiveTransform(flat, 1200, 800, { pitch: 60, bearing: 35 });
  expect(view.groundResolution()).toBeLessThan(1 / flat.mx);
  expect(view.groundResolution()).toBeGreaterThan(0);
  view.setOrientation({ pitch: 0, bearing: 0 });
  expect(view.groundResolution()).toBeCloseTo(1 / flat.mx, 10);
  const before = view.clone();
  expect(() => view.scale(Number.MAX_VALUE, 0, 0)).toThrow();
  expect(view.flat).toEqual(before.flat);
});

it('reprojects a ground screenshot through combined pitch, rotation, pan and zoom', () => {
  for (const pitch of [0, 35, 60])
    for (const bearing of [-40, 0, 80]) {
      const from = new PerspectiveTransform(flat, 1200, 800, { pitch, bearing });
      const to = from
        .clone()
        .setOrientation({ pitch: Math.min(60, pitch + 4), bearing: bearing + 7 });
      to.pan(15, -8);
      to.scale(1.07, 710, 460);
      const matrix = groundSnapshotMatrix(from, to, 1200, 800);
      expect(matrix).not.toBeNull();
      const m = matrix!;
      for (const x of [0, 230, 600, 1130, 1200])
        for (const y of [0, 135, 400, 800]) {
          const w = m[3] * x + m[7] * y + m[15];
          close(
            [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w],
            to.project(...from.unproject(x, y)),
            5,
          );
        }
    }
});
it('rejects a screenshot that would straddle the next camera plane', () => {
  const from = new PerspectiveTransform(new AffineTransform(1, -1, 500, 400), 1000, 800, {
    pitch: 60,
  });
  const to = from.clone();
  to.scale(1000, 500, 400);
  expect(groundSnapshotMatrix(from, to, 1000, 800)).toBeNull();
});
