import { describe, it, expect } from 'vitest';

// CanvasPainter reads `window.devicePixelRatio` in a field initializer; stub
// it before importing so node's default vitest environment doesn't blow up.
(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

// Mock just enough of CanvasRenderingContext2D for drawPolygonFill to run.
function makeCtx() {
  const calls: Array<[string, any]> = [];
  let _alpha = 1;
  const ctx: any = {
    get globalAlpha() { return _alpha; },
    set globalAlpha(v: number) { _alpha = v; calls.push(['globalAlpha=', v]); },
    set fillStyle(v: string) { calls.push(['fillStyle=', v]); },
    beginPath() { calls.push(['beginPath', null]); },
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill(rule?: string) { calls.push(['fill', rule]); },
    clearRect() {},
  };
  return { ctx, calls };
}

function makePainter(ctx: any) {
  // `new CanvasPainter(canvasElement)` reaches for getContext('2d') etc.
  // We construct a stub canvas + transform.
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const p = new CanvasPainter(canvas as any);
  // Attach a no-op transform so the inner math doesn't blow up.
  (p as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (p as any)._pixelRatio = 1;
  return p;
}

function makeArcs() {
  // Single-segment polygon: one part [0], one arc with 4 vertices forming a square.
  const arcs: any = {
    size: () => 1,
    getShapeIter: (_part: number[]) => {
      const xs = [0, 1, 1, 0, 0];
      const ys = [0, 0, 1, 1, 0];
      let i = 0;
      return {
        get x() { return xs[i]; },
        get y() { return ys[i]; },
        hasNext() {
          if (i >= xs.length) return false;
          i++;
          return true;
        },
      };
    },
  };
  return arcs;
}

describe('CanvasPainter.drawPolygonFill — fill-opacity', () => {
  const shapes = [[[0]]];

  it('leaves globalAlpha untouched when opacity is undefined', () => {
    const { ctx, calls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5');
    const alphaSets = calls.filter(([k]) => k === 'globalAlpha=');
    expect(alphaSets).toHaveLength(0);
  });

  it('multiplies opacity onto current globalAlpha and restores it', () => {
    const { ctx, calls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    ctx.globalAlpha = 0.8; // pretend something upstream already set this
    calls.length = 0;       // clear setup noise
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5', undefined, 0.5);
    const alphaSets = calls.filter(([k]) => k === 'globalAlpha=').map(([, v]) => v);
    // First write multiplies onto prevAlpha (0.8 * 0.5 = 0.4); restore returns to 0.8.
    expect(alphaSets).toEqual([0.4, 0.8]);
  });

  it('clamps opacity to [0, 1]', () => {
    const { ctx, calls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    calls.length = 0;
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5', undefined, 1.5);
    const sets = calls.filter(([k]) => k === 'globalAlpha=').map(([, v]) => v);
    expect(sets[0]).toBe(1); // clamped to 1
  });

  it('opacity = 1 is a no-op (no globalAlpha writes)', () => {
    const { ctx, calls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();
    calls.length = 0;
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5', undefined, 1);
    const sets = calls.filter(([k]) => k === 'globalAlpha=');
    expect(sets).toHaveLength(0);
  });
});
