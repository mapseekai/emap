import assert from 'node:assert/strict';
import { flatPathGeometry } from './flat-path';
import { flatCompactStrokeParts, compactStrokeParts } from './compact-stroke';
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

describe('exact stored reversal joins', () => {
  const markers = (g: ReturnType<typeof pathGeometry>) => {
    const stride = g.compactStrokeXY ? 12 : 16;
    return Array.from({ length: g.count }, (_, i) => [
      g.vertices[i * stride + stride - 5],
      g.vertices[i * stride + stride - 1],
    ]);
  };
  it('bounds every endpoint of closed backtracks without changing source or instances', () => {
    for (const length of [1e-10, 0.01, 1, 100000])
      for (const [x, y] of [
        [1, 0],
        [0, 1],
        [0.6, 0.8],
      ]) {
        const source = pathGeometry([
          [
            [0, 0],
            [x * length, y * length],
            [0, 0],
          ],
        ]);
        const before = source.vertices.slice(),
          packed = compactStrokeGeometry(source, 4);
        expect(packed.count).toBe(2);
        expect(markers(packed)).toEqual([
          [2, 2],
          [2, 2],
        ]);
        const stride = packed.compactStrokeXY ? 12 : 16;
        for (let i = 0; i < packed.count; i++) {
          expect([...packed.vertices.slice(i * stride + stride - 8, (i + 1) * stride)]).toEqual([
            0, 0, 0, 2, 0, 0, 0, 2,
          ]);
        }
        expect(source.vertices).toEqual(before);
      }
  });
  it('specializes only matching neighbors and preserves explicit and zero-neighbor caps', () => {
    const open = compactStrokeGeometry(
      pathGeometry([
        [
          [0, 2],
          [0, 0],
          [10, 0],
          [0, 0],
          [-2, 1],
        ],
      ]),
      4,
    );
    expect(markers(open).map((row) => row.map((v) => v === 2))).toEqual([
      [false, false],
      [false, true],
      [true, false],
      [false, false],
    ]);
    for (const path of [
      [
        [0, 0],
        [0, 0],
        [10, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [10, 0],
        [10, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [10, 0],
        [0, 0],
        [0, 0],
      ],
    ] as Point[][]) {
      const source = pathGeometry([path]),
        packed = compactStrokeGeometry(source, 4);
      expect(packed.count).toBe(2);
      expect(packed.vertices.every(Number.isFinite)).toBe(true);
      expect(markers(packed).flat()).toContain(0);
    }
    const empty = pathGeometry([
      [
        [0, 0],
        [0, 0],
        [0, 0],
      ],
    ]);
    expect(compactStrokeGeometry(empty, 4)).toBe(empty);
  });
  it('keeps unequal and nearly reversed legs generic, including differences only in low words', () => {
    for (const path of [
      [
        [-10, 0],
        [0, 0],
        [-1, 0],
      ],
      [
        [-1000, 0],
        [0, 0],
        [-1000, 0.001],
      ],
      [
        [-1000, -1000],
        [0, 0],
        [-1000, -999.999],
      ],
      [
        [13000000.001, 4000000.002],
        [13000000.004, 4000000.008],
        [13000000.001, 4000000.002001],
      ],
    ] as Point[][]) {
      const packed = compactStrokeGeometry(pathGeometry([path]), 4);
      expect(markers(packed).flat()).not.toContain(2);
      expect(markers(packed)[0][1]).not.toBe(0);
    }
    const precise = compactStrokeGeometry(
      pathGeometry([
        [
          [13000000.001, 4000000.002],
          [13000000.004, 4000000.008],
          [13000000.001, 4000000.002],
        ],
      ]),
      4,
    );
    expect(precise.compactStrokeXY).toBe(false);
    expect(markers(precise)).toEqual([
      [2, 2],
      [2, 2],
    ]);
  });
});

describe('direct filtered compact records', () => {
  const compare = (paths: Point[][], maxExpansion = 1.125, trackMembers = true) => {
    let n = 0;
    const offsets = Uint32Array.from([
      ...paths.map((p) => {
        const a = n;
        n += p.length;
        return a;
      }),
      n,
    ]);
    const coordinates = Float64Array.from(paths.flatMap((p) => p.flat()));
    const raw = flatPathGeometry(coordinates, offsets, trackMembers);
    const expected = compactStrokeParts(raw, maxExpansion);
    const actual = flatCompactStrokeParts(coordinates, offsets, trackMembers, maxExpansion);
    if (expected[0] === raw) expect(actual).toBeUndefined();
    else {
      assert.deepEqual(actual!.parts, expected);
      expect(actual!.inputCount).toBe(raw.count);
    }
    return actual;
  };
  it('uses whole-input padded capacity at the admission boundary for XY, precise and mixed parts', () => {
    for (const [path, floats] of [
      [
        [
          [0, 0],
          [1, 0],
          [2, 1],
          [3, 2],
        ],
        36,
      ],
      [
        [
          [0.1, 0],
          [1.1, 0],
          [2.1, 1],
          [3.1, 2],
        ],
        48,
      ],
      [
        [
          [0, 0],
          [1, 0],
          [2.1, 1],
          [3, 2],
        ],
        44,
      ],
    ] as [Point[], number][]) {
      const equality = floats / 42;
      expect(compare([path], equality - 1e-12)).toBeUndefined();
      expect(compare([path], equality)).toBeDefined();
      expect(compare([path], equality + 1e-12)).toBeDefined();
      compare([[], [[8, 8]], path], equality);
    }
    expect(
      compare([
        Array.from({ length: 2000 }, (_, i) => [i, Math.sin(i)] as Point),
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toBeUndefined();
    expect(
      compare([
        [
          [0, 0],
          [0, 0],
        ],
      ]),
    ).toBeUndefined();
  });
  it('keeps Float64 closure and validity distinct from stored high/low arithmetic', () => {
    const tiny = compare([
      [
        [0, 0],
        [1e-50, 0],
      ],
    ])!.parts[0];
    expect(tiny.compactStrokeXY).toBe(true);
    expect(tiny.count).toBe(1); // Nonzero source segment survives low-word underflow.
    expect([...tiny.vertices]).toEqual(Array(12).fill(0));
    const open = compare([
      [
        [0, 0],
        [1, 0],
        [1e-50, 0],
      ],
    ])!.parts[0];
    expect(open.vertices[7]).toBe(0);
    expect(open.vertices[11]).toBe(2);
    expect(open.vertices[19]).toBe(2);
    expect(open.vertices[23]).toBe(0); // Quantized endpoints coincide; the Float64 path is open.
    const signed = compare(
      [
        [
          [-0, -0],
          [1, 0],
        ],
      ],
      4,
      false,
    )!.parts[0];
    expect(Object.is(signed.vertices[0], -0)).toBe(true);
    expect(signed.memberRanges).toBeUndefined();
    compare(
      [
        [
          [13000000.001, 4000000.002],
          [13000000.004, 4000000.008],
          [13000000.001, 4000000.002001],
        ],
      ],
      4,
    );
  });
  it('falls back on nonfinite endpoint or join output without requiring unused dash distances', () => {
    expect(
      compare(
        [
          [
            [1e39, 0],
            [2e39, 0],
          ],
        ],
        4,
      ),
    ).toBeUndefined();
    expect(
      compare(
        [
          [
            [-3e38, 0],
            [0, 0],
            [3e38, 0],
          ],
        ],
        4,
      ),
    ).toBeUndefined();
  });
  it('rejects overflow in a later precise part after valid XY records', () => {
    const paths: Point[][] = Array.from({ length: 32 }, (_, i) => [
      [i, 0],
      [i + 1, 1],
    ]);
    expect(compare(paths, 4)!.parts[0].count).toBe(32);
    paths.push([
      [1e39, 0],
      [2e39, 0],
    ]);
    expect(compare(paths, 4)).toBeUndefined();
  });
  it('matches quantized generic joins on reproducible mixed paths and independent path boundaries', () => {
    let seed = 12345;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let k = 0; k < 80; k++) {
      const paths: Point[][] = Array.from({ length: 4 }, () => {
        const path: Point[] = Array.from({ length: 2 + Math.floor(random() * 8) }, () => {
          const scale = random() < 0.5 ? 1e7 : 1;
          return [random() * scale, random() * scale];
        });
        if (random() < 0.5) path.push(path[0]);
        if (random() < 0.5) path.splice(1, 0, path[0]);
        return path;
      });
      compare(paths, 4);
    }
  });
});
