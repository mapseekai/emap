import { describe, it, expect } from 'vitest';
import { polygonGeometry, type Point } from './geometry';
import { flatPolygonGeometry } from './flat-polygon';
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
