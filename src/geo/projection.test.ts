import { describe, it, expect } from 'vitest';
import { Projection } from './projection';

describe('Projection.getScale (inverse of getZoom)', () => {
  it('round-trips zoom→scale→zoom in WebMercator', () => {
    const p = new Projection();
    p.setCRS('EPSG:3857');
    for (const z of [0, 1, 5, 12, 19]) {
      const s = p.getScale(z);
      expect(p.getZoom(s)).toBeCloseTo(z, 9);
    }
  });
  it('returns NaN when zoom is not meaningful (non-WebMercator)', () => {
    const p = new Projection(); // default EPSG:4326
    expect(Number.isNaN(p.getScale(5))).toBe(true);
  });
});
