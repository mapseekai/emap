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

describe('CanvasPainter batching', () => {
  it('flushes drawArcs every 100 arcs plus a final stroke', () => {
    const strokes: string[] = [];
    const painter = makePainter(strokes);

    painter.drawArcs(makeArcs(250) as any, { color: '#333', width: 1 });

    expect(strokes).toHaveLength(3);
  });
});
