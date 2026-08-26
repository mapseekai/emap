import { describe, expect, it } from 'vitest';
import { shoelaceArea } from './geometry-2d';

describe('shoelaceArea', () => {
  it('returns signed area for open and closed rings', () => {
    expect(
      shoelaceArea([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
    ).toBe(12);
    expect(
      shoelaceArea([
        [0, 0],
        [0, 3],
        [4, 3],
        [4, 0],
        [0, 0],
      ]),
    ).toBe(-12);
  });
});
