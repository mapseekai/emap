import { describe, it, expect, vi } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };
(globalThis as any).document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      set fillStyle(_v: string) {},
      clearRect() {}, fillRect() {},
      getImageData() { return { data: new Uint8ClampedArray([255, 0, 0, 255]) }; },
    }),
  }),
};

import { CanvasPainter } from './canvas-painter';

function makeCtx(w = 100, h = 100) {
  const backing = new Uint8ClampedArray(w * h * 4);
  const ctx: any = {
    canvas: { width: w, height: h },
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clearRect() {}, fillRect() {},
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(backing), width: w, height: h })),
    putImageData: vi.fn((img: any) => { backing.set(img.data); }),
  };
  return ctx;
}

function makePainter(ctx: any) {
  const canvas = { getContext: () => ctx, width: ctx.canvas.width, height: ctx.canvas.height, style: {} };
  const p = new CanvasPainter(canvas as any);
  (p as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (p as any)._pixelRatio = 1;
  return p;
}

// Point shape: outer array of features, each feature is a list of [x,y] pairs.
// emap's `normalizePointShape` accepts this nested form.
function pointShape(...coords: Array<[number, number]>) {
  return coords;
}

describe('CanvasPainter.drawPoints — fast vs slow path dispatch', () => {
  it('uses fast path (putImageData) when radius <= 3 (size <= 6) with fill', () => {
    const ctx = makeCtx();
    const painter = makePainter(ctx);
    painter.drawPoints(
      [pointShape([10, 10]), pointShape([20, 20])],
      { radius: 3, color: '#f00', fill: true },
    );
    expect(ctx.putImageData).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('uses slow path (ctx.arc) when radius > 3 (size > 6)', () => {
    const ctx = makeCtx();
    const painter = makePainter(ctx);
    painter.drawPoints(
      [pointShape([10, 10])],
      { radius: 10, color: '#f00', fill: true },
    );
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it('uses slow path when fill = false (stroke required)', () => {
    const ctx = makeCtx();
    const painter = makePainter(ctx);
    painter.drawPoints(
      [pointShape([10, 10])],
      { radius: 2, color: '#f00', fill: false },
    );
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it('uses slow path when no shapes (empty list still safe)', () => {
    const ctx = makeCtx();
    const painter = makePainter(ctx);
    painter.drawPoints([], { radius: 2, color: '#f00', fill: true });
    // No points: both paths should be a no-op (no arc, no putImageData)
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });
});
