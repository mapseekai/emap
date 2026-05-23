import { describe, it, expect } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makeCtx() {
  const strokeCalls: number[] = [];
  const ctx: any = {
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { strokeCalls.push(Date.now()); },
  };
  return { ctx, strokeCalls };
}

function makePainter(ctx: any) {
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const p = new CanvasPainter(canvas as any);
  (p as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (p as any)._pixelRatio = 1;
  return p;
}

function makeArcs(n: number) {
  return {
    size: () => n,
    getArcIter: (_i: number) => {
      let used = false;
      return {
        x: 0, y: 0,
        hasNext() { if (used) return false; used = true; return true; },
      };
    },
  } as any;
}

describe('CanvasPainter batch size (mapshaper 0.7.19 parity)', () => {
  it('drawArcs flushes stroke() every 100 arcs (batch size = 100)', () => {
    const { ctx, strokeCalls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs(250);
    painter.drawArcs(arcs, { color: '#000', width: 1 });
    // 250 / 100 = 2 mid-batch flushes + 1 final = 3 stroke() calls
    expect(strokeCalls.length).toBe(3);
  });

  it('drawPaths flushes stroke() every 100 arcs (batch size = 100)', () => {
    const { ctx, strokeCalls } = makeCtx();
    const painter = makePainter(ctx);
    // Build 250 arc references spread across shapes
    const shapes: any[] = [];
    for (let i = 0; i < 250; i++) shapes.push([[i]]);
    const arcs = makeArcs(250);
    painter.drawPaths(shapes, { color: '#000', width: 1 }, arcs);
    expect(strokeCalls.length).toBe(3);
  });
});
