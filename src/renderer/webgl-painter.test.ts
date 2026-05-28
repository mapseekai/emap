import { describe, expect, it, vi } from 'vitest';
import { AffineTransform } from '../geo/transform';
import { WebGLPainter } from './webgl-painter';

function makeCanvas(gl: any = {}) {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: vi.fn((kind: string) => kind === 'webgl2' ? gl : null),
  } as unknown as HTMLCanvasElement;
}

function makeDeps() {
  const renderPass = { end: vi.fn() };
  const draw = vi.fn();
  const destroy = vi.fn();
  return {
    renderPass,
    draw,
    destroy,
    deps: {
      createDevice: vi.fn(() => ({
        beginRenderPass: vi.fn(() => renderPass),
      })),
      createModel: vi.fn(() => ({ draw, destroy })),
    },
  };
}

describe('WebGLPainter', () => {
  it('throws when WebGL2 is unavailable', () => {
    const canvas = makeCanvas(null);
    expect(() => new WebGLPainter(canvas)).toThrow('WebGL2');
  });

  it('tracks transform, pixel ratio, resize, and clear without touching Canvas 2D', () => {
    const clear = vi.fn();
    const viewport = vi.fn();
    const gl = { clear, viewport, COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2 };
    const canvas = makeCanvas(gl);
    const { deps } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);

    painter.setPixelRatio(2);
    painter.resize(100, 50);
    painter.setTransform(new AffineTransform(2, -2, 10, 20));
    painter.clear();

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(viewport).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(clear).toHaveBeenCalledWith(3);
  });

  it('draws point geometry through luma model hooks', () => {
    const gl = {
      clear: vi.fn(),
      viewport: vi.fn(),
      COLOR_BUFFER_BIT: 1,
      DEPTH_BUFFER_BIT: 2,
    };
    const canvas = makeCanvas(gl);
    const { deps, draw, destroy, renderPass } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);

    painter.resize(100, 100);
    painter.drawPoints([[[1, 2], [3, 4]]], { color: '#336699', radius: 4 });

    expect(deps.createModel).toHaveBeenCalled();
    expect(draw).toHaveBeenCalledWith(renderPass);
    expect(destroy).toHaveBeenCalled();
  });

  it('keeps polygon fills shape-aware instead of using raw arc iteration', () => {
    const canvas = makeCanvas({
      clear: vi.fn(),
      viewport: vi.fn(),
      COLOR_BUFFER_BIT: 1,
      DEPTH_BUFFER_BIT: 2,
    });
    const { deps } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const arcs = {
      getArcIter: vi.fn(() => ({ hasNext: () => false })),
      getShapeIter: vi.fn(() => ({ hasNext: () => false })),
    };

    painter.drawPolygonFill([[[0]]], arcs as any, '#000');

    expect(arcs.getShapeIter).toHaveBeenCalled();
    expect(arcs.getArcIter).not.toHaveBeenCalled();
  });
});
