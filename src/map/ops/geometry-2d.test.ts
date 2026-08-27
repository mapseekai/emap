import { describe, expect, it } from 'vitest';
import { SegmentConflictIndex, shoelaceArea, type SegmentPair } from './geometry-2d';

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

describe('SegmentConflictIndex', () => {
  const square: SegmentPair[] = [
    [[0, 0], [4, 0]],
    [[4, 0], [4, 4]],
    [[4, 4], [0, 4]],
    [[0, 4], [0, 0]],
  ];

  it('accepts a clean closed ring (adjacent and wrap pairs exempt)', () => {
    expect(new SegmentConflictIndex([square]).hasConflict()).toBe(false);
  });

  it('detects a self-crossing closed ring', () => {
    const bowtie: SegmentPair[] = [
      [[0, 0], [4, 4]],
      [[4, 4], [4, 0]],
      [[4, 0], [0, 4]],
      [[0, 4], [0, 0]],
    ];
    expect(new SegmentConflictIndex([bowtie]).hasConflict()).toBe(true);
  });

  it('detects conflicts across rings but not between a contained hole', () => {
    const hole: SegmentPair[] = [
      [[1, 1], [2, 1]],
      [[2, 1], [2, 2]],
      [[2, 2], [1, 2]],
      [[1, 2], [1, 1]],
    ];
    expect(new SegmentConflictIndex([square, hole]).hasConflict()).toBe(false);
    const crossingHole: SegmentPair[] = [
      [[1, 1], [5, 1]],
      [[5, 1], [5, 2]],
      [[5, 2], [1, 2]],
      [[1, 2], [1, 1]],
    ];
    expect(new SegmentConflictIndex([square, crossingHole]).hasConflict()).toBe(true);
  });

  it('detects collinear overlap between non-adjacent segments', () => {
    const overlap: SegmentPair[] = [
      [[0, 0], [4, 0]],
      [[4, 0], [4, 2]],
      [[4, 2], [0, 2]],
      [[0, 2], [0, 0]],
      [[2, 0], [6, 0]],
    ];
    expect(new SegmentConflictIndex([overlap], false).hasConflict()).toBe(true);
  });

  it('does not exempt the first/last pair for open polylines', () => {
    const spike: SegmentPair[] = [
      [[0, 0], [2, 0]],
      [[2, 0], [2, 2]],
      [[2, 2], [0.5, 0]],
    ];
    expect(new SegmentConflictIndex([spike], false).hasConflict()).toBe(true);
    expect(new SegmentConflictIndex([spike], true).hasConflict()).toBe(false);
  });

  it('conflictsWithAny applies no exemptions and filters bbox near-misses', () => {
    const index = new SegmentConflictIndex([square]);
    expect(index.conflictsWithAny([[[1, -1], [1, 1]]])).toBe(true);
    expect(index.conflictsWithAny([[[0.5, -1], [3.5, -1]]])).toBe(false);
    expect(index.conflictsWithAny([[[4, 0], [4, 4]]])).toBe(true);
  });

  it('handles empty and degenerate inputs', () => {
    expect(new SegmentConflictIndex([]).hasConflict()).toBe(false);
    expect(new SegmentConflictIndex([[[[0, 0], [1, 1]]]]).hasConflict()).toBe(false);
    expect(new SegmentConflictIndex([square]).conflictsWithAny([])).toBe(false);
  });
});
