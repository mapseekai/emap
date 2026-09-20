import { describe, expect, it } from 'vitest';
import { isFilledCircle, opaqueCircleGroup } from './point-pipeline';
import type { MeshPaint } from './types';
const paint: MeshPaint = { color: [0.2, 0.4, 0.8, 1], radius: 3 };
describe('circle pipeline policy', () => {
  it('specializes filled circles without requiring a shape conversion', () => {
    expect(isFilledCircle(paint)).toBe(true);
    expect(isFilledCircle({ ...paint, marker: [] })).toBe(true);
    expect(isFilledCircle({ ...paint, filled: false })).toBe(false);
    expect(isFilledCircle({ ...paint, marker: [-1, -1, 1, -1, 0, 1] })).toBe(false);
  });
  it('keeps original source-over for fractional opacity, including almost opaque colors', () => {
    for (const alpha of [0, 0.2, 0.5, 0.99, 0.999999])
      expect(opaqueCircleGroup({ ...paint, color: [0.2, 0.4, 0.8, alpha] }, true, 1.25)).toBeNull();
  });
  it('supports an explicit same-shader reference mode', () => {
    expect(opaqueCircleGroup(paint, false, 1.25)).toBeNull();
    expect(opaqueCircleGroup(paint, true, 1.25)).toBe('0.2,0.4,0.8,1');
  });
  it('does not run a core pass when the circle has no conservative opaque interior', () => {
    for (const radius of [0, 0.25, 0.5, 1])
      expect(opaqueCircleGroup({ ...paint, radius }, true, 1)).toBeNull();
    expect(opaqueCircleGroup({ ...paint, radius: 2 }, true, 1)).not.toBeNull();
    expect(opaqueCircleGroup({ ...paint, radius: 1.5 }, true, 2)).not.toBeNull();
  });
  it('rejects invalid ratios and never combines different colors', () => {
    for (const ratio of [0, -1, NaN, Infinity])
      expect(opaqueCircleGroup(paint, true, ratio)).toBeNull();
    expect(opaqueCircleGroup(paint, true, 1)).not.toBe(
      opaqueCircleGroup({ ...paint, color: [1, 0, 0, 1] }, true, 1),
    );
    expect(opaqueCircleGroup({ ...paint, filled: false }, true, 1)).toBeNull();
  });
});
