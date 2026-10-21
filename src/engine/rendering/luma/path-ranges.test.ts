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

it('bounds fragmented range submission without reverting to all offscreen instances', () => {
  const data = {
    blockSize: 1,
    segments: new Uint32Array(200).fill(1),
    bounds: new Float64Array(800),
  };
  for (let i = 0; i < 200; i++)
    data.bounds.set(i % 4 === 0 ? [0, 0, 1, 1] : [100, 100, 101, 101], i * 4);
  const selected = new PathRangeIndex(data, 200).selectBounds([0, 0, 2, 2]);
  expect(selected.ranges).not.toBeNull();
  expect(selected.ranges!.length).toBeLessThanOrEqual(8);
  for (let i = 0; i < 200; i += 4)
    expect(
      selected.ranges!.some((r) => r.firstInstance <= i && r.firstInstance + r.count > i),
    ).toBe(true);
  expect(selected.segments).toBeLessThan(200);
  for (let i = 1; i < selected.ranges!.length; i++)
    expect(selected.ranges![i].firstInstance).toBeGreaterThan(
      selected.ranges![i - 1].firstInstance + selected.ranges![i - 1].count,
    );
});

it('retains a cheap contiguous crop even when more than eighty percent is visible', () => {
  const data = {
    blockSize: 1,
    segments: new Uint32Array(100).fill(1),
    bounds: new Float64Array(400),
  };
  for (let i = 0; i < 100; i++)
    data.bounds.set(i < 90 ? [0, 0, 1, 1] : [100, 100, 101, 101], i * 4);
  const result = new PathRangeIndex(data, 100).selectBounds([0, 0, 2, 2]);
  expect(result.ranges).toEqual([{ firstInstance: 0, count: 90 }]);
  expect(result.rejected).toBe(10);
});

it('retains conservative join neighbors across a raw range boundary', () => {
  const path: Point[] = Array.from({ length: 2052 }, (_, i) => [i + 100.123456, 100.987654]);
  path[1025] = [0, 0];
  const geometry = pathGeometry([path]),
    selected = new PathRangeIndex(geometry.pathRanges!, geometry.count).selectBounds([
      -1, -1, 1, 1,
    ]);
  // Instances 1023 and 1026 only touch the view through their join-neighbor records.
  for (const first of [1023, 1024, 1025, 1026])
    expect(
      selected.ranges!.some(
        (range) => range.firstInstance <= first && range.firstInstance + range.count > first,
      ),
    ).toBe(true);
  expect(selected.ranges!.at(-1)!.firstInstance + selected.ranges!.at(-1)!.count).toBeLessThan(
    geometry.count,
  );
});

it('keeps visible and uncullable instances ordered within a bounded aggregate draw budget', () => {
  let draws = 0;
  for (const offset of [0, 256, 512]) {
    const count = 65536,
      segments = Uint32Array.from({ length: count }, (_, i) => (i % 5 === 4 ? 0 : 1)),
      bounds = new Float64Array(count * 4),
      uncullable = new Uint8Array(count);
    for (let i = 0; i < count; i++)
      bounds.set(i % 1536 === offset ? [0, 0, 1, 1] : [100, 100, 101, 101], i * 4);
    uncullable[count - 1] = 1;
    const selected = new PathRangeIndex(
      { blockSize: 1, segments, bounds, uncullable },
      count,
    ).selectBounds([-1, -1, 2, 2]);
    const ranges = selected.ranges!;
    draws += ranges.length;
    expect(ranges.length).toBeLessThanOrEqual(8);
    for (let i = offset; i < count; i += 1536)
      if (segments[i])
        expect(
          ranges.some((range) => range.firstInstance <= i && range.firstInstance + range.count > i),
        ).toBe(true);
    expect(ranges.at(-1)!.firstInstance + ranges.at(-1)!.count).toBe(count);
    let submitted = 0;
    for (const [i, range] of ranges.entries()) {
      if (i)
        expect(range.firstInstance).toBeGreaterThan(
          ranges[i - 1].firstInstance + ranges[i - 1].count,
        );
      for (
        let instance = range.firstInstance;
        instance < range.firstInstance + range.count;
        instance++
      )
        submitted += segments[instance];
    }
    expect(selected.segments).toBe(submitted);
    expect(selected.segments + selected.rejected).toBe(segments.reduce((sum, n) => sum + n, 0));
  }
  expect(draws).toBeLessThanOrEqual(24);
});
