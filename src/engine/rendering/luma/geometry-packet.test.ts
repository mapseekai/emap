import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { flatPathGeometry, flatScreenPathGeometry } from './flat-path';
import { buildScreenPaths } from './screen-paths';
import type { ArcVertexData } from '../../../shared/types/mapshaper-types';
import { compactStrokeParts } from './compact-stroke';
import { spatialStrokeGeometry } from './stroke-ranges';
import { selectPathMembers } from './path-members';
import { buildGeometryPacket, splitGeometry } from './geometry-packet';
import { pathGeometry, PATH_STRIDE } from './path-geometry';
import type { GeometryPacket } from './geometry-jobs';
import type { Point } from './geometry';
describe('geometry Worker packet boundary', () => {
  it('triangulates holes and keeps disjoint features independent', () => {
    const packet: GeometryPacket = {
      kind: 'fill',
      coordinates: Float64Array.from([
        0, 0, 10, 0, 10, 10, 0, 10, 0, 0, 2, 2, 2, 8, 8, 8, 8, 2, 2, 2, 20, 0, 22, 0, 22, 2, 20, 2,
        20, 0,
      ]),
      offsets: Uint32Array.from([0, 5, 10, 15]),
      features: Uint32Array.from([0, 2, 3]),
    };
    const { geometries } = buildGeometryPacket(packet);
    let area = 0;
    for (const g of geometries) {
      for (let i = 0; i < g.indices!.length; i += 3) {
        const p = [...g.indices!.subarray(i, i + 3)].map((id) => [
          g.vertices[id * 4] + g.vertices[id * 4 + 2],
          g.vertices[id * 4 + 1] + g.vertices[id * 4 + 3],
        ]);
        area +=
          Math.abs(
            (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]),
          ) / 2;
      }
    }
    expect(area).toBe(68);
  });
  it('splits long paths without losing neighbors, dash distance, or valid instances', () => {
    const path: Point[] = Array.from({ length: 150000 }, (_, i) => [
      13_000_000 + i / 100,
      4_000_000 + Math.sin(i),
    ]);
    const original = pathGeometry([path]),
      pieces = splitGeometry(original);
    expect(pieces.length).toBe(3);
    let first = 0;
    for (const piece of pieces) {
      expect(piece.vertices.length).toBe((piece.count + 3) * PATH_STRIDE);
      expect(
        piece.vertices.findIndex(
          (value, index) => !Object.is(value, original.vertices[first * PATH_STRIDE + index]),
        ),
      ).toBe(-1);
      first += piece.count;
      expect(piece.vertices.byteLength).toBeLessThan(2 * 1024 ** 2);
    }
    expect(first).toBe(original.count);
  });
  it('screens only a derived copy and falls back safely outside int32 snapping range', () => {
    const packet: GeometryPacket = {
      kind: 'path',
      coordinates: Float64Array.from([0, 0, 0.001, 0.001, 1, 1]),
      offsets: Uint32Array.from([0, 3]),
      features: Uint32Array.from([0, 1]),
      screen: {
        view: [1, -1, 0, 0],
        width: 100,
        height: 100,
        pixelRatio: 2,
        initialScale: 0,
        smallArcs: false,
        halfPixel: true,
        cull: false,
        padding: 8,
        revision: 0,
      },
    };
    const before = packet.coordinates.slice(),
      result = buildGeometryPacket(packet);
    expect(result.screenSpace).toBe(true);
    expect(result.screenStats!.duplicateVertices).toBe(1);
    expect(packet.coordinates).toEqual(before);
    packet.screen!.view[2] = 2 ** 32;
    const fallback = buildGeometryPacket(packet);
    expect(fallback.screenSpace).toBe(false);
    expect(fallback.geometries.length).toBe(1);
  });
  it('rejects invalid offsets and non-finite coordinates', () => {
    const packet: GeometryPacket = {
      kind: 'point',
      coordinates: Float64Array.from([0, 0]),
      offsets: Uint32Array.from([0, 1]),
      features: Uint32Array.from([0, 1]),
    };
    expect(() => buildGeometryPacket({ ...packet, offsets: Uint32Array.from([1, 0]) })).toThrow();
    packet.coordinates[0] = Infinity;
    expect(() => buildGeometryPacket(packet)).toThrow('Non-finite');
  });
});

