import { describe, it, expect, vi } from 'vitest';
import { AffineTransform } from '../../../domain/geo/transform';
import { PerspectiveTransform } from '../../../domain/geo/perspective-transform';
import {
  polygonAnchor,
  linePose,
  poseBounds,
  LabelCollisionGrid,
  featurePaths,
  featureBounds,
} from './geometry';

describe('geometry-bound label placement', () => {
  it('places polygon anchors in real interiors, excluding central holes and concavities', async () => {
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
    const p = (await polygonAnchor([shell, hole]))!;
    expect(p[0] > 0 && p[0] < 100 && p[1] > 0 && p[1] < 100).toBe(true);
    expect(p[0] > 25 && p[0] < 75 && p[1] > 25 && p[1] < 75).toBe(false);
    const l = (await polygonAnchor([
      [
        [0, 0],
        [100, 0],
        [100, 20],
        [20, 20],
        [20, 100],
        [0, 100],
      ],
    ]))!;
    expect(l[0] < 20 || l[1] < 20).toBe(true);
    expect(
      await polygonAnchor([
        [
          [0, 0],
          [1, 0],
        ],
      ]),
    ).toBeNull();
  });
  it('labels the visible part of lines and keeps reversed lines upright', async () => {
    const t = new AffineTransform();
    const a = (await linePose(
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
    ))!;
    expect(a.x).toBeCloseTo(400);
    expect(a.y).toBe(100);
    expect(a.angle).toBe(0);
    const reversed = (await linePose(
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
    ))!;
    expect(Math.abs(reversed.angle)).toBeLessThanOrEqual(Math.PI / 2);
    expect(
      await linePose(
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
  it('uses perspective screen lengths and screen-space upright orientation', async () => {
    const t = new PerspectiveTransform(new AffineTransform(), 800, 600, { pitch: 50, bearing: 50 });
    const p = (await linePose(
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
    ))!;
    expect(Number.isFinite(p.x + p.y)).toBe(true);
    expect(Math.abs(p.angle)).toBeLessThanOrEqual(Math.PI / 2);
    expect(
      (await linePose(
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
      ))!.angle,
    ).toBe(0);
  });
  it('does not use a simplified arc iterator or mutate source coordinates', async () => {
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
    expect(await featurePaths(dataset, { shapes: [[[-1]]] } as any, 0)).toEqual([
      [
        [2, 0],
        [1, 1],
        [0, 0],
      ],
    ]);
    expect([...data.xx]).toEqual([0, 1, 2]);
  });
  it('uses conservative rotated bounds and detects cross-layer collisions', async () => {
    const grid = new LabelCollisionGrid(),
      b = poseBounds({ x: 100, y: 100, angle: Math.PI / 4 }, 100, 20, 2);
    grid.insert(b);
    expect(grid.collides([100, 100, 105, 105])).toBe(true);
    expect(grid.collides([500, 500, 600, 600])).toBe(false);
    expect(b[3] - b[1]).toBeGreaterThan(20);
  });
});

it('yields inside a single large feature and cancels copying, anchoring and line projection', async () => {
  const paths = [Array.from({ length: 10000 }, (_, i) => [i, i % 2] as const)];
  const xx = Float64Array.from(paths[0], (p) => p[0]),
    yy = Float64Array.from(paths[0], (p) => p[1]);
  const dataset: any = { arcs: { getVertexData: () => ({ xx, yy, nn: [xx.length], ii: [0] }) } };
  let tick = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (tick += 5));
  const view = new AffineTransform(),
    project = vi.spyOn(view, 'project');
  try {
    for (const run of [
      (signal: AbortSignal) =>
        featureBounds(dataset, { shapes: [[[0]]], geometry_type: 'polyline' } as any, 0, signal),
      (signal: AbortSignal) => featurePaths(dataset, { shapes: [[[0]]] } as any, 0, signal),
      (signal: AbortSignal) => polygonAnchor(paths, signal),
      (signal: AbortSignal) => linePose(paths, view, 10000, 800, 40, true, signal),
    ]) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 0);
      await expect(run(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    }
    expect(project.mock.calls.length).toBeGreaterThan(0);
    expect(project.mock.calls.length).toBeLessThan(paths[0].length);
    expect(xx).toEqual(Float64Array.from(paths[0], (p) => p[0]));
  } finally {
    clock.mockRestore();
  }
});

it('keeps even-odd interiors when a scanline crosses many unordered islands', async () => {
  const islands = Array.from({ length: 5000 }, (_, i) => {
    const x = (4999 - i) * 3;
    return [
      [x, 0],
      [x + 1, 0],
      [x + 1, 100],
      [x, 100],
    ] as const;
  });
  expect(await polygonAnchor(islands)).toEqual([0.5, 50]);
});

it('projects each vertex once while sampling both ends and the center of the label', async () => {
  const view = new AffineTransform(),
    project = vi.spyOn(view, 'project');
  const path = [
    [10, 100],
    [100, 100],
    [300, 100],
    [500, 100],
  ] as const;
  expect(await linePose([path], view, 800, 600, 40, true)).toEqual({ x: 255, y: 100, angle: 0 });
  expect(project).toHaveBeenCalledTimes(path.length);
});
