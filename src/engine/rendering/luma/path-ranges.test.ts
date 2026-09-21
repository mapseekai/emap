import { describe, expect, it } from 'vitest';
import { pathGeometry } from './path-geometry';
import { buildPathRanges, PathRangeIndex } from './path-ranges';
import { AffineTransform } from '../../../domain/geo/transform';
import type { Point } from './geometry';

describe('full-detail path range culling', () => {
  it('keeps every segment at overview scale, including subpixel paths', () => {
    const paths: Point[][] = [
      [
        [0, 0],
        [0.000001, 0],
      ],
      [
        [10, 10],
        [11, 11],
      ],
    ];
    const geometry = pathGeometry(paths);
    const index = new PathRangeIndex(buildPathRanges(paths, geometry.count, 2), geometry.count);
    const selected = index.select(new AffineTransform(1, 1, 10, 10), 100, 100, 8);
    expect(selected.ranges).toBeNull();
    expect(selected.segments).toBe(2);
    expect(paths[0]).toHaveLength(2);
  });
  it('retains a crossing with both endpoints outside and only rejects disjoint ranges', () => {
    const paths: Point[][] = [
      [
        [-100, 5],
        [100, 5],
      ],
      [
        [200, 200],
        [201, 201],
      ],
      [
        [-200, -200],
        [-201, -201],
      ],
    ];
    const g = pathGeometry(paths);
    const index = new PathRangeIndex(buildPathRanges(paths, g.count, 4), g.count);
    const r = index.select(new AffineTransform(), 10, 10, 1);
    expect(r.segments).toBe(1);
    expect(r.ranges?.[0].firstInstance).toBe(0);
  });
  it('handles reversed axes, anisotropic scale and conservative stroke padding', () => {
    const paths: Point[][] = [
      [
        [0, 0],
        [2, 0],
      ],
      [
        [100, 100],
        [101, 100],
      ],
    ];
    const g = pathGeometry(paths),
      index = new PathRangeIndex(buildPathRanges(paths, g.count, 4), g.count);
    const v = new AffineTransform(-2, 3, 10, -4);
    expect(index.select(v, 20, 10, 5).segments).toBe(1);
    expect(index.select(v, 20, 10, 0).segments).toBe(0);
  });
  it('preserves original instance offsets and zero-length padding, and coalesces ordered runs', () => {
    const paths: Point[][] = [
      [
        [0, 0],
        [1, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [3, 0],
        [4, 0],
      ],
      [
        [100, 100],
        [101, 101],
      ],
    ];
    const g = pathGeometry(paths),
      data = buildPathRanges(paths, g.count, 2),
      index = new PathRangeIndex(data, g.count);
    expect([...data.segments].reduce((a, b) => a + b, 0)).toBe(g.segmentCount);
    const r = index.select(new AffineTransform(10, 10, 0, 10), 50, 20, 0);
    expect(r.segments).toBe(3);
    for (const run of r.ranges ?? [])
      expect(run.firstInstance + run.count).toBeLessThanOrEqual(g.count);
    expect(g.vertices.byteLength).toBe(paths.reduce((n, p) => n + (p.length + 2) * 7 * 4, 0));
  });
});
