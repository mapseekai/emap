import { describe, it, expect } from 'vitest';

// CanvasPainter reads `window.devicePixelRatio` in a field initializer; stub
// it before importing so node's default vitest environment doesn't blow up.
(globalThis as any).window = { devicePixelRatio: 1 };

import { createCanvasPainterHarness } from '../../test/utils/canvas-painter';

// Mock just enough of CanvasRenderingContext2D for drawPolygonFill to run.
function makeCtx() {
  const calls: Array<[string, any]> = [];
  let _alpha = 1;
  const ctx: any = {
    get globalAlpha() {
      return _alpha;
    },
    set globalAlpha(v: number) {
      _alpha = v;
      calls.push(['globalAlpha=', v]);
    },
    set fillStyle(v: string) {
      calls.push(['fillStyle=', v]);
    },
    beginPath() {
      calls.push(['beginPath', null]);
    },
    moveTo() {},
    lineTo() {},
    closePath() {
      calls.push(['closePath', null]);
    },
    fill(rule?: string) {
      calls.push(['fill', rule]);
    },
    clearRect() {},
  };
  return { ctx, calls };
}

function makePainter(ctx: any) {
  return createCanvasPainterHarness(ctx).painter;
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
        get x() {
          return xs[i];
        },
        get y() {
          return ys[i];
        },
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

function makeVisibilityArcs(visitedParts: number[][]) {
  return {
    getSimpleShapeBbox: (part: number[], out: number[]) => {
      const arcId = part[0];
      if (arcId === 0) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 1;
        out[3] = 1;
      } else {
        out[0] = 10;
        out[1] = 10;
        out[2] = 11;
        out[3] = 11;
      }
    },
    getShapeIter: (part: number[]) => {
      visitedParts.push(part);
      const xs = [0, 1, 0];
      const ys = [0, 0, 1];
      let i = 0;
      return {
        get x() {
          return xs[i];
        },
        get y() {
          return ys[i];
        },
        hasNext() {
          if (i >= xs.length) return false;
          i++;
          return true;
        },
      };
    },
  };
}

function makeBudgetArcs() {
  return {
    getVertexData: () => ({
      nn: new Int32Array([10_000, 10_000]),
    }),
    getShapeIter: (_part: number[]) => {
      const xs = [0, 1, 0];
      const ys = [0, 0, 1];
      let i = 0;
      return {
        get x() {
          return xs[i];
        },
        get y() {
          return ys[i];
        },
        hasNext() {
          if (i >= xs.length) return false;
          i++;
          return true;
        },
      };
    },
  };
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
    calls.length = 0; // clear setup noise
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

  it('lets fill implicitly close polygon parts instead of calling closePath per part', () => {
    const { ctx, calls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeArcs();

    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5');

    expect(calls.filter(([k]) => k === 'closePath')).toHaveLength(0);
    expect(calls.filter(([k]) => k === 'fill')).toEqual([['fill', 'evenodd']]);
  });

  it('skips polygon parts whose bbox is outside the viewport', () => {
    const { ctx } = makeCtx();
    const painter = makePainter(ctx);
    const visitedParts: number[][] = [];
    const arcs = makeVisibilityArcs(visitedParts);

    painter.drawPolygonFill([[[0], [1]]] as any, arcs as any, '#1e88e5', undefined, undefined, {
      viewBBox: [0, 0, 2, 2],
    });

    expect(visitedParts).toEqual([[0]]);
  });

  it('flushes polygon fill paths when the vertex budget would be exceeded', () => {
    const { ctx, calls } = makeCtx();
    const painter = makePainter(ctx);
    const arcs = makeBudgetArcs();

    painter.drawPolygonFill([[[0]], [[1]]] as any, arcs as any, '#1e88e5');

    expect(calls.filter(([k]) => k === 'fill')).toEqual([
      ['fill', 'evenodd'],
      ['fill', 'evenodd'],
    ]);
  });
});
