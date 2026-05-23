import { describe, it, expect, vi } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

// Stub document so getPixelColorFunction's default canvas-creation path works.
// The stub returns opaque bytes for any color so pixel writes have non-zero
// alpha (lets us verify writes actually landed in the backing buffer).
(globalThis as any).document = {
  createElement: (_tag: string) => {
    let currentFill = '#000';
    return {
      width: 0, height: 0,
      getContext: () => ({
        set fillStyle(v: string) { currentFill = v; },
        clearRect() {},
        fillRect() {},
        getImageData() {
          // Crude mapping: any color string yields opaque pixel (R=255, A=255).
          // We don't need actual color fidelity — only that writes are non-zero.
          void currentFill;
          return { data: new Uint8ClampedArray([255, 0, 0, 255]) };
        },
      }),
    };
  },
};

import { CanvasPainter } from './canvas-painter';

// Fake ctx with putImageData / getImageData backed by a typed array so
// drawSquareDotsFaster can be exercised in node env.
function makeFakeCtx(w = 100, h = 100) {
  const backing = new Uint8ClampedArray(w * h * 4);
  const ctx: any = {
    canvas: { width: w, height: h },
    set fillStyle(_v: string) {},
    clearRect() {},
    fillRect() {},
    getImageData: vi.fn((x: number, y: number, dw: number, dh: number) => {
      // Return a view-like ImageData backed by `backing` for the full-canvas case.
      // We only need full-canvas reads in drawSquareDotsFaster.
      void x; void y; void dw; void dh;
      const copy = new Uint8ClampedArray(backing);
      return { data: copy, width: w, height: h };
    }),
    putImageData: vi.fn((img: { data: Uint8ClampedArray }, _x: number, _y: number) => {
      backing.set(img.data);
    }),
  };
  return { ctx, backing, w, h };
}

function makePainter(ctx: any) {
  const canvas = { getContext: () => ctx, width: ctx.canvas.width, height: ctx.canvas.height, style: {} };
  const p = new CanvasPainter(canvas as any);
  return p;
}

describe('CanvasPainter.drawSquareDotsFaster — direct pixel write fast path', () => {
  it('one putImageData call total regardless of point count', () => {
    const { ctx } = makeFakeCtx();
    const painter = makePainter(ctx);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 500; i++) points.push([Math.random() * 100, Math.random() * 100]);
    (painter as any).drawSquareDotsFaster(points, 'rgba(0,0,0,1)', 2, ctx);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('writes pixels into the canvas backing buffer', () => {
    const { ctx, backing } = makeFakeCtx();
    const painter = makePainter(ctx);
    (painter as any).drawSquareDotsFaster([[10, 10]], 'rgba(255,0,0,1)', 2, ctx);
    // Expect at least one red pixel near (10, 10) — the 2px square centered at (10,10)
    // covers rows 9..10 cols 9..10 (size=2, half=1).
    const idx = (10 * 100 + 10) * 4;
    expect(backing[idx + 3]).toBeGreaterThan(0); // alpha set
  });

  it('clips dots near the right edge without throwing', () => {
    const { ctx } = makeFakeCtx(100, 100);
    const painter = makePainter(ctx);
    expect(() => {
      (painter as any).drawSquareDotsFaster([[99, 50]], 'rgba(0,0,0,1)', 4, ctx);
    }).not.toThrow();
  });

  it('clips dots near the bottom edge without throwing', () => {
    const { ctx } = makeFakeCtx(100, 100);
    const painter = makePainter(ctx);
    expect(() => {
      (painter as any).drawSquareDotsFaster([[50, 99]], 'rgba(0,0,0,1)', 4, ctx);
    }).not.toThrow();
  });

  it('empty points list is a no-op (no putImageData call)', () => {
    const { ctx } = makeFakeCtx();
    const painter = makePainter(ctx);
    (painter as any).drawSquareDotsFaster([], 'rgba(0,0,0,1)', 2, ctx);
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });
});
