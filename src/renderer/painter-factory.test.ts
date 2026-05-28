import { describe, expect, it, vi } from 'vitest';
import type { Painter } from './painter';
import { createPainter } from './painter-factory';

class FakeCanvasPainter implements Painter {
  constructor(public canvas: HTMLCanvasElement) {}
  drawPaths() {}
  drawArcs() {}
  drawPoints() {}
  drawPolygonFill() {}
  drawVertexDots() {}
  drawDrawingOverlay() {}
  clear() {}
  resize() {}
  setTransform() {}
  setPixelRatio() {}
}

class FakeWebGLPainter extends FakeCanvasPainter {}

function makeCanvas() {
  return { getContext: vi.fn(() => ({})), style: {} } as unknown as HTMLCanvasElement;
}

describe('createPainter', () => {
  it('uses CanvasPainter by default', () => {
    const result = createPainter(makeCanvas(), {}, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: FakeWebGLPainter,
      warn: vi.fn(),
    });

    expect(result.painter).toBeInstanceOf(FakeCanvasPainter);
    expect(result.renderer).toBe('canvas');
    expect(result.requestedRenderer).toBe('canvas');
  });

  it('uses WebGLPainter when requested and construction succeeds', () => {
    const result = createPainter(makeCanvas(), { renderer: 'webgl' }, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: FakeWebGLPainter,
      warn: vi.fn(),
    });

    expect(result.painter).toBeInstanceOf(FakeWebGLPainter);
    expect(result.renderer).toBe('webgl');
    expect(result.requestedRenderer).toBe('webgl');
  });

  it('falls back to CanvasPainter when WebGL construction fails', () => {
    const warn = vi.fn();
    class BrokenWebGLPainter extends FakeCanvasPainter {
      constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        throw new Error('no webgl');
      }
    }

    const result = createPainter(makeCanvas(), { renderer: 'auto' }, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: BrokenWebGLPainter,
      warn,
    });

    expect(result.painter).toBeInstanceOf(FakeCanvasPainter);
    expect(result.renderer).toBe('canvas');
    expect(result.requestedRenderer).toBe('auto');
    expect(warn).toHaveBeenCalledWith(
      'emap: WebGL renderer unavailable, falling back to Canvas 2D',
      expect.any(Error),
    );
  });
});