it('uses lossless uint16 local indices for split fills, including the 65535 boundary', () => {
  const vertices = new Float32Array(70002 * 4);
  for (let i = 0; i < 70002; i++) {
    vertices[i * 4] = i;
    vertices[i * 4 + 1] = i % 3;
  }
  const pieces = splitGeometry({
    kind: 'fill',
    vertices,
    indices: Uint32Array.from({ length: 70002 }, (_, i) => i),
    count: 70002,
  });
  expect(pieces.length).toBe(2);
  const original = new Set<number>();
  for (const piece of pieces) {
    expect(piece.indices).toBeInstanceOf(Uint16Array);
    expect(piece.vertices.length / 4).toBeLessThanOrEqual(65535);
    for (const id of piece.indices!) original.add(piece.vertices[id * 4]);
  }
  expect(original.size).toBe(70002);
});

it('splits lossless XY strokes at record boundaries without inserting or losing segments', () => {
  const count = 30000,
    vertices = new Float32Array(count * 12);
  for (let i = 0; i < count; i++) vertices[i * 12] = i;
  const parts = splitGeometry({
    kind: 'path',
    compactStroke: true,
    compactStrokeXY: true,
    vertices,
    count,
  });
  expect(parts.length).toBe(2);
  expect(parts.reduce((n, p) => n + p.count, 0)).toBe(count);
  let cursor = 0;
  for (const part of parts) {
    expect(part.compactStrokeXY).toBe(true);
    expect(part.vertices.length).toBe(part.count * 12);
    for (let i = 0; i < part.count; i++) expect(part.vertices[i * 12]).toBe(cursor++);
  }
});

it('uses one exact owned backing allocation for multi-mesh path output without copying neighbor records', async () => {
  const { collectTransferables } = await import('../../worker/transferables');
  const count = 150000,
    vertices = new Float32Array((count + 3) * PATH_STRIDE);
  const parts = splitGeometry({ kind: 'path', vertices, count });
  expect(parts).toHaveLength(3);
  expect(new Set(parts.map((p) => p.vertices.buffer)).size).toBe(1);
  expect(parts[1].vertices.byteOffset).toBe(65536 * PATH_STRIDE * 4);
  expect(collectTransferables(parts).filter((b) => b === vertices.buffer)).toHaveLength(1);
});
it('does not retain an oversized backing allocation when exposing a small geometry result', () => {
  const backing = new Float32Array(1024 * 1024);
  const vertices = backing.subarray(100, 108);
  vertices.set([1, 2, 0, 0, 3, 4, 0, 0]);
  const [part] = splitGeometry({ kind: 'point', count: 2, vertices });
  expect(part.vertices).toEqual(vertices);
  expect(part.vertices.buffer.byteLength).toBe(32);
  expect(part.vertices.buffer).not.toBe(backing.buffer);
});
it('transferring assembled output does not detach source coordinates or Worker feature cache entries', async () => {
  const { FeatureGeometryCache } = await import('./feature-geometry-cache');
  const { collectTransferables } = await import('../../worker/transferables');
  const cache = new FeatureGeometryCache();
  const packet: GeometryPacket = {
    kind: 'fill',
    sourceId: 's',
    cacheKey: 'n',
    featureIds: new Int32Array([0]),
    coordinates: Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
    offsets: new Uint32Array([0, 5]),
    features: new Uint32Array([0, 1]),
  };
  const result = buildGeometryPacket(packet, cache);
  const clone = structuredClone(result, {
    transfer: collectTransferables(result) as ArrayBuffer[],
  });
  expect(clone.geometries[0].count).toBe(6);
  expect(packet.coordinates.byteLength).toBe(80);
  expect(buildGeometryPacket(packet, cache).geometries[0].count).toBe(6);
  expect(cache.stats.hits).toBe(1);
});

it('reports a finite per-packet preparation cost without retaining timing objects', () => {
  const result = buildGeometryPacket({
    kind: 'point',
    coordinates: Float64Array.from([1, 2]),
    offsets: Uint32Array.from([0, 1]),
    features: Uint32Array.from([0, 1]),
  });
  expect(Number.isFinite(result.preparationMs)).toBe(true);
  expect(result.preparationMs).toBeGreaterThanOrEqual(0);
});

