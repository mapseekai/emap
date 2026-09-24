import { describe, it, expect } from 'vitest';
import { spatialStrokeGeometry } from './stroke-ranges';
import { compactStrokeGeometry } from './compact-stroke';
import { pathGeometry } from './path-geometry';
import { PathRangeIndex } from './path-ranges';
import { AffineTransform } from '../../../domain/geo/transform';
import { splitGeometry } from './geometry-packet';
describe('spatial compact stroke envelopes', () => {
  it('retains every endpoint/join record and selects only conservative spatial ranges', () => {
    const paths = Array.from({ length: 4096 }, (_, i) => {
      const x = (i % 64) * 10,
        y = (i >> 6) * 10;
      return [
        [x, y],
        [x + 2, y + 3],
      ] as [number, number][];
    });
    const original = compactStrokeGeometry(pathGeometry(paths)),
      result = spatialStrokeGeometry(original);
    const stride = result.compactStrokeXY ? 12 : 16;
    const records = (v: Float32Array) =>
      Array.from({ length: v.length / stride }, (_, i) =>
        [...v.slice(i * stride, (i + 1) * stride)].join(','),
      ).sort();
    expect(records(result.vertices)).toEqual(records(original.vertices));
    expect(result.pathRanges!.segments.reduce((a, b) => a + b, 0)).toBe(original.count);
    const index = new PathRangeIndex(result.pathRanges!, result.count),
      view = new AffineTransform(1, 1, 0, 0);
    const all = index.select(view, 800, 800, 10);
    expect(all.ranges).toBeNull();
    const near = index.select(view, 80, 80, 10);
    expect(near.rejected).toBeGreaterThan(result.count / 2);
    expect(index.select(view, 80, 80, 10)).toBe(near);
    for (let i = 0; i < result.count; i++) {
      const at = i * stride,
        x = result.vertices[at],
        y = result.vertices[at + 1];
      if (x >= 0 && y >= 0 && x <= 80 && y <= 80)
        expect(
          near.ranges!.some((r) => r.firstInstance <= i && r.firstInstance + r.count > i),
        ).toBe(true);
    }
    expect(index.bytes).toBeGreaterThan(result.pathRanges!.bounds.byteLength);
  });
  it('always includes extreme miter ranges and preserves metadata across physical splits', () => {
    const paths = Array.from(
      { length: 40000 },
      (_, i) =>
        [
          [i, 0],
          [i + 1, 0],
        ] as [number, number][],
    );
    const g = compactStrokeGeometry(pathGeometry(paths));
    expect(g.compactStrokeXY).toBe(true);
    g.vertices[39999 * 12 + 4] = 100;
    g.vertices[39999 * 12 + 7] = 1;
    const full = spatialStrokeGeometry(g),
      parts = splitGeometry(full);
    expect(parts).toHaveLength(2);
    expect(parts.reduce((n, p) => n + p.count, 0)).toBe(g.count);
    expect(
      parts.reduce((n, p) => n + [...p.pathRanges!.uncullable!].filter(Boolean).length, 0),
    ).toBe(1);
    const last = parts[1],
      index = new PathRangeIndex(last.pathRanges!, last.count);
    const selected = index.select(new AffineTransform(), 10, 10, 10);
    expect(selected.ranges?.some((r) => r.firstInstance + r.count === last.count)).toBe(true);
  });
  it('does not reorder raw or tiny paths', () => {
    const g = pathGeometry([
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    ]);
    expect(spatialStrokeGeometry(g)).toBe(g);
    const c = compactStrokeGeometry(g, 4);
    expect(spatialStrokeGeometry(c)).toBe(c);
  });
});

it('indexes long shared-neighbor strokes without rewriting coordinates and retains sharp joins', () => {
  const g = pathGeometry([
    Array.from({ length: 6000 }, (_, i) => [i, Math.floor(i / 100) * 0.5] as [number, number]),
  ]);
  const indexed = spatialStrokeGeometry(g, true);
  expect(indexed.vertices).toBe(g.vertices);
  const range = new PathRangeIndex(indexed.pathRanges!, indexed.count).select(
    new AffineTransform(),
    100,
    100,
    10,
  );
  expect(range.rejected).toBeGreaterThan(g.segmentCount! / 2);
  const corner = pathGeometry([
    [
      [0, 0],
      [100, 0],
      [0.001, 0.00001],
    ],
    ...Array.from(
      { length: 2000 },
      (_, i) =>
        [
          [1000 + i, 0],
          [1001 + i, 0],
        ] as [number, number][],
    ),
  ]);
  const guarded = spatialStrokeGeometry(corner, true);
  expect(guarded.pathRanges!.uncullable?.[0]).toBe(1);
  expect(guarded.vertices).toBe(corner.vertices);
});
