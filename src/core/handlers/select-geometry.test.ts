// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { dedupeRefs, featureMatchesLasso, pointInPolygon } from './select-geometry';

function makePathSource(
  layer: { name: string; geometry_type: 'polyline' | 'polygon'; shapes: any[] },
  paths: Record<number, Array<[number, number]>>,
) {
  return {
    getDataset: () => ({ layers: [layer] }),
    getArcs: () => ({
      getShapeIter: (part: number[]) => {
        const points = paths[part[0]] ?? [];
        let i = -1;
        return {
          x: 0,
          y: 0,
          hasNext() {
            i++;
            const p = points[i];
            if (!p) return false;
            this.x = p[0];
            this.y = p[1];
            return true;
          },
        };
      },
      getArcIter: vi.fn(),
    }),
  };
}

describe('dedupeRefs', () => {
  it('does not collapse distinct refs whose pipe-joined forms collide', () => {
    const refs = [
      { source: 'a|b', layer: 'c', id: 1 },
      { source: 'a', layer: 'b|c', id: 1 },
    ];

    expect(dedupeRefs(refs)).toEqual(refs);
  });
});

describe('pointInPolygon', () => {
  // Unit square 0..10 in both dims.
  const square: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('returns true for points strictly inside', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([1, 1], square)).toBe(true);
    expect(pointInPolygon([9, 9], square)).toBe(true);
  });

  it('returns false for points strictly outside', () => {
    expect(pointInPolygon([-1, 5], square)).toBe(false);
    expect(pointInPolygon([5, -1], square)).toBe(false);
    expect(pointInPolygon([11, 5], square)).toBe(false);
    expect(pointInPolygon([5, 11], square)).toBe(false);
  });

  it('handles a closed polygon (last == first) the same as open', () => {
    const closed: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(pointInPolygon([5, 5], closed)).toBe(true);
    expect(pointInPolygon([15, 5], closed)).toBe(false);
  });

  it('triangle: contains its centroid, excludes its outside', () => {
    const tri: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [5, 10],
    ];
    expect(pointInPolygon([5, 3], tri)).toBe(true);
    expect(pointInPolygon([5, -1], tri)).toBe(false);
    expect(pointInPolygon([0, 8], tri)).toBe(false);
  });
});

describe('featureMatchesLasso', () => {
  const lasso: Array<[number, number]> = [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
    [100, 100],
  ];

  it('matches a polyline that crosses the lasso when intersecting is enabled', () => {
    const map: any = {
      project: vi.fn((x: number, y: number) => [x, y]),
      getSource: vi.fn(() =>
        makePathSource(
          { name: 'l', geometry_type: 'polyline', shapes: [[[0]]] },
          {
            0: [
              [50, 150],
              [250, 150],
            ],
          },
        ),
      ),
    };
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, true)).toBe(true);
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, false)).toBe(false);
  });

  it('matches a polygon that fully covers the lasso in intersecting mode', () => {
    const map: any = {
      project: vi.fn((x: number, y: number) => [x, y]),
      getSource: vi.fn(() =>
        makePathSource(
          { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] },
          {
            0: [
              [0, 0],
              [300, 0],
              [300, 300],
              [0, 300],
              [0, 0],
            ],
          },
        ),
      ),
    };
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, true)).toBe(true);
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, false)).toBe(false);
  });

  it('requires every point in a multi-point feature to be inside in containment mode', () => {
    const map: any = {
      project: vi.fn((x: number, y: number) => [x, y]),
      getSource: vi.fn(() => ({
        getDataset: () => ({
          layers: [
            {
              name: 'l',
              geometry_type: 'point',
              shapes: [
                [
                  [150, 150],
                  [250, 250],
                ],
              ],
            },
          ],
        }),
        getArcs: () => undefined,
      })),
    };
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, true)).toBe(true);
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, false)).toBe(false);
  });
});
