import { expect, it } from 'vitest';
import { screenPathFrame } from './screen-path-frame';
import { AffineTransform } from '../../../domain/geo/transform';
it('retains a frame across pans and within a resolution band without coarsening', () => {
  const bounds = [-20, -10, 80, 40] as const;
  for (const dpr of [1, 1.25, 2, 3])
    for (const scale of [0.0001, 0.1, 1, 100, 1e6]) {
      const a = new AffineTransform(scale, -scale, 200, 300),
        b = new AffineTransform(scale, -scale, 799, -201);
      const frame = screenPathFrame(a, bounds, dpr);
      expect(screenPathFrame(b, bounds, dpr)).toEqual(frame);
      expect(Math.abs(frame[0])).toBeGreaterThanOrEqual(scale);
      expect(Math.abs(frame[0]) / scale).toBeLessThanOrEqual(2 ** (1 / 8) + 1e-12);
      const canonical = new AffineTransform(...frame);
      for (const p of [
        [-19.234, 1.321],
        [20.323, 20.555],
        [79.421, 35.342],
      ]) {
        const q = canonical.project(p[0], p[1]);
        const snapped = q.map((v) => Math.trunc(v * dpr * 2) / (dpr * 2));
        const restored = canonical.unproject(snapped[0], snapped[1]);
        const actual = a.project(restored[0], restored[1]),
          expected = a.project(p[0], p[1]);
        expect(Math.abs(actual[0] - expected[0]) * dpr).toBeLessThanOrEqual(0.500001);
        expect(Math.abs(actual[1] - expected[1]) * dpr).toBeLessThanOrEqual(0.500001);
      }
    }
});
