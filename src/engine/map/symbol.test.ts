import { describe, expect, it } from 'vitest';
import {
  compileSymbolStyle,
  cloneSymbolStyle,
  updateSymbolProperty,
  type SymbolStyle,
} from './symbol';

const style: SymbolStyle = {
  images: { marker: { url: '/marker.png', size: [24, 32] } },
  layout: {
    'icon-image': 'marker',
    'icon-size': 2,
    'icon-anchor': 'bottom',
    'icon-offset': [2, 3],
    'icon-rotate': 90,
    'text-field': ['get', 'name'],
    'text-size': 14,
    'text-offset': [0, 1.2],
    'text-allow-overlap': false,
  },
  paint: {
    'icon-opacity': 0.75,
    'text-color': '#243447',
    'text-halo-color': '#fff',
    'text-halo-width': 1.5,
  },
  labeling: {
    placement: 'parallel',
    priority: ['get', 'rank'],
    maxLabels: 500,
  },
};
describe('attached symbol style mapping', () => {
  it('maps the proposed layout/paint API without changing source data or the input', () => {
    const before = JSON.stringify(style),
      result = compileSymbolStyle(style, 'circle');
    expect(result.label).toMatchObject({
      field: 'name',
      fontSize: 14,
      offset: [0, 16.8],
      color: '#243447',
      haloWidth: 1.5,
      placement: 'parallel',
      priority: ['get', 'rank'],
      maxLabels: 500,
    });
    expect(result.icon).toMatchObject({
      url: '/marker.png',
      size: [48, 64],
      anchor: [0.5, 1],
      opacity: 0.75,
    });
    expect(result.icon!.offset![0]).toBeCloseTo(-6);
    expect(result.icon!.offset![1]).toBeCloseTo(4);
    expect(JSON.stringify(style)).toBe(before);
  });
  it('recomputes em offsets after text-size changes and factors after icon-size changes', () => {
    const next = updateSymbolProperty(style, 'layout', 'text-size', 20);
    expect(compileSymbolStyle(next, 'circle').label!.offset).toEqual([0, 24]);
    const defaults = updateSymbolProperty(next, 'layout', 'icon-size', null);
    expect(compileSymbolStyle(defaults, 'circle').icon!.size).toEqual([24, 32]);
    expect(style.layout!['text-size']).toBe(14);
  });
  it('rejects unsupported or misplaced properties, expressions, missing images and non-point icons', () => {
    expect(() =>
      compileSymbolStyle({ layout: { 'text-size': ['get', 'size'] } as any }, 'circle'),
    ).toThrow();
    expect(() =>
      compileSymbolStyle({ layout: { 'text-halo-color': 'red' } as any }, 'circle'),
    ).toThrow('paint');
    expect(() => compileSymbolStyle({ paint: { 'text-size': 14 } as any }, 'circle')).toThrow(
      'layout',
    );
    expect(() => compileSymbolStyle({ layout: { 'icon-image': 'missing' } }, 'circle')).toThrow(
      'missing',
    );
    expect(() => compileSymbolStyle(style, 'fill')).toThrow('point');
    expect(() => updateSymbolProperty(style, 'layout', 'text-max-angle', null)).toThrow(
      'Unsupported',
    );
    expect(() => compileSymbolStyle({ layout: { 'text-font': ['A', 'B'] } }, 'circle')).toThrow(
      'one',
    );
  });
  it('deep clones resource metadata and expression trees and hides only symbols', () => {
    const copied = cloneSymbolStyle(style);
    (copied.layout!['text-field'] as any[])[1] = 'changed';
    const coordinates = copied.images!.marker.size;
    if (!Array.isArray(coordinates)) throw new Error('Expected cloned coordinate tuple');
    Reflect.set(coordinates, 0, 100);
    expect((style.layout!['text-field'] as any[])[1]).toBe('name');
    expect(style.images!.marker.size).toEqual([24, 32]);
    const hidden = compileSymbolStyle(
      { ...style, layout: { ...style.layout, visibility: 'none' } },
      'circle',
    );
    expect(hidden.label!.enabled).toBe(false);
    expect(hidden.icon!.enabled).toBe(false);
  });
});
