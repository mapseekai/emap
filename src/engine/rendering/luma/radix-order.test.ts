import { describe, expect, it } from 'vitest';
import { radixOrder } from './radix-order';
describe('stable unsigned Morton ordering', () => {
  it('matches comparison sort including ties, sign bit and full uint32 range', () => {
    let state = 1729;
    const values = Uint32Array.from({ length: 65539 }, (_, i) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return i % 4 === 0 ? 0xffffffff : i % 4 === 1 ? 0 : state;
    });
    const before = values.slice();
    const expected = Uint32Array.from(values, (_, i) => i).sort(
      (a, b) => values[a] - values[b] || a - b,
    );
    expect(radixOrder(values)).toEqual(expected);
    expect(values).toEqual(before);
  });
  it('handles empty, single and identical values without losing their original order', () => {
    for (const values of [
      new Uint32Array(),
      new Uint32Array([7]),
      new Uint32Array(200).fill(0x80000000),
    ])
      expect(radixOrder(values)).toEqual(Uint32Array.from(values, (_, i) => i));
  });
});
