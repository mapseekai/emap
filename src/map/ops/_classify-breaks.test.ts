import { describe, expect, it } from 'vitest';
import {
  classIndexOf,
  equalIntervalBreaks,
  niceBreaks,
  quantileBreaks,
  summarizeCategorical,
  summarizeSequential,
} from './_classify-breaks';

describe('breaks', () => {
  it('quantile of 1..100 into 4 classes', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantileBreaks(values, 4)).toEqual([25, 50, 75]);
  });

  it('equal-interval 0..100 into 4', () => {
    expect(equalIntervalBreaks(0, 100, 4)).toEqual([25, 50, 75]);
  });

  it('nice rounds step to 1/2/2.5/5×10^k', () => {
    expect(niceBreaks(3, 97, 4)).toEqual([25, 50, 75]);
    expect(niceBreaks(0, 43, 4)).toEqual([12.5, 25, 37.5]);
  });

  it('classIndexOf: boundary belongs to upper class; below-first → 0', () => {
    expect(classIndexOf(9, [10, 25])).toBe(0);
    expect(classIndexOf(10, [10, 25])).toBe(1);
    expect(classIndexOf(999, [10, 25])).toBe(2);
  });

  it('preserves the class count for a single repeated value', () => {
    expect(quantileBreaks([7], 4)).toEqual([7, 7, 7]);
    expect(quantileBreaks([7, 7, 7], 4)).toEqual([7, 7, 7]);
  });
});

describe('summaries honour 划分不变量', () => {
  it('sequential counts + nullCount === total', () => {
    const s = summarizeSequential([1, 20, 30, null, undefined, Number.NaN], [10, 25]);
    expect(s.counts).toEqual([1, 1, 1]);
    expect(s.nullCount).toBe(3);
  });

  it('categorical counts + otherCount + nullCount === total', () => {
    const s = summarizeCategorical(['a', 'b', 'c', 'c', null, 7], ['a', 'b']);
    expect(s.counts).toEqual([1, 1]);
    expect(s.otherCount).toBe(3); // 'c'×2, 7
    expect(s.nullCount).toBe(1);
  });

  it('empty input', () => {
    expect(summarizeSequential([], [1]).counts).toEqual([0, 0]);
    expect(summarizeCategorical([], ['x'])).toEqual({ counts: [0], otherCount: 0, nullCount: 0 });
  });

  it('counts an all-null input entirely as null', () => {
    expect(summarizeSequential([null, undefined, Number.NaN], [1])).toEqual({
      counts: [0, 0],
      nullCount: 3,
    });
    expect(summarizeCategorical([null, undefined, Number.NaN], ['x'])).toEqual({
      counts: [0],
      otherCount: 0,
      nullCount: 3,
    });
  });
});
