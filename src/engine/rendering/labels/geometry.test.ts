import { describe, it, expect } from 'vitest';
import { AffineTransform } from '../../../domain/geo/transform';
import { PerspectiveTransform } from '../../../domain/geo/perspective-transform';
import { polygonAnchor, linePose, poseBounds, LabelCollisionGrid, featurePaths } from './geometry';

describe('geometry-bound label placement', () => {
  it('places polygon anchors in real interiors, excluding central holes and concavities', () => {
    const shell = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as const;
    const hole = [
      [25, 25],
      [75, 25],
      [75, 75],
      [25, 75],
    ] as const;
    const p = polygonAnchor([shell, hole])!;
    expect(p[0] > 0 && p[0] < 100 && p[1] > 0 && p[1] < 100).toBe(true);
    expect(p[0] > 25 && p[0] < 75 && p[1] > 25 && p[1] < 75).toBe(false);
    const l = polygonAnchor([
      [
        [0, 0],
        [100, 0],
        [100, 20],
        [20, 20],
        [20, 100],
        [0, 100],
      ],
    ])!;
    expect(l[0] < 20 || l[1] < 20).toBe(true);
    expect(
      polygonAnchor([
        [
          [0, 0],
          [1, 0],
        ],
      ]),
    ).toBeNull();
  });
  it('labels the visible part of lines and keeps reversed lines upright', () => {
    const t = new AffineTransform();
    const a = linePose(
      [
        [
          [-10000, 100],
          [10000, 100],
        ],
      ],
      t,
      800,
      600,
      80,
      true,
    )!;
    expect(a.x).toBeCloseTo(400);
    expect(a.y).toBe(100);
    expect(a.angle).toBe(0);
    const reversed = linePose(
      [
        [
          [600, 400],
          [100, 100],
        ],
      ],
      t,
      800,
      600,
      60,
      true,
    )!;
    expect(Math.abs(reversed.angle)).toBeLessThanOrEqual(Math.PI / 2);
    expect(
      linePose(
        [
          [
            [10, 10],
            [20, 20],
          ],
        ],
        t,
        800,
        600,
        80,
        true,
      ),
    ).toBeNull();
  });
  it('uses perspective screen lengths and screen-space upright orientation', () => {
    const t = new PerspectiveTransform(new AffineTransform(), 800, 600, { pitch: 50, bearing: 50 });
    const p = linePose(
      [
        [
          [100, 150],
          [650, 450],
        ],
      ],
      t,
      800,
      600,
      60,
      true,
    )!;
    expect(Number.isFinite(p.x + p.y)).toBe(true);
    expect(Math.abs(p.angle)).toBeLessThanOrEqual(Math.PI / 2);
    expect(
      linePose(
        [
          [
            [100, 150],
            [650, 450],
          ],
        ],
        t,
        800,
        600,
        60,
        false,
      )!.angle,
    ).toBe(0);
  });
  it('does not use a simplified arc iterator or mutate source coordinates', () => {
    const data = {
      nn: new Uint32Array([3]),
      ii: new Uint32Array([0]),
      xx: new Float64Array([0, 1, 2]),
      yy: new Float64Array([0, 1, 0]),
    };
    const dataset: any = {
      arcs: {
        getVertexData: () => data,
        getArcIter: () => {
          throw new Error('simplified');
        },
      },
    };
    expect(featurePaths(dataset, { shapes: [[[-1]]] } as any, 0)).toEqual([
      [
        [2, 0],
        [1, 1],
        [0, 0],
      ],
    ]);
    expect([...data.xx]).toEqual([0, 1, 2]);
  });
  it('uses conservative rotated bounds and detects cross-layer collisions', () => {
    const grid = new LabelCollisionGrid(),
      b = poseBounds({ x: 100, y: 100, angle: Math.PI / 4 }, 100, 20, 2);
    grid.insert(b);
    expect(grid.collides([100, 100, 105, 105])).toBe(true);
    expect(grid.collides([500, 500, 600, 600])).toBe(false);
    expect(b[3] - b[1]).toBeGreaterThan(20);
  });
});
