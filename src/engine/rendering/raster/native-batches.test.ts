import { describe, it, expect } from 'vitest';
import { planNativeRasterBatch } from './native-batches';
import type { NativeRasterTile } from './native-tiles';
const level = {
  id: 0,
  width: 8192,
  height: 8192,
  tileWidth: 512,
  tileHeight: 512,
  decodedBlockConcurrency: 4,
  samples: 3,
  bits: [16, 16, 16],
  formats: [1, 1, 1],
  photometric: 1,
  subfileType: 0,
};
function tile(x: number, y = 0, l = level): NativeRasterTile {
  const size = 256;
  return {
    key: `${l.id}:${x}:${y}`,
    level: l,
    core: [x * size, y * size, (x + 1) * size, (y + 1) * size],
    window: [
      Math.max(0, x * size - 1),
      Math.max(0, y * size - 1),
      (x + 1) * size + 1,
      (y + 1) * size + 1,
    ],
    bounds: [x * size, y * size, (x + 1) * size, (y + 1) * size],
  };
}
describe('bounded native rectangular read batches', () => {
  it('combines contiguous siblings with one shared halo, without changing tile objects', () => {
    const input = [tile(2), tile(1), tile(3), tile(0)];
    const batch = planNativeRasterBatch(input)!;
    expect(batch.tiles).toEqual(input);
    expect(batch.request.window).toEqual([0, 0, 1025, 257]);
    expect(batch.request.samples).toEqual([0, 1, 2]);
    expect(input[0].window).toEqual([511, 0, 769, 257]);
  });
  it('prefers a complete 2x2 COG rectangle over separate halo reads', () => {
    const input = [tile(2, 2), tile(3, 2), tile(2, 3), tile(3, 3)];
    const batch = planNativeRasterBatch(input)!;
    expect(batch.tiles).toHaveLength(4);
    expect(batch.request.window).toEqual([511, 511, 1025, 1025]);
  });
  it('never spans absent tiles, rows, or overview levels', () => {
    const first = tile(0);
    expect(
      planNativeRasterBatch([first, tile(2), tile(1, 1), tile(1, 0, { ...level, id: 1 })])!.tiles,
    ).toEqual([first]);
  });
  it('caps batches at four tiles and validates the memory budget', () => {
    const batch = planNativeRasterBatch(Array.from({ length: 10 }, (_, i) => tile(i)))!;
    expect(batch.tiles).toHaveLength(4);
    expect(batch.request.window[2]).toBe(1025);
    const huge = { ...level, tileWidth: 8192, tileHeight: 8192 };
    expect(planNativeRasterBatch([tile(0, 0, huge), tile(1, 0, huge)])!.tiles).toHaveLength(1);
  });
  it('does not create requests for empty candidate sets', () =>
    expect(planNativeRasterBatch([])).toBe(null));
});

it('keeps two 2x2 groups for a 4x2 viewport instead of leaving two separate fringes', () => {
  const make = (x: number, y: number): NativeRasterTile => ({
    key: `${x}:${y}`,
    level,
    core: [x * 512, y * 512, (x + 1) * 512, (y + 1) * 512],
    window: [x * 512 - 1, y * 512 - 1, (x + 1) * 512 + 1, (y + 1) * 512 + 1],
    bounds: [0, 0, 1, 1],
  });
  const candidates = [
    [6, 5],
    [7, 5],
    [6, 6],
    [7, 6],
    [5, 5],
    [8, 5],
    [5, 6],
    [8, 6],
  ].map(([x, y]) => make(x, y));
  const first = planNativeRasterBatch(candidates)!;
  expect(first.tiles).toHaveLength(4);
  expect(
    planNativeRasterBatch(candidates.filter((t) => !first.tiles.includes(t)))!.tiles,
  ).toHaveLength(4);
});
