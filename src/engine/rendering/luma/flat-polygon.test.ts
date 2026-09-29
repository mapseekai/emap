import { describe, it, expect } from 'vitest';
import { polygonGeometry, type Point } from './geometry';
import earcut from 'earcut';
import { flatPolygonGeometry, flatSingleRingIndices } from './flat-polygon';
import { buildGeometryPacket, splitGeometry } from './geometry-packet';
function check(rings: Point[][]) {
  const offsets = new Uint32Array(rings.length + 1);
  let n = 0;
  for (let i = 0; i < rings.length; i++) {
    offsets[i] = n;
    n += rings[i].length;
  }
  offsets[rings.length] = n;
  const xy = Float64Array.from(rings.flatMap((r) => r.flat()));
  const actual = flatPolygonGeometry(xy, offsets),
    expected = polygonGeometry([rings]);
  expect(actual.vertices).toEqual(expected.vertices);
  expect(actual.indices).toEqual(expected.indices);
  expect(actual.count).toBe(expected.count);
}
const rect = (x: number, y: number, w: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + w],
  [x, y + w],
  [x, y],
];
describe('flat polygon preparation matches native even-odd semantics', () => {
  it('preserves winding, holes, shuffled parts, nested islands and degenerate rings', () => {
    for (const rings of [
      [],
      [rect(0, 0, 1)],
      [rect(0, 0, 1).reverse()],
      [rect(0, 0, 8), rect(1, 1, 6).reverse(), rect(2, 2, 2)],
      [rect(1, 1, 1), rect(0, 0, 8), rect(20, 20, 2)],
      [
        [],
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        rect(3, 3, 2),
      ],
    ] as Point[][][])
      check(rings);
  });
  it('retains low coordinate bits and the same complex polygon triangulations', () => {
    let seed = 123;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 40; i++) {
      const n = 6 + i * 7,
        r: Point[] = Array.from({ length: n }, (_, j) => {
          const a = (j / n) * Math.PI * 2,
            d = 10 + random();
          return [1e7 + Math.cos(a) * d, -1e7 + Math.sin(a) * d] as const;
        });
      r.push(r[0]);
      check([r, rect(1e7 - 1, -1e7 - 1, 1)]);
    }
  });
  it('accepts an offset range without rebuilding the other features', () => {
    const xy = new Float64Array([9, 9, 0, 0, 1, 0, 1, 1, 0, 0, 10, 10]);
    const result = flatPolygonGeometry(xy, new Uint32Array([0, 1, 5, 6]), 1, 2);
    expect(result).toEqual(
      polygonGeometry([
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      ]),
    );
  });
});

it('large simple-ring batches match the reference while avoiding per-feature meshes', () => {
  const rings = Array.from({ length: 300 }, (_, i) =>
    rect((i % 30) * 2, Math.floor(i / 30) * 2, 1),
  );
  const xy = Float64Array.from(rings.flatMap((r) => r.flat()));
  const packet = {
    kind: 'fill' as const,
    coordinates: xy,
    offsets: Uint32Array.from({ length: 301 }, (_, i) => i * 5),
    features: Uint32Array.from({ length: 301 }, (_, i) => i),
  };
  const result = buildGeometryPacket(packet);
  expect(result.directFeatures).toBe(300);
  expect(result.geometries).toEqual(splitGeometry(polygonGeometry(rings.map((r) => [r]))));
});

it('keeps exact Earcut indices for short rings across closure, winding, concavity and precision extremes', () => {
  let seed = 7123;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const reference = (xy: Float64Array) => {
    let area = 0;
    for (let i = 0; i < xy.length; i += 2) {
      const j = i + 2 < xy.length ? i + 2 : 0;
      area += (xy[i] - xy[0]) * (xy[j + 1] - xy[1]) - (xy[j] - xy[0]) * (xy[i + 1] - xy[1]);
    }
    return area !== 0 && Number.isFinite(area) ? earcut(xy, [], 2) : null;
  };
  for (let i = 0; i < 1000; i++) {
    const n = i % 2 ? 3 : 4,
      scale = 10 ** ((i % 15) - 7),
      origin = i % 3 ? 0 : 1e7;
    const points = Array.from({ length: n }, () => [
      origin + (random() - 0.5) * scale,
      -origin + (random() - 0.5) * scale,
    ]);
    if (i % 5 === 0) points[1] = points[0].slice();
    for (const reverse of [false, true])
      for (const closed of [false, true]) {
        const ring = reverse ? points.slice().reverse() : points.slice();
        if (closed) ring.push(ring[0]);
        const xy = Float64Array.from(ring.flat());
        expect(flatSingleRingIndices(xy)).toEqual(reference(xy));
      }
  }
});

it('preserves hundreds of holes, shuffled ring order and nested islands with accelerated triangulation', () => {
  const holes = Array.from({ length: 400 }, (_, i) =>
    rect(2 + (i % 20) * 4, 2 + Math.floor(i / 20) * 4, 1),
  );
  const island = rect(2.25, 2.25, 0.5),
    innerHole = rect(2.375, 2.375, 0.25);
  const rings = [
    ...holes.slice(200).reverse(),
    innerHole,
    rect(0, 0, 100).reverse(),
    island,
    ...holes.slice(0, 200),
  ];
  const offsets = new Uint32Array(rings.length + 1);
  let count = 0;
  for (const [i, ring] of rings.entries()) {
    offsets[i] = count;
    count += ring.length;
  }
  offsets[rings.length] = count;
  const coordinates = Float64Array.from(rings.flatMap((r) => r.flat()));
  const input = coordinates.slice();
  const result = flatPolygonGeometry(coordinates, offsets);
  const vertices = result.vertices,
    indices = result.indices!;
  const cross = (a: number, b: number, x: number, y: number) => {
    const ax = vertices[a * 4] + vertices[a * 4 + 2],
      ay = vertices[a * 4 + 1] + vertices[a * 4 + 3];
    const bx = vertices[b * 4] + vertices[b * 4 + 2],
      by = vertices[b * 4 + 1] + vertices[b * 4 + 3];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  };
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i],
      b = indices[i + 1],
      c = indices[i + 2];
    expect(Math.max(a, b, c)).toBeLessThan(vertices.length / 4);
    area +=
      Math.abs(
        cross(
          a,
          b,
          vertices[c * 4] + vertices[c * 4 + 2],
          vertices[c * 4 + 1] + vertices[c * 4 + 3],
        ),
      ) / 2;
  }
  expect(area).toBeCloseTo(10000 - 400 + 0.25 - 0.0625, 10);
  const covered = (x: number, y: number) => {
    for (let i = 0; i < indices.length; i += 3) {
      const a = cross(indices[i], indices[i + 1], x, y),
        b = cross(indices[i + 1], indices[i + 2], x, y),
        c = cross(indices[i + 2], indices[i], x, y);
      if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) return true;
    }
    return false;
  };
  for (let i = 0; i < 400; i++)
    expect(covered(2.5 + (i % 20) * 4, 2.5 + Math.floor(i / 20) * 4)).toBe(false);
  expect(covered(2.3, 2.3)).toBe(true);
  expect(covered(1, 1)).toBe(true);
  expect(covered(101, 101)).toBe(false);
  expect(coordinates).toEqual(input);
  expect(flatPolygonGeometry(coordinates, offsets)).toEqual(result);
});
