import { describe, it, expect } from 'vitest';
import { flatPathGeometry, flatScreenPathGeometry, flatPointGeometry } from './flat-path';
import { pathGeometry } from './path-geometry';
import { pointGeometry, type Point } from './geometry';
import { buildScreenPaths, type ScreenPathRequest } from './screen-paths';
import type { ArcVertexData } from '../../../shared/types/mapshaper-types';
import { AffineTransform } from '../../../domain/geo/transform';
import { PATH_STRIDE } from './path-geometry';
function packet(paths: Point[][]) {
  let n = 0;
  const offsets = Uint32Array.from([
    ...paths.map((p) => {
      const start = n;
      n += p.length;
      return start;
    }),
    n,
  ]);
  return { xy: Float64Array.from(paths.flatMap((p) => p.flat())), offsets };
}
describe('binary path layout', () => {
  it('keeps original road endpoints fixed when a cached screen frame is magnified', () => {
    const points: Point[] = [
      [1.13, 2.17],
      [1.14, 2.18],
      [4.27, 7.19],
      [4.28, 7.2],
    ];
    const { xy, offsets } = packet([points]);
    for (const scale of [1, 16]) {
      const frame = new AffineTransform(scale, -scale, 10.37, 20.19);
      const { geometry } = flatScreenPathGeometry(xy, offsets, {
        view: [frame.mx, frame.my, frame.bx, frame.by],
        width: 800,
        height: 600,
        pixelRatio: 2,
        initialScale: 0,
        smallArcs: false,
        halfPixel: true,
        cull: false,
        padding: 8,
        revision: 0,
      });
      for (const [vertex, expected] of [
        [1, points[0]],
        [geometry.count + 1, points.at(-1)!],
      ] as const) {
        const i = vertex * PATH_STRIDE,
          v = geometry.vertices;
        const actual = frame.unproject(v[i] + v[i + 2], v[i + 1] + v[i + 3]);
        expect(actual[0]).toBeCloseTo(expected[0], 8);
        expect(actual[1]).toBeCloseTo(expected[1], 8);
      }
    }
  });
  it('matches neighbor, distance, endpoint and range buffers exactly', () => {
    const cases: Point[][][] = [
      [],
      [[]],
      [[[1, 1]]],
      [
        [
          [0, 0],
          [1, 1],
          [1, 1],
          [0, 0],
        ],
      ],
      [
        [
          [1e7 + 0.01, -1e7],
          [1e7 + 0.1, -1e7 + 0.2],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
    ];
    cases.push([Array.from({ length: 2001 }, (_, i) => [i / 100, Math.sin(i / 40)] as const)]);
    for (const paths of cases) {
      const { xy, offsets } = packet(paths);
      expect(flatPathGeometry(xy, offsets)).toEqual(pathGeometry(paths));
      expect(flatPointGeometry(xy)).toEqual(pointGeometry(paths.flat()));
    }
  });
  it('matches screen snapping for DPR, signs, closed/collapsed paths, and overflow', () => {
    const paths: Point[][] = [
        [
          [0, 0],
          [0.001, 0.001],
        ],
        [
          [-2, -1],
          [0.2, 0.3],
          [2, 1],
          [-2, -1],
        ],
        [],
      ],
      { xy, offsets } = packet(paths);
    const data = {
      xx: Float64Array.from(paths.flat().map((p) => p[0])),
      yy: Float64Array.from(paths.flat().map((p) => p[1])),
      ii: offsets.subarray(0, paths.length),
      nn: Uint32Array.from(paths.map((p) => p.length)),
    } as ArcVertexData;
    for (const dpr of [1, 1.5, 2])
      for (const x of [-10.123, 0, 200]) {
        const request: ScreenPathRequest = {
          view: [7, -7, x, 0.1],
          width: 800,
          height: 600,
          pixelRatio: dpr,
          initialScale: 0,
          smallArcs: false,
          halfPixel: true,
          cull: false,
          padding: 8,
          revision: 0,
        };
        const expected = buildScreenPaths(data, Uint32Array.from([0, 1, 2]), request),
          actual = flatScreenPathGeometry(xy, offsets, request);
        expect(actual.geometry).toEqual(expected.geometry);
        expect(actual.screenStats).toEqual(expected.stats);
      }
  });
});
