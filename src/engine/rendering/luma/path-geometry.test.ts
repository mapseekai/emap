import { describe, it, expect } from 'vitest';
import { pathGeometry, PATH_STRIDE } from './path-geometry';
import type { Point } from './geometry';
function segments(paths: Point[][]) {
  const g = pathGeometry(paths),
    pairs: number[][][] = [];
  for (let i = 0; i < g.count; i++) {
    const at = (i + 1) * PATH_STRIDE;
    if (g.vertices[at + 6] >= 4) continue;
    const point = (j: number) => [
      g.vertices[j] + g.vertices[j + 2],
      g.vertices[j + 1] + g.vertices[j + 3],
    ];
    pairs.push([point(at), point(at + PATH_STRIDE)]);
  }
  return { g, pairs };
}
describe('full precision continuous path buffer', () => {
  it('shares coordinate storage and does not connect neighboring paths', () => {
    const paths: Point[][] = [
      [
        [0, 0],
        [3, 0],
        [3, 4],
      ],
      [
        [100, 100],
        [101, 102],
      ],
    ];
    const { g, pairs } = segments(paths);
    expect(pairs).toEqual([
      [
        [0, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [3, 4],
      ],
      [
        [100, 100],
        [101, 102],
      ],
    ]);
    expect(g.segmentCount).toBe(3);
    expect(g.vertices.byteLength).toBe((3 + 2 + 2 + 2) * 28);
    expect(g.vertices[2 * PATH_STRIDE + 4]).toBe(3);
  });
  it('keeps every nonzero subpixel segment and closed rings', () => {
    const ring: Point[] = [
      [0, 0],
      [1e-10, 0],
      [1e-10, 1e-10],
      [0, 0],
    ];
    const { g, pairs } = segments([ring]);
    expect(g.segmentCount).toBe(3);
    expect(pairs).toHaveLength(3);
    expect(pairs[2][1]).toEqual([0, 0]);
    for (let i = 1; i < 4; i++) expect(g.vertices[i * PATH_STRIDE + 6]).toBe(0);
  });
  it('does not drop duplicate original coordinates, but zero length primitives have no coverage', () => {
    const { g, pairs } = segments([
      [
        [1, 2],
        [1, 2],
        [3, 4],
      ],
    ]);
    expect(g.vertices.length).toBe(5 * PATH_STRIDE);
    expect(g.segmentCount).toBe(1);
    expect(pairs).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ]);
  });
  it('retains projected sub-metre coordinates in both high and low words', () => {
    const p: Point = [20037508.123456, -19999999.987654];
    const { pairs } = segments([[p, [p[0] + 0.001, p[1] + 0.002]]]);
    expect(pairs[0][0][0]).toBeCloseTo(p[0], 6);
    expect(pairs[0][0][1]).toBeCloseTo(p[1], 6);
  });
  it('fails explicitly on nonfinite coordinates and supports empty data', () => {
    expect(pathGeometry([]).count).toBe(0);
    expect(() =>
      pathGeometry([
        [
          [0, 0],
          [NaN, 1],
        ],
      ]),
    ).toThrow('Non-finite');
  });
});
