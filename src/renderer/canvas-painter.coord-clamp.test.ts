import { describe, it, expect } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makeCtx() {
  const lineToCalls: Array<[number, number]> = [];
  const moveToCalls: Array<[number, number]> = [];
  const ctx: any = {
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    beginPath() {},
    moveTo(x: number, y: number) { moveToCalls.push([x, y]); },
    lineTo(x: number, y: number) { lineToCalls.push([x, y]); },
    stroke() {},
  };
  return { ctx, lineToCalls, moveToCalls };
}

function makePainter(ctx: any, mx = 1) {
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const p = new CanvasPainter(canvas as any);
  (p as any)._transform = { mx, my: -mx, bx: 0, by: 0 };
  (p as any)._pixelRatio = 1;
  return p;
}

function makeArcs(points: Array<[number, number]>) {
  // Mapshaper iterator semantics: starts positioned BEFORE first vertex.
  // hasNext() advances; x/y getters return the CURRENT vertex.
  return {
    size: () => 1,
    getArcIter: (_i: number) => {
      const xs = points.map(p => p[0]);
      const ys = points.map(p => p[1]);
      let i = -1;
      return {
        get x() { return xs[i] ?? 0; },
        get y() { return ys[i] ?? 0; },
        hasNext() { i++; return i < xs.length; },
      };
    },
  } as any;
}

describe('CanvasPainter — coordinate clamping (protectIterForDrawing)', () => {
  const MAX = 1_000_000;

  it('clamps post-transform coords to ±1,000,000 at extreme magnitudes', () => {
    const { ctx, lineToCalls, moveToCalls } = makeCtx();
    // mx=1, but coord values themselves are huge → simulates extreme zoom outcome
    const painter = makePainter(ctx, 1);
    const arcs = makeArcs([[1e10, 1e10], [0, 0]]);
    painter.drawArcs(arcs, { color: '#000', width: 1 });

    const all = [...moveToCalls, ...lineToCalls];
    for (const [x, y] of all) {
      expect(Math.abs(x)).toBeLessThanOrEqual(MAX);
      expect(Math.abs(y)).toBeLessThanOrEqual(MAX);
    }
  });

  it('does not clamp small coords (no behavior change in normal range)', () => {
    const { ctx, lineToCalls, moveToCalls } = makeCtx();
    const painter = makePainter(ctx, 1);
    const arcs = makeArcs([[10, 20], [30, 40]]);
    painter.drawArcs(arcs, { color: '#000', width: 1 });

    const all = [...moveToCalls, ...lineToCalls];
    expect(all.some(([x, y]) => x === 10 && y === -20)).toBe(true);
    expect(all.some(([x, y]) => x === 30 && y === -40)).toBe(true);
  });
});
