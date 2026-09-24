import { expect, it } from 'vitest';
import { geometryBatchIds } from './geometry-batches';
it('groups consecutive chunks without losing identities or exceeding bounded batch costs', () => {
  const costs = Uint32Array.from([2, 3, 4, 5, 15, 1, 2, 3]);
  const groups = geometryBatchIds(costs, 10, 3);
  expect([...groups]).toEqual([0, 0, 0, 3, 4, 5, 5, 5]);
  for (const first of new Set(groups)) {
    const ids = [...groups.keys()].filter((i) => groups[i] === first);
    expect(ids.length).toBeLessThanOrEqual(3);
    if (ids.length > 1) expect(ids.reduce((n, i) => n + costs[i], 0)).toBeLessThanOrEqual(10);
  }
});
it('keeps empty and single oversized inputs bounded without silently truncating work', () => {
  expect(geometryBatchIds(new Uint32Array(), 10)).toEqual(new Uint32Array());
  expect([...geometryBatchIds(Uint32Array.from([100, 1, 2]), 10)]).toEqual([0, 1, 1]);
});
