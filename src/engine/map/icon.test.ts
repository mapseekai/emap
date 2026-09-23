import { describe, it, expect } from 'vitest';
import { cloneIconOptions, iconMetrics, validateIconOptions } from './icon';
import { cloneLayerSpecification } from './layer';

describe('point-bound icon configuration', () => {
  it('deep copies icon options without creating a new layer type', () => {
    const icon = {
      url: '/pin.png',
      size: [24, 40] as [number, number],
      anchor: [0.5, 1] as [number, number],
      rect: [4, 5, 20, 30] as [number, number, number, number],
    };
    const original = { id: 'points', type: 'circle' as const, source: 's', icon };
    const copied = cloneLayerSpecification(original);
    expect(copied.type).toBe('circle');
    expect(copied).toEqual(original);
    icon.size[0] = 99;
    icon.anchor[0] = 0;
    icon.rect[0] = 100;
    expect((copied as typeof original).icon.size).toEqual([24, 40]);
    expect((copied as typeof original).icon.anchor).toEqual([0.5, 1]);
    expect((copied as typeof original).icon.rect).toEqual([4, 5, 20, 30]);
  });
  it('rejects unsafe schemes and malformed dimensions before loading', () => {
    for (const patch of [
      { url: 'javascript:alert(1)' },
      { url: 'file:///tmp/a.png' },
      { size: NaN },
      { size: [0, 20] },
      { anchor: [2, 0] },
      { offset: [Infinity, 0] },
      { opacity: 2 },
      { rotation: Infinity },
      { rect: [0, 0, 0, 10] },
      { unknown: true },
    ])
      expect(() => validateIconOptions({ url: '/pin.png', ...patch } as any)).toThrow();
    expect(
      cloneIconOptions({ url: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', size: 32 }),
    ).toHaveProperty('size', 32);
  });
  it('resolves height-based aspect ratio, crop and rotated anchor footprint', () => {
    const m = iconMetrics(
      {
        url: '/atlas.png',
        rect: [32, 0, 16, 32],
        size: 40,
        anchor: [0.5, 1],
        rotation: 90,
        offset: [3, 4],
      },
      64,
      64,
    );
    expect(m.size).toEqual([20, 40]);
    expect(m.bounds[0]).toBeCloseTo(3);
    expect(m.bounds[1]).toBeCloseTo(-6);
    expect(m.bounds[2]).toBeCloseTo(43);
    expect(m.bounds[3]).toBeCloseTo(14);
    expect(() => iconMetrics({ url: '/x', rect: [60, 0, 16, 10] }, 64, 64)).toThrow();
  });
});
