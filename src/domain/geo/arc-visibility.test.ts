import { describe, expect, it, vi } from 'vitest';
import { arcVisibilityFilter, arcVisibilityKey } from './arc-visibility';
describe('semantic viewport arc filters', () => {
  it('matches the original short-circuit predicate and snapshots bounds', () => {
    const arcs = {
      arcIsSmaller: vi.fn((id: number) => id === 0),
      arcIntersectsBBox: vi.fn((id: number) => id !== 1),
    };
    const bounds = [0, 0, 10, 10],
      filter = arcVisibilityFilter(arcs, 0.35, bounds);
    bounds[0] = 200;
    expect([0, 1, 2].map(filter)).toEqual([false, false, true]);
    expect(arcs.arcIntersectsBBox).toHaveBeenCalledTimes(2);
    expect(arcs.arcIntersectsBBox).toHaveBeenLastCalledWith(2, [0, 0, 10, 10]);
    expect(arcVisibilityKey(arcs, filter)).toEqual([0.35, 0, 0, 10, 10]);
  });
  it('distinguishes extent/threshold/owner and rejects unregistered or wrapped predicates', () => {
    const arcs = {},
      other = {},
      a = arcVisibilityFilter(arcs, 0.35, [0, 0, 10, 10]);
    const b = arcVisibilityFilter(arcs, 0.35, [0, 0, 10, 10]);
    expect(arcVisibilityKey(arcs, a)).toEqual(arcVisibilityKey(arcs, b));
    expect(arcVisibilityKey(arcs, a)).not.toEqual(
      arcVisibilityKey(arcs, arcVisibilityFilter(arcs, 0.4, [0, 0, 10, 10])),
    );
    expect(arcVisibilityKey(arcs, a)).not.toEqual(
      arcVisibilityKey(arcs, arcVisibilityFilter(arcs, 0.35, [1, 0, 10, 10])),
    );
    expect(arcVisibilityKey(other, a)).toBeUndefined();
    expect(arcVisibilityKey(arcs, (id) => a(id))).toBeUndefined();
    expect(
      arcVisibilityKey(
        arcs,
        Object.assign(() => true, { cacheKey: 'pretend' }),
      ),
    ).toBeUndefined();
    expect(arcVisibilityKey(arcs, undefined)).toBeUndefined();
  });
});