function screenPacket(paths: Point[][]): GeometryPacket {
  let n = 0;
  const offsets = Uint32Array.from([
    ...paths.map((p) => {
      const a = n;
      n += p.length;
      return a;
    }),
    n,
  ]);
  return {
    kind: 'path',
    compactStroke: true,
    coordinates: Float64Array.from(paths.flatMap((p) => p.flat())),
    offsets,
    features: Uint32Array.from([0, paths.length]),
    screen: {
      view: [1, 1, 0, 0],
      width: 800,
      height: 600,
      pixelRatio: 2,
      initialScale: 0,
      smallArcs: false,
      halfPixel: false,
      cull: false,
      padding: 8,
      revision: 0,
    },
  };
}
function expectReference(packet: GeometryPacket) {
  const coordinates = packet.coordinates.slice(),
    offsets = packet.offsets.slice();
  const reference = flatScreenPathGeometry(
    packet.coordinates,
    packet.offsets,
    packet.screen!,
    true,
  );
  const parts =
    packet.compactStroke && reference.screenSpace
      ? compactStrokeParts(reference.geometry)
      : [reference.geometry];
  const expected = parts.flatMap((p) =>
    splitGeometry(spatialStrokeGeometry(p, !!packet.compactStroke && reference.screenSpace)),
  );
  const actual = buildGeometryPacket(packet);
  assert.deepEqual(actual.geometries, expected);
  // Typed-array value equality alone may overlook signed zero.
  for (let i = 0; i < expected.length; i++)
    assert.deepEqual(
      new Uint8Array(
        actual.geometries[i].vertices.buffer,
        actual.geometries[i].vertices.byteOffset,
        actual.geometries[i].vertices.byteLength,
      ),
      new Uint8Array(
        expected[i].vertices.buffer,
        expected[i].vertices.byteOffset,
        expected[i].vertices.byteLength,
      ),
    );
  expect(actual.screenSpace).toBe(reference.screenSpace);
  expect(actual.screenStats).toEqual(reference.screenStats);
  expect(actual.pathInputInstances).toBe(reference.geometry.count);
  expect(actual.pathOutputInstances).toBe(parts.reduce((n, p) => n + p.count, 0));
  assert.deepEqual(packet.coordinates, coordinates);
  assert.deepEqual(packet.offsets, offsets);
  return actual;
}
describe('direct screen compact preparation', () => {
  it('does not allocate discarded padded records on successful compaction, but retains raw fallback', () => {
    const packet = screenPacket([
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [2, 2],
        [3, 3],
        [2, 2],
      ],
    ]);
    const lengths: number[] = [],
      Native = Float32Array;
    vi.stubGlobal(
      'Float32Array',
      new Proxy(Native, {
        construct(target, args) {
          if (typeof args[0] === 'number') lengths.push(args[0]);
          return Reflect.construct(target, args);
        },
      }),
    );
    try {
      const result = buildGeometryPacket(packet);
      expect(result.geometries[0].compactStroke).toBe(true);
      expect(result.pathInputInstances).toBe(7);
      expect(lengths).not.toContain(70); // Two paths: (3 + 2) * 2 neighbor records, seven floats each.
      expect(lengths.reduce((a, b) => a + b, 0)).toBe(48);
      lengths.length = 0;
      buildGeometryPacket({ ...packet, compactStroke: false });
      expect(lengths).toContain(70);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('matches the retained generic route across precision, degeneracy, closure and projection cases', () => {
    const paths: Point[][] = [
      [],
      [[7, 9]],
      [
        [0, 0],
        [0, 0],
      ],
      [],
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
      [
        [0, 0],
        [0, 0],
        [1, 0],
        [0, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 0],
        [2, 1],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [
        [0, 0],
        [0, 1],
        [-1, 1],
      ],
      [
        [0, 0],
        [1, 0],
        [1.00000001, 0.00000002],
        [2, 1],
      ],
      [
        [13000000.001, 4000000.002],
        [13000000.004, 4000000.008],
        [13000000.001, 4000000.002],
      ],
      [
        [-1000, 0],
        [0, 0],
        [-1000, 0.001],
      ],
      [
        [-0, -0],
        [1e-50, 0],
        [1, 0],
      ],
      [
        [1.13, 2.17],
        [1.14, 2.18],
        [4.27, 7.19],
        [4.28, 7.2],
      ],
    ];
    for (const halfPixel of [false, true])
      for (const pixelRatio of [1, 1.5, 2])
        for (const view of [
          [1, 1, 0, 0],
          [7, -7, -0.123, 0.1],
          [-7, 7, 200, -0.1],
        ]) {
          const packet = screenPacket(paths);
          Object.assign(packet.screen!, { halfPixel, pixelRatio, view });
          expectReference(packet);
        }
    for (const paths of [
      [],
      [[]],
      [[[1, 1]]],
      [
        [
          [0, 0],
          [0, 0],
        ],
      ],
    ] as Point[][][])
      for (const halfPixel of [false, true]) {
        const packet = screenPacket(paths);
        packet.screen!.halfPixel = halfPixel;
        expectReference(packet);
      }
  });
  it('keeps original-source overflow fallback distinct from filtered-screen admission fallback', () => {
    for (const last of [2 ** 32, Number.MAX_VALUE]) {
      const packet = screenPacket([
        [
          [0, 0],
          [0.001, 0.001],
          [1, 1],
        ],
        [
          [0, 0],
          [last, last],
        ],
      ]);
      packet.screen!.halfPixel = true;
      const actual = expectReference(packet);
      expect(actual.screenSpace).toBe(false);
      expect(actual.screenStats!.rawFallbackChunks).toBe(1);
      expect(actual.screenStats!.originalVertices).toBe(0);
    }
    const long = screenPacket([
      Array.from({ length: 70000 }, (_, i) => [i / 10, Math.sin(i)] as Point),
    ]);
    const result = expectReference(long);
    expect(result.screenSpace).toBe(true);
    expect(result.geometries).toHaveLength(2);
    expect(result.geometries[0].compactStroke).not.toBe(true);
    expect(result.geometries[0].pathRanges!.envelopeHalfWidths).toBe(8);
    const nonfinite = screenPacket([
      [
        [1e39, 0],
        [2e39, 1],
      ],
    ]);
    expect(expectReference(nonfinite).geometries[0].compactStroke).not.toBe(true);
  });
  it('preserves split ownership, precision part ordering, and conservative range boundaries', () => {
    for (const count of [127, 128, 129, 511, 512, 513, 28671, 28672, 28673]) {
      const paths: Point[][] = [];
      for (let i = 0; i < count; i++) {
        paths.push([
          [i, 0],
          [i + 1, 0],
        ]);
        paths.push([
          [i + 0.00000001, 2],
          [i + 1.00000001, 3],
        ]);
      }
      const packet = screenPacket(paths),
        result = expectReference(packet);
      const members = Int32Array.from({ length: paths.length }, (_, i) => i);
      const selected = new Set([0, 1, 256, 257, paths.length - 1]);
      for (const g of result.geometries) {
        const ranges = selectPathMembers(g.memberRanges!, members, selected, [
          { firstInstance: 1, count: Math.max(0, g.count - 2) },
        ]);
        for (const range of ranges)
          for (let i = range.firstInstance; i < range.firstInstance + range.count; i++) {
            const owner = Array.from({ length: g.memberRanges!.length / 3 }, (_, j) => j * 3).find(
              (j) =>
                g.memberRanges![j + 1] <= i && i < g.memberRanges![j + 1] + g.memberRanges![j + 2],
            )!;
            expect(selected.has(g.memberRanges![owner])).toBe(true);
          }
      }
      expect(result.geometries[0].compactStrokeXY).toBe(true);
      expect(result.geometries.at(-1)!.compactStrokeXY).toBe(false);
    }
  });
  it('keeps literal reversal markers, caps and bounded versus extreme-join metadata', () => {
    const packet = screenPacket(
      Array.from({ length: 256 }, () => [
        [0, 0],
        [10, 0],
        [0, 0],
      ]),
    );
    const g = expectReference(packet).geometries[0];
    expect([...g.vertices.slice(4, 12)]).toEqual([0, 0, 0, 2, 0, 0, 0, 2]);
    expect([...g.pathRanges!.uncullable!]).toEqual([0, 0, 0, 0]);
    const near = screenPacket(
      Array.from({ length: 512 }, () => [
        [-1000, 0],
        [0, 0],
        [-1000, 0.001],
      ]),
    );
    expect([...expectReference(near).geometries[0].pathRanges!.uncullable!]).toEqual([1, 1, 1, 1]);
    const cap = expectReference(
      screenPacket([
        [
          [0, 0],
          [10, 0],
        ],
      ]),
    ).geometries[0];
    expect([...cap.vertices.slice(4)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('retains generic preparation for compact-disabled, unscreened and non-affine policies', () => {
    const packet = screenPacket([
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [9000, 9000],
        [9001, 9001],
      ],
    ]);
    expectReference({ ...packet, compactStroke: false });
    const raw = buildGeometryPacket({ ...packet, screen: undefined });
    assert.deepEqual(
      raw.geometries,
      splitGeometry(flatPathGeometry(packet.coordinates, packet.offsets, true)),
    );
    for (const policy of [
      { smallArcs: true },
      { cull: true },
      { perspective: { pitch: 50, bearing: 35 } },
    ]) {
      const screen = { ...packet.screen!, ...policy };
      const data = {
        xx: Float64Array.from([0, 1, 0, 9000, 9001]),
        yy: Float64Array.from([0, 0, 0, 9000, 9001]),
        ii: packet.offsets.subarray(0, 2),
        nn: Uint32Array.from([3, 2]),
      } as ArcVertexData;
      const reference = buildScreenPaths(data, Uint32Array.from([0, 1]), screen);
      const expected = reference.fallback
        ? splitGeometry(flatPathGeometry(packet.coordinates, packet.offsets, true))
        : compactStrokeParts(reference.geometry).flatMap((g) =>
            splitGeometry(spatialStrokeGeometry(g, true)),
          );
      const actual = buildGeometryPacket({ ...packet, screen });
      assert.deepEqual(actual.geometries, expected);
      expect(actual.screenStats).toEqual(reference.stats);
    }
  });
  it('transfers only compact derived backings and preserves source packet arrays', async () => {
    const { collectTransferables } = await import('../../worker/transferables');
    const packet = screenPacket([
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [0.1, 0],
        [1.1, 0],
      ],
    ]);
    const before = packet.coordinates.slice(),
      result = buildGeometryPacket(packet);
    const clone = structuredClone(result, {
      transfer: collectTransferables(result) as ArrayBuffer[],
    });
    expect(clone.geometries).toHaveLength(2);
    for (const g of clone.geometries)
      expect(g.vertices.buffer.byteLength).toBe(g.vertices.byteLength);
    assert.deepEqual(packet.coordinates, before);
    expectReference(packet);
  });
  it('rejects malformed packets before the direct route', () => {
    const packet = screenPacket([
      [
        [0, 0],
        [1, 1],
      ],
    ]);
    for (const bad of [
      { coordinates: new Float32Array([0, 0, 1, 1]) },
      { coordinates: new Float64Array(4_000_002) },
      { offsets: new Uint32Array(2_000_002) },
      { features: new Uint32Array(2_000_002) },
      { offsets: new Int32Array([0, 2]) },
      { features: new Int32Array([0, 1]) },
      { coordinates: new Float64Array([0, 0, 1]) },
      { coordinates: new Float64Array([0, NaN, 1, 1]) },
      { coordinates: new Float64Array([0, 0, Infinity, 1]) },
      { offsets: new Uint32Array([0, 2, 1, 2]), features: new Uint32Array([0, 3]) },
      { offsets: new Uint32Array([0, 3, 2]), features: new Uint32Array([0, 2]) },
      { features: new Uint32Array([0, 1, 0, 1]) },
      { featureIds: new Int32Array([-1]) },
      { featureIds: new Int32Array([]) },
      { featureIds: new Uint32Array([0]) },
      { screen: { ...packet.screen, pixelRatio: 0 } },
      { screen: { ...packet.screen, view: [1, 1, NaN, 0] } },
    ])
      expect(() => buildGeometryPacket({ ...packet, ...bad } as GeometryPacket)).toThrow();
  });
});
