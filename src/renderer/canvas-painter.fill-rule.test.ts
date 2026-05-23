import { describe, it, expect } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makeCtx() {
  const fillCalls: Array<string | undefined> = [];
  const moveToCalls: Array<[number, number]> = [];
  const lineToCalls: Array<[number, number]> = [];
  let _alpha = 1;
  const ctx: any = {
    get globalAlpha() { return _alpha; },
    set globalAlpha(v: number) { _alpha = v; },
    set fillStyle(_v: string) {},
    beginPath() {},
    moveTo(x: number, y: number) { moveToCalls.push([x, y]); },
    lineTo(x: number, y: number) { lineToCalls.push([x, y]); },
    closePath() {},
    fill(rule?: string) { fillCalls.push(rule); },
  };
  return { ctx, fillCalls, moveToCalls, lineToCalls };
}

function makePainter(ctx: any) {
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const p = new CanvasPainter(canvas as any);
  (p as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (p as any)._pixelRatio = 1;
  return p;
}

function makeArcs(coords: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]) {
  const arcs: any = {
    size: () => 1,
    getShapeIter: (_part: number[]) => {
      const xs = coords.map(p => p[0]);
      const ys = coords.map(p => p[1]);
      let i = -1;
      return {
        get x() { return xs[i] ?? 0; },
        get y() { return ys[i] ?? 0; },
        hasNext() { i++; return i < xs.length; },
      };
    },
  };
  return arcs;
}

describe('CanvasPainter.drawPolygonFill — fill rule (mapshaper 0.7.19 parity)', () => {
  const shapes = [[[0]]];

  it('defaults to nonzero fill rule (ctx.fill called without argument)', () => {
    const { ctx, fillCalls } = makeCtx();
    const painter = makePainter(ctx);
    painter.drawPolygonFill(shapes as any, makeArcs(), '#000');
    expect(fillCalls.length).toBeGreaterThan(0);
    // Every fill call should be undefined (no rule arg = nonzero default)
    for (const rule of fillCalls) expect(rule).toBeUndefined();
  });

  it('honors explicit evenodd via 6th-position fillRule argument', () => {
    const { ctx, fillCalls } = makeCtx();
    const painter = makePainter(ctx);
    painter.drawPolygonFill(shapes as any, makeArcs(), '#000', undefined, undefined, 'evenodd');
    expect(fillCalls.length).toBeGreaterThan(0);
    for (const rule of fillCalls) expect(rule).toBe('evenodd');
  });

  it('integer pixel snap: moveTo/lineTo receive integer coords (roundToPix)', () => {
    const { ctx, moveToCalls, lineToCalls } = makeCtx();
    const painter = makePainter(ctx);
    // Fractional input post-transform should round to integers (not half-pixels)
    (painter as any)._transform = { mx: 1.3, my: 0.7, bx: 0.4, by: 0.6 };
    painter.drawPolygonFill(shapes as any, makeArcs(), '#000');
    const all = [...moveToCalls, ...lineToCalls];
    expect(all.length).toBeGreaterThan(0);
    for (const [x, y] of all) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });
});
