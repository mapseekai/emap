import { AffineTransform } from '../../../domain/geo/transform';
import { compactStrokeCompatible } from './compact-stroke';
import { describe, expect, it, vi } from 'vitest';
import { compactStrokeGeometry, COMPACT_STROKE_STRIDE } from './compact-stroke';
import { pathGeometry } from './path-geometry';
import type { Point } from './geometry';

describe('affine opaque compact stroke geometry', () => {
  it('calculates shared joins once while packing adjacent segments', () => {
    const path = Array.from({ length: 128 }, (_, i) => [i, Math.sin(i)] as Point);
    const source = pathGeometry([path]);
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      const packed = compactStrokeGeometry(source, 4);
      expect(packed.compactStroke).toBe(true);
      expect(packed.count).toBe(path.length - 1);
      expect(packed.vertices.every(Number.isFinite)).toBe(true);
      expect(hypot.mock.calls.length).toBeLessThanOrEqual(path.length * 4);
    } finally {
      hypot.mockRestore();
    }
  });
  it('preserves every valid endpoint and cap without emitting padding instances', () => {
    const paths: Point[][] = Array.from({ length: 300 }, (_, i) => [
      [i, 0],
      [i + 1, 1],
      [i, 0],
    ]);
    const source = pathGeometry(paths),
      packed = compactStrokeGeometry(source);
    expect(packed.compactStroke).toBe(true);
    expect(packed.count).toBe(600);
    expect(packed.count).toBeLessThan(source.count);
    expect(packed.vertices.length).toBe(
      packed.count * (packed.compactStrokeXY ? 12 : COMPACT_STROKE_STRIDE),
    );
    expect(packed.vertices.every(Number.isFinite)).toBe(true);
    expect(packed.vertices[packed.compactStrokeXY ? 7 : 11]).not.toBe(0); // closed start is a join, not an endpoint
    expect(packed.vertices[packed.compactStrokeXY ? 11 : 15]).not.toBe(0);
  });
  it('retains the original representation when compaction would increase long-path storage', () => {
    const source = pathGeometry([
      Array.from({ length: 3000 }, (_, i) => [i, Math.sin(i)] as Point),
    ]);
    expect(compactStrokeGeometry(source)).toBe(source);
  });
  it('preserves hi/lo positions, open caps and direction on tiny/large-coordinate segments', () => {
    const paths: Point[][] = Array.from({ length: 100 }, (_, i) => [
      [13000000 + i, 4000000],
      [13000000 + i + 0.001, 4000000 + 0.002],
    ]);
    const source = pathGeometry(paths),
      original = source.vertices.slice(),
      packed = compactStrokeGeometry(source, 4);
    expect(packed.count).toBe(100);
    for (let i = 0; i < 100; i++) {
      const at = i * 16;
      expect(packed.vertices[at + 11]).toBe(0);
      expect(packed.vertices[at + 15]).toBe(0);
      expect(packed.vertices[at] + packed.vertices[at + 2]).toBeCloseTo(paths[i][0][0], 8);
      expect(packed.vertices[at + 4] + packed.vertices[at + 6]).toBeCloseTo(paths[i][1][0], 8);
    }
    expect(source.vertices).toEqual(original);
  });
});

it('only replays precomputed joins under a positive uniform screen similarity', () => {
  const frame = [10, -10, 20, 30] as const;
  expect(compactStrokeCompatible(new AffineTransform(20, -20, 9, -15), frame)).toBe(true);
  expect(compactStrokeCompatible(new AffineTransform(20, -21, 9, -15), frame)).toBe(false);
  expect(compactStrokeCompatible(new AffineTransform(-20, -20, 9, -15), frame)).toBe(false);
  expect(compactStrokeCompatible(new AffineTransform(), undefined)).toBe(false);
});

it('omits only exactly zero position low parts and converts short closed rings without expanding storage', () => {
  const source = pathGeometry(
    Array.from(
      { length: 30 },
      (_, i) =>
        [
          [i, 0],
          [i + 1, 0],
          [i + 1, 1],
          [i, 1],
          [i, 0],
        ] as Point[],
    ),
  );
  const g = compactStrokeGeometry(source);
  expect(g.compactStroke).toBe(true);
  expect(g.compactStrokeXY).toBe(true);
  expect(g.vertices.byteLength).toBe(g.count * 48);
  expect(g.count).toBe(source.segmentCount);
  expect(g.vertices.byteLength).toBeLessThanOrEqual(source.vertices.byteLength * 1.125);
  const precise = compactStrokeGeometry(
    pathGeometry(
      Array.from(
        { length: 30 },
        () =>
          [
            [13000000.001, 0],
            [13000000.002, 1],
          ] as Point[],
      ),
    ),
    4,
  );
  expect(precise.compactStrokeXY).not.toBe(true);
  expect(precise.vertices.byteLength).toBe(precise.count * 64);
  expect(precise.vertices[2]).not.toBe(0);
});

it('separates mixed endpoint precision without losing any endpoint or join coefficient', async () => {
  const { compactStrokeParts } = await import('./compact-stroke');
  const source = pathGeometry([
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    [
      [3, 0],
      [3.1, 0],
    ],
  ]);
  const original = compactStrokeGeometry(source, 4),
    parts = compactStrokeParts(source);
  expect(original.compactStrokeXY).toBe(false);
  expect(parts.map((p) => p.compactStrokeXY)).toEqual([true, false]);
  expect(parts.reduce((n, p) => n + p.count, 0)).toBe(source.segmentCount);
  const rows = (g: typeof source) =>
    Array.from({ length: g.count }, (_, i) => {
      const at = i * (g.compactStrokeXY ? 12 : 16),
        a = g.vertices;
      return g.compactStrokeXY
        ? [a[at], a[at + 1], 0, 0, a[at + 2], a[at + 3], 0, 0, ...a.subarray(at + 4, at + 12)]
        : [...a.subarray(at, at + 16)];
    });
  const ordered = (rows: number[][]) => rows.map((row) => JSON.stringify(row)).sort();
  expect(ordered(parts.flatMap(rows))).toEqual(ordered(rows(original)));
  expect(parts.reduce((n, p) => n + p.vertices.byteLength, 0)).toBeLessThan(
    original.vertices.byteLength,
  );
  expect(compactStrokeParts(source, 0.01)).toEqual([source]);
});
