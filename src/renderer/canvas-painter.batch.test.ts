import { describe, expect, it } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makePainter(strokeCalls: string[]) {
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokeCalls.push('stroke');
    },
    clearRect() {},
  };
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const painter = new CanvasPainter(canvas as any);
  (painter as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (painter as any)._pixelRatio = 1;
  return painter;
}

function makeArcs(size: number) {
  return {
    size: () => size,
    getArcIter: (_i: number) => {
      let done = false;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (done) return false;
          done = true;
          return true;
        },
      };
    },
  };
}

function makePointPainter(fillCalls: string[]) {
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    set strokeStyle(_v: string) {},
    set fillStyle(_v: string) {},
    beginPath() {},
    moveTo() {},
    arc() {},
    fill() {
      fillCalls.push('fill');
    },
    stroke() {},
  };
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const painter = new CanvasPainter(canvas as any);
  (painter as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (painter as any)._pixelRatio = 1;
  return painter;
}

describe('CanvasPainter batching', () => {
  it('flushes drawArcs every 100 arcs plus a final stroke', () => {
    const strokes: string[] = [];
    const painter = makePainter(strokes);

    painter.drawArcs(makeArcs(250) as any, { color: '#333', width: 1 });

    expect(strokes).toHaveLength(3);
  });

  it('flushes drawPoints every 100 points plus a final fill', () => {
    const fills: string[] = [];
    const painter = makePointPainter(fills);
    const shapes = Array.from({ length: 250 }, (_, i) => [[i, i]]);

    painter.drawPoints(shapes as any, { color: '#333', radius: 4, fill: true });

    // flush at 100 and 200, plus the final fill after the loop
    expect(fills).toHaveLength(3);
  });
});
