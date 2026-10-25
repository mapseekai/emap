// @vitest-environment jsdom
import { PerspectiveTransform } from '../../../domain/geo/perspective-transform';
import { describe, expect, it } from 'vitest';
import { AffineTransform } from '../../../domain/geo/transform';
import { Viewport } from '../../../domain/geo/viewport';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import { buildScreenPaths, canvasMinArcLength, type ScreenPathRequest } from './screen-paths';
import { screenPathFrame } from './screen-path-frame';
import { createCanvasPainterHarness } from '../../../../test/utils/canvas-painter';
const request = (patch: Partial<ScreenPathRequest> = {}): ScreenPathRequest => ({
  view: [1, -1, 20, 30],
  width: 200,
  height: 100,
  pixelRatio: 1,
  initialScale: 1,
  smallArcs: false,
  halfPixel: true,
  cull: false,
  padding: 8,
  revision: 0,
  ...patch,
});
function arcs(paths: number[][][]) {
  const a = getDefaultMapshaperAdapter(),
    i = a.createPathImporter();
  for (const p of paths) {
    i.startShape();
    i.importLine(p.map(([x, y]) => [x, y]));
  }
  return i.done().arcs!;
}
const sourceBounds = [-10, -10, 10, 10] as const;
function canvasCommands(path: number[][], view: AffineTransform, pixelRatio: number) {
  const commands: number[][] = [];
  let i = 0;
  const iter = {
    x: 0,
    y: 0,
    hasNext() {
      if (i === path.length) return false;
      [this.x, this.y] = path[i++];
      return true;
    },
  };
  const ctx = {
    moveTo: (x: number, y: number) => commands.push([x, y]),
    lineTo: (x: number, y: number) => commands.push([x, y]),
  };
  const { painter } = createCanvasPainterHarness(ctx, { pixelRatio });
  painter.setTransform(view);
  painter.setLayerContext({ id: 'line', sourceId: 's', revision: 0, bounds: sourceBounds });
  const trace = Reflect.get(painter, 'drawPathSnapping').call(
    painter,
    iter,
    ctx,
    true,
  ) as Generator<void>;
  while (!trace.next().done) {
    // Compare complete native commands after draining the cooperative primitive.
  }
  return commands;
}
describe('Canvas screen-path parity (not geometry LOD)', () => {
  it('matches actual Canvas commands including DPR, negative truncation and consecutive-only duplicates', () => {
    const paths = [
      [
        [0, 0],
        [0.1, 0.1],
        [0.11, 0.11],
        [1.2, 1.2],
        [0.1, 0.1],
      ],
      [
        [-5, -2],
        [-5.1, -2.1],
        [-5.7, -2.7],
        [-5, -2],
      ],
    ];
    const source = arcs(paths);
    for (const pr of [1, 1.25, 2])
      for (const view of [
        [1, -1, 0, 0],
        [4, -3, 20.17, 11.1],
        [-2, 3, -0.1, -0.2],
      ] as [number, number, number, number][]) {
        const display = new AffineTransform(...view);
        const r = request({ view: screenPathFrame(display, sourceBounds, pr), pixelRatio: pr });
        const frame = new AffineTransform(...r.view);
        const out = buildScreenPaths(source.getVertexData!(), new Uint32Array([0, 1]), r);
        expect(out.fallback).toBe(false);
        for (let i = 0; i < paths.length; i++) {
          const coords = Array.from(
            out.coordinates.subarray(out.offsets[i] * 2, out.offsets[i + 1] * 2),
          );
          const expected: number[] = [];
          for (let j = 0; j < coords.length; j += 2) {
            const sourcePoint = frame.unproject(coords[j] / pr, coords[j + 1] / pr);
            expected.push(...display.project(...sourcePoint).map((value) => value * pr));
          }
          const actual = canvasCommands(paths[i], display, pr).flat();
          expect(actual).toHaveLength(expected.length);
          for (let j = 0; j < actual.length; j++) expect(actual[j]).toBeCloseTo(expected[j], 8);
        }
      }
  });
  it('uses exactly the viewport threshold, including the zoomed-out cap and strict bbox test', () => {
    for (const scale of [0.04, 1, 8]) {
      const v = new Viewport();
      Reflect.set(v, '_initialMX', 1);
      Reflect.set(v, '_transform', new AffineTransform(scale, -scale));
      let threshold = 0;
      v.getArcFilter({
        arcIsSmaller: (_i, n) => {
          threshold = n;
          return false;
        },
      })(0);
      expect(canvasMinArcLength(scale, 1)).toBe(threshold);
    }
    const source = arcs([
      [
        [0, 0],
        [0.34, 0.34],
      ],
      [
        [0, 0],
        [0.35, 0],
      ],
      [
        [0, 0],
        [0, 1],
      ],
    ]);
    const out = buildScreenPaths(
      source.getVertexData!(),
      new Uint32Array([0, 1, 2]),
      request({ smallArcs: true }),
    );
    expect([...out.arcIds]).toEqual([1, 2]);
    expect(out.stats.tinyArcs).toBe(1);
  });
  it('keeps exact endpoints even when every point falls in the same screen cell', () => {
    const p = [
        [0, 0],
        [0.01, 0.01],
        [0.02, 0.02],
      ],
      r = request({ pixelRatio: 2, view: [1, 1, 0, 0] });
    const source = arcs([p]);
    const out = buildScreenPaths(source.getVertexData!(), new Uint32Array([0]), r);
    expect([...out.coordinates]).toEqual(
      canvasCommands(p, new AffineTransform(...r.view), r.pixelRatio).flat(),
    );
    expect([...out.coordinates]).toEqual([0, 0, 0.04, 0.04]);
    expect(out.stats.collapsedArcs).toBe(0);
    expect(out.stats.outputSegments).toBe(1);
    expect(out.stats.duplicateVertices).toBe(1);
  });
  it('keeps closed rings and A-B-A commands and never changes original storage or retained interval', () => {
    const source = arcs([
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 0],
      ],
    ]);
    const raw = source.getVertexData!(),
      x = raw.xx.slice(),
      y = raw.yy.slice();
    const out = buildScreenPaths(raw, new Uint32Array([0]), request());
    expect([...out.coordinates.slice(0, 2)]).toEqual([...out.coordinates.slice(-2)]);
    expect(raw.xx).toEqual(x);
    expect(raw.yy).toEqual(y);
    expect(out.stats.outputSegments).toBe(3);
  });
  it('pads viewport culling, without filtering a crossing line just because its endpoints are outside', () => {
    const source = arcs([
      [
        [-100, 0],
        [500, 0],
      ],
      [
        [-5, 1],
        [-4, 2],
      ],
      [
        [-100, -100],
        [-99, -100],
      ],
    ]);
    const out = buildScreenPaths(
      source.getVertexData!(),
      new Uint32Array([0, 1, 2]),
      request({ view: [1, 1, 0, 0], cull: true }),
    );
    expect([...out.arcIds]).toEqual([0, 1]);
    expect(out.stats.outsideArcs).toBe(1);
  });
  it('falls back to raw geometry for Int32 overflow instead of wrapping or dropping a crossing arc', () => {
    const source = arcs([
      [
        [-2e9, 0],
        [2e9, 0],
      ],
    ]);
    expect(
      buildScreenPaths(source.getVertexData!(), new Uint32Array([0]), request()).fallback,
    ).toBe(true);
  });
  it('supports independent switches and rejects invalid view/DPR before reading geometry', () => {
    const source = arcs([
        [
          [0, 0],
          [0.1, 0.1],
          [0.2, 0.2],
        ],
      ]),
      raw = source.getVertexData!();
    expect(
      buildScreenPaths(raw, new Uint32Array([0]), request({ halfPixel: false })).stats
        .outputVertices,
    ).toBe(3);
    expect(() => buildScreenPaths(raw, new Uint32Array([0]), request({ pixelRatio: 0 }))).toThrow(
      'Invalid',
    );
    expect(() =>
      buildScreenPaths(raw, new Uint32Array([0]), request({ view: [0, 1, 0, 0] })),
    ).toThrow('Invalid');
  });
});

