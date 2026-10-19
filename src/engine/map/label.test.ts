import { describe, it, expect } from 'vitest';
import { cloneLabelOptions, labelText, validateLabelOptions } from './label';
import { cloneLayerSpecification } from './layer';

describe('parent-owned label configuration', () => {
  it('preserves nested label settings without introducing a text layer type', () => {
    const source = {
      id: 'roads',
      source: 's',
      type: 'line' as const,
      label: {
        text: ['match', ['get', 'kind'], 1, '干道', '支路'],
        offset: [3, -5] as [number, number],
      },
    };
    const copy = cloneLayerSpecification(source);
    (copy.label!.text as any[])[1][1] = 'other';
    const coordinates = copy.label!.offset;
    if (!Array.isArray(coordinates)) throw new Error('Expected cloned coordinate tuple');
    Reflect.set(coordinates, 0, 99);
    expect(source.label.text[1]).toEqual(['get', 'kind']);
    expect(source.label.offset).toEqual([3, -5]);
    expect(copy.type).toBe('line');
    expect(Object.keys(copy)).not.toContain('textLayer');
  });
  it('rejects malformed or executable configuration before mutation', () => {
    for (const value of [
      null,
      [],
      {},
      { field: 'x', text: 'x' },
      { field: '' },
      { text: ['eval', 'process.exit()'] },
      { text: 'x', fontSize: NaN },
      { text: 'x', offset: [Infinity, 0] },
      { text: 'x', maxLabels: 1.5 },
      { text: 'x', unknown: true },
    ])
      expect(() => validateLabelOptions(value as any)).toThrow();
    expect(cloneLabelOptions({ enabled: false })).toEqual({ enabled: false });
  });
  it('bounds expression depth and converts zero/false without labelling missing objects', () => {
    let expression: any = ['get', 'x'];
    for (let i = 0; i < 20; i++) expression = ['!', expression];
    expect(() => validateLabelOptions({ text: expression })).toThrow('complexity');
    expect(labelText(0)).toBe('0');
    expect(labelText(false)).toBe('false');
    for (const v of [null, undefined, NaN, {}, () => {}]) expect(labelText(v)).toBe('');
    expect(labelText('中文\nLabel 🚉')).toBe('中文\nLabel 🚉');
    expect(labelText('a'.repeat(257))).toBe('');
  });
});
