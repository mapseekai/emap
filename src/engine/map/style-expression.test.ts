import { describe, expect, it } from 'vitest';
import {
  compileStyleExpression,
  isStyleExpression,
  StyleExpressionError,
} from './style-expression';

const rec = { pop: 100, name: 'A', flag: true };

describe('compileStyleExpression atoms', () => {
  it('get returns field or null', () => {
    expect(compileStyleExpression(['get', 'pop'])(rec)).toBe(100);
    expect(compileStyleExpression(['get', 'missing'])(rec)).toBeNull();
    expect(compileStyleExpression(['get', 'pop'])(null)).toBeNull();
  });
  it('literal scalars evaluate to themselves', () => {
    expect(compileStyleExpression(5)(rec)).toBe(5);
    expect(compileStyleExpression('#fff')(rec)).toBe('#fff');
  });
  it('comparisons coerce numbers and strict-equal others', () => {
    expect(compileStyleExpression(['>', ['get', 'pop'], 50])(rec)).toBe(true);
    expect(compileStyleExpression(['<=', ['get', 'pop'], 100])(rec)).toBe(true);
    expect(compileStyleExpression(['==', ['get', 'name'], 'A'])(rec)).toBe(true);
    expect(compileStyleExpression(['==', ['get', 'pop'], '100'])(rec)).toBe(false);
    expect(compileStyleExpression(['<', ['get', 'name'], 1])(rec)).toBe(false); // NaN → false
  });
  it('logic atoms', () => {
    expect(compileStyleExpression(['!', ['get', 'flag']])(rec)).toBe(false);
    expect(compileStyleExpression(['all', ['>', ['get', 'pop'], 1], ['get', 'flag']])(rec)).toBe(
      true,
    );
    expect(
      compileStyleExpression(['any', ['==', ['get', 'name'], 'B'], ['get', 'flag']])(rec),
    ).toBe(true);
  });
  it('match with fallback', () => {
    const fn = compileStyleExpression(['match', ['get', 'name'], 'A', '#111', '#999']);
    expect(fn(rec)).toBe('#111');
    expect(fn({ name: 'B' })).toBe('#999');
    expect(compileStyleExpression(['match', ['get', 'name'], ['A', 'B'], 1, 0])(rec)).toBe(1);
  });
  it('step boundaries', () => {
    const fn = compileStyleExpression(['step', ['get', 'pop'], '#a', 100, '#b', 200, '#c']);
    expect(fn({ pop: 50 })).toBe('#a');
    expect(fn({ pop: 100 })).toBe('#b');
    expect(fn({ pop: 999 })).toBe('#c');
    expect(fn({ pop: null })).toBe('#a'); // 非数 → 第一段
  });
  it('interpolate linear numeric with clamping', () => {
    const fn = compileStyleExpression(['interpolate', 'linear', ['get', 'pop'], 0, 0, 100, 10]);
    expect(fn({ pop: 50 })).toBe(5);
    expect(fn({ pop: -5 })).toBe(0);
    expect(fn({ pop: 500 })).toBe(10);
  });
  it('interpolate linear hex colors', () => {
    const fn = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'pop'],
      0,
      '#000000',
      100,
      '#ffffff',
    ]);
    expect(fn({ pop: 50 })).toBe('rgb(128,128,128)');
  });
  it('interpolate with color outputs quantizes input to 256 global levels (bucket cardinality bound)', () => {
    const fn = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'pop'],
      0,
      '#000000',
      100,
      '#ffffff',
    ]);
    expect(fn({ pop: 1 })).toBe(fn({ pop: 1.001 })); // 同全域桶
    expect(fn({ pop: 50 })).toBe('rgb(128,128,128)'); // 0.5 可精确表示，不变
  });
  it('multi-stop color interpolate keeps total distinct outputs ≤ 257', () => {
    const fn = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'v'],
      0,
      '#000000',
      33,
      '#ff0000',
      66,
      '#00ff00',
      100,
      '#ffffff',
    ]);
    const distinct = new Set<string>();
    for (let k = 0; k < 2000; k++) distinct.add(String(fn({ v: (k * 100) / 1999 })));
    distinct.add(String(fn({})));
    expect(distinct.size).toBeLessThanOrEqual(257);
  });
  it('evaluates dynamic outputs while static colors remain quantized', () => {
    const fn = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'v'],
      0,
      '#000000',
      1,
      ['get', 'color'],
      2,
      '#ffffff',
    ]);
    expect(fn({ v: 1, color: '#123456' })).toBe('rgb(18,52,86)');
    expect(fn({ v: 1, color: '#abcdef' })).toBe('rgb(171,205,239)');
    expect(fn({ v: 0.001, color: '#abcdef' })).toBe(fn({ v: 0.001001, color: '#abcdef' }));
  });
  it('avoids non-finite color interpolation for extreme stops', () => {
    const fn = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'v'],
      -Number.MAX_VALUE,
      '#000000',
      Number.MAX_VALUE,
      '#ffffff',
    ]);
    expect(fn({ v: -Number.MAX_VALUE })).toBe('rgb(0,0,0)');
    expect(fn({ v: Number.MAX_VALUE })).toBe('rgb(255,255,255)');
    expect(fn({ v: Number.MAX_VALUE / 2 })).toBe('rgb(191,191,191)');
  });
  it('quantizes static multi-stop colors over an extreme domain', () => {
    const fn = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'x'],
      -Number.MAX_VALUE,
      '#000000',
      0,
      '#ff0000',
      Number.MAX_VALUE,
      '#00ff00',
    ]);
    const distinct = new Set<string>();
    for (let k = 0; k <= 256; k++) {
      distinct.add(String(fn({ x: -Number.MAX_VALUE * (1 - k / 256) })));
      distinct.add(String(fn({ x: (Number.MAX_VALUE * k) / 256 })));
    }
    expect(distinct.size).toBeLessThanOrEqual(257);
  });
});