it('filters perspective commands in actual screen pixels, preserving source coordinates', () => {
  const source = arcs([
    [
      [13000000, 4000000],
      [13000000.01, 4000000.01],
      [13000000.02, 4000000.02],
      [13000040, 4000030],
      [13000000, 4000000],
    ],
  ]);
  const raw = source.getVertexData!(),
    before = raw.xx.slice();
  const r = request({
    view: [1, -1, -12999900, 4000050],
    pixelRatio: 2,
    perspective: { pitch: 50, bearing: 35 },
  });
  const camera = new PerspectiveTransform(
    new AffineTransform(...r.view),
    r.width,
    r.height,
    r.perspective,
  );
  const expected: number[] = [];
  let lastCell: number[] = [];
  for (let i = 0; i < raw.xx.length; i++) {
    const p = camera.project(raw.xx[i], raw.yy[i]).map((v) => v * r.pixelRatio);
    const cell = p.map((v) => Math.trunc(v * 2));
    if (!expected.length || cell[0] !== lastCell[0] || cell[1] !== lastCell[1]) expected.push(...p);
    lastCell = cell;
  }
  const result = buildScreenPaths(raw, new Uint32Array([0]), r);
  expect(result.fallback).toBe(false);
  expect([...result.coordinates]).toEqual(expected);
  expect(result.stats.duplicateVertices).toBeGreaterThan(0);
  expect(raw.xx).toEqual(before);
});
it('falls back safely for an arc that crosses behind the perspective camera', () => {
  const source = arcs([
    [
      [0, 0],
      [0, -10000],
    ],
  ]);
  const result = buildScreenPaths(
    source.getVertexData!(),
    new Uint32Array([0]),
    request({ perspective: { pitch: 60, bearing: 0 } }),
  );
  expect(result.fallback).toBe(true);
});
