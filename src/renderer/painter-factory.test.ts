import { beforeEach, describe, expect, it, vi } from 'vitest';
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

class FakeWebGLPainter extends FakeCanvasPainter {
  static deps: unknown[] = [];

  constructor(canvas: HTMLCanvasElement, deps?: unknown) {
    super(canvas);
    FakeWebGLPainter.deps.push(deps);
  }
}

function makeCanvas() {
  return { getContext: vi.fn(() => ({})), style: {} } as unknown as HTMLCanvasElement;
}

describe('createPainter', () => {
  beforeEach(() => {
    FakeWebGLPainter.deps = [];
  });

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
    const onAsyncGeometryReady = vi.fn();
    const result = createPainter(makeCanvas(), { renderer: 'webgl' }, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: FakeWebGLPainter,
      warn: vi.fn(),
    }, {
      geometryWorkerEnabled: true,
      geometryWorkerUrl: 'emap-geometry-worker.js',
      geometryWorkerThreshold: 10,
      onAsyncGeometryReady,
    });

    expect(result.painter).toBeInstanceOf(FakeWebGLPainter);
    expect(result.renderer).toBe('webgl');
    expect(result.requestedRenderer).toBe('webgl');
    expect(FakeWebGLPainter.deps[0]).toEqual({
      geometryWorkerEnabled: true,
      geometryWorkerUrl: 'emap-geometry-worker.js',
      geometryWorkerThreshold: 10,
      onAsyncGeometryReady,
    });
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
