import { describe, expect, it } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makePainter(calls: { fill: string[]; arc: string[] }, size = 100) {
  const ctx: any = {
    canvas: { width: size, height: size },
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    beginPath() {},
    moveTo() {},
    arc() { calls.arc.push('arc'); },
    fill() { calls.fill.push('fill'); },
    stroke() {},
    clearRect() {},
  };
  const canvas = { getContext: () => ctx, width: size, height: size, style: {} };
  const painter = new CanvasPainter(canvas as any);
  (painter as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (painter as any)._pixelRatio = 1;
  return painter;
}

describe('CanvasPainter point rendering', () => {
  it('flushes large point layers in batches instead of one giant path', () => {
    const calls = { fill: [] as string[], arc: [] as string[] };
    const painter = makePainter(calls, 20000);
    const shapes = Array.from({ length: 9_999 }, (_, i) => [i, i]);

    painter.drawPoints(shapes, { color: '#333', radius: 4, fill: true });

    expect(calls.fill).toHaveLength(2);
    expect(calls.arc).toHaveLength(9_999);
  });

  it('skips points outside the canvas bounds before adding arcs', () => {
    const calls = { fill: [] as string[], arc: [] as string[] };
    const painter = makePainter(calls);
    const shapes = [
      [10, 10],
      [200, 200],
      [-100, 10],
      [20, 20],
    ];

    painter.drawPoints(shapes, { color: '#333', radius: 4, fill: true });

    expect(calls.arc).toHaveLength(2);
    expect(calls.fill).toHaveLength(1);
  });

  it('can draw a shape range for progressive point rendering', () => {
    const calls = { fill: [] as string[], arc: [] as string[] };
    const painter = makePainter(calls);
    const shapes = [
      [10, 10],
      [20, 20],
      [30, 30],
      [40, 40],
    ];

    painter.drawPointsRange(shapes, { color: '#333', radius: 4, fill: true }, 1, 3);

    expect(calls.arc).toHaveLength(2);
    expect(calls.fill).toHaveLength(1);
  });
});
