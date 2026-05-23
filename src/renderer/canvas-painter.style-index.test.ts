import { describe, it, expect } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makeCtx() {
  const styleAssigns: string[] = [];
  const strokeCalls: number[] = [];
  const ctx: any = {
    set strokeStyle(v: string) { styleAssigns.push(v); },
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { strokeCalls.push(Date.now()); },
  };
  return { ctx, styleAssigns, strokeCalls };
}

function makePainter(ctx: any) {
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const p = new CanvasPainter(canvas as any);
  (p as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (p as any)._pixelRatio = 1;
  return p;
}

function makeArcs() {
  return {
    size: () => 1,
    getArcIter: (_i: number) => {
      let i = -1;
      const xs = [0, 1];
      const ys = [0, 1];
      return {
        get x() { return xs[i] ?? 0; },
        get y() { return ys[i] ?? 0; },
        hasNext() { i++; return i < xs.length; },
      };
    },
  } as any;
}

describe('CanvasPainter.drawPathsBatch — styleIndex grouping (mapshaper parity)', () => {
  it('groups shapes by styleKey: 3 items with 2 unique styles -> 2 strokeStyle assignments', () => {
    const { ctx, styleAssigns } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    const items = [
      { shape: [[0]], style: { color: '#f00', width: 1 } },
      { shape: [[0]], style: { color: '#0f0', width: 1 } },
      { shape: [[0]], style: { color: '#f00', width: 1 } },
    ];
    (painter as any).drawPathsBatch(items, arcs);
    const unique = new Set(styleAssigns);
    expect(unique.size).toBe(2);
    expect(unique.has('#f00')).toBe(true);
    expect(unique.has('#0f0')).toBe(true);
  });

  it('skips items with width=0', () => {
    const { ctx, styleAssigns } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    const items = [
      { shape: [[0]], style: { color: '#f00', width: 0 } },
      { shape: [[0]], style: { color: '#0f0', width: 1 } },
    ];
    (painter as any).drawPathsBatch(items, arcs);
    expect(styleAssigns).toEqual(['#0f0']);
  });

  it('empty items list is a no-op', () => {
    const { ctx, styleAssigns, strokeCalls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    (painter as any).drawPathsBatch([], arcs);
    expect(styleAssigns).toHaveLength(0);
    expect(strokeCalls).toHaveLength(0);
  });
});
