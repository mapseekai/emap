import { describe, expect, it } from 'vitest';
import { symbolStyleFromLegacy, withSymbolLabel, withSymbolIcon } from './symbol-compat';
import { compileSymbolStyle } from './symbol';
import type { IconOptions } from './icon';
import type { LabelOptions } from './label';
const label: LabelOptions = {
  field: 'name',
  fontSize: 18,
  offset: [5, -9],
  fontFamily: 'Noto Sans SC',
  fontUrl: '/font.ttf',
  fontWeight: 700,
  fontStyle: 'italic',
  color: '#123456',
  haloWidth: 2,
  haloColor: '#fff',
  priority: ['get', 'rank'],
  placement: 'horizontal',
  maxLabels: 300,
  padding: 4,
  minScale: 1,
  maxScale: 10,
};
const icon: IconOptions = {
  url: '/marker.png',
  size: 32,
  anchor: [0.2, 0.8],
  rotation: 37,
  offset: [17, 9],
  opacity: 0.8,
  tint: '#456789',
  rect: [0, 0, 24, 48],
};
describe('legacy symbol compatibility', () => {
  it('round-trips native options including GIS placement, custom anchors and pre-rotated offsets', () => {
    const style = symbolStyleFromLegacy(label, icon),
      resolved = compileSymbolStyle(style, 'circle');
    expect(resolved.label).toMatchObject(label);
    expect(resolved.icon).toMatchObject({ ...icon, offset: expect.any(Array) });
    expect(resolved.icon!.offset![0]).toBeCloseTo(17, 10);
    expect(resolved.icon!.offset![1]).toBeCloseTo(9, 10);
  });
  it('preserves the other channel and image definition when updating/removing text', () => {
    const style = symbolStyleFromLegacy(label, icon),
      next = withSymbolLabel(style, { field: 'title', fontSize: 24 });
    expect(next.images).toEqual(style.images);
    expect(next.layout!['icon-image']).toBe(style.layout!['icon-image']);
    expect(compileSymbolStyle(next, 'circle').label!.field).toBe('title');
    expect(compileSymbolStyle(withSymbolLabel(next, null), 'circle').label).toBeUndefined();
    expect(style.layout!['text-size']).toBe(18);
  });
  it('retains text settings when replacing/removing icons and does not accumulate resources', () => {
    let style = symbolStyleFromLegacy(label, icon);
    for (let i = 0; i < 5; i++)
      style = withSymbolIcon(style, { url: `/icon${i}.png`, size: [20, 30] });
    expect(Object.keys(style.images!)).toHaveLength(1);
    const noIcon = compileSymbolStyle(withSymbolIcon(style, null), 'circle');
    expect(noIcon.icon).toBeUndefined();
    expect(noIcon.label).toMatchObject(label);
  });
});