describe('validation', () => {
  it('rejects unknown op / bad arity at compile time', () => {
    expect(() => compileStyleExpression(['bogus', 1])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['get'])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['interpolate', 'cubic', ['get', 'pop'], 0, 0])).toThrow(
      StyleExpressionError,
    );
    expect(() => compileStyleExpression(['step', ['get', 'pop']])).toThrow(StyleExpressionError);
  });
  it('rejects unsupported values and invalid operands', () => {
    expect(() => compileStyleExpression(['!', undefined])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['get', 1])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['==', 1])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['!', 1, 2])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['all'])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['any'])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['match', ['get', 'x'], 'A', 1, 'B', 2])).toThrow(
      StyleExpressionError,
    );
    expect(() => compileStyleExpression(['step', ['get', 'x'], 0, 'bad', 1])).toThrow(
      StyleExpressionError,
    );
    expect(() => compileStyleExpression(['step', ['get', 'x'], 0, 2, 1, 1, 2])).toThrow(
      StyleExpressionError,
    );
    expect(() =>
      compileStyleExpression(['interpolate', 'linear', ['get', 'x'], 'bad', 0, 1, 1]),
    ).toThrow(StyleExpressionError);
    expect(() =>
      compileStyleExpression(['interpolate', 'linear', ['get', 'x'], 0, 0, 0, 1]),
    ).toThrow(StyleExpressionError);
  });
  it('treats non-numeric input as the first step or interpolate output', () => {
    const step = compileStyleExpression(['step', ['get', 'x'], 'first', -1, 'next']);
    const interpolate = compileStyleExpression([
      'interpolate',
      'linear',
      ['get', 'x'],
      -1,
      0,
      1,
      10,
    ]);
    expect(step({ x: null })).toBe('first');
    expect(interpolate({ x: null })).toBe(0);
  });
  it('rejects non-finite step and interpolate stops', () => {
    expect(() => compileStyleExpression(['step', ['get', 'x'], 0, NaN, 1])).toThrow(
      StyleExpressionError,
    );
    expect(() => compileStyleExpression(['step', ['get', 'x'], 0, Infinity, 1])).toThrow(
      StyleExpressionError,
    );
    expect(() =>
      compileStyleExpression(['interpolate', 'linear', ['get', 'x'], 0, 0, Infinity, 1]),
    ).toThrow(StyleExpressionError);
  });
  it('preserves StyleExpressionError and nested error paths', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const nullPrototype: Record<string, unknown> = Object.create(null);
    nullPrototype.value = 1n;
    expect(() => compileStyleExpression(['!', circular])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['!', nullPrototype])).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['!', ['step', ['get', 'x'], 0, 'bad', 1]])).toThrow(
      '$[1][3]: step stop must be number',
    );
  });
  it('isStyleExpression narrows arrays with string op', () => {
    expect(isStyleExpression(['get', 'a'])).toBe(true);
    expect(isStyleExpression('#fff')).toBe(false);
    expect(isStyleExpression([])).toBe(false);
  });
});
