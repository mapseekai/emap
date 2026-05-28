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

function makeGl() {
  return {
    clear: vi.fn(),
    viewport: vi.fn(),
    enable: vi.fn(),
    stencilMask: vi.fn(),
    stencilFunc: vi.fn(),
    stencilOp: vi.fn(),
    COLOR_BUFFER_BIT: 1,
    DEPTH_BUFFER_BIT: 2,
    STENCIL_BUFFER_BIT: 4,
    STENCIL_TEST: 0x0b90,
    NOTEQUAL: 0x0205,
    ALWAYS: 0x0207,
    KEEP: 0x1e00,
    INVERT: 0x150a,
  };
}

function makeDeps() {
  const renderPass = { end: vi.fn() };
  const draw = vi.fn();
  const destroy = vi.fn();
  const setDrawingBufferSize = vi.fn();
  const beginRenderPass = vi.fn(() => renderPass);
  return {
    renderPass,
    draw,
    destroy,
    setDrawingBufferSize,
    beginRenderPass,
    deps: {
      createDevice: vi.fn(() => ({
        beginRenderPass,
        getDefaultCanvasContext: vi.fn(() => ({ setDrawingBufferSize })),
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
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, setDrawingBufferSize } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);

    painter.setPixelRatio(2);
    painter.resize(100, 50);
    painter.setTransform(new AffineTransform(2, -2, 10, 20));
    painter.clear();

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(setDrawingBufferSize).toHaveBeenCalledWith(200, 100);
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(gl.clear).toHaveBeenCalledWith(7);
  });

  it('draws point geometry through luma model hooks', () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, draw, destroy, renderPass, beginRenderPass } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);

    painter.setPixelRatio(2);
    painter.resize(100, 100);
    painter.drawPoints([[[1, 2], [3, 4]]], { color: '#336699', radius: 4 });

    expect(deps.createModel).toHaveBeenCalled();
    expect(beginRenderPass).toHaveBeenCalledWith({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: { viewport: [0, 0, 200, 200] },
    });
    expect(draw).toHaveBeenCalledWith(renderPass);
    expect(destroy).toHaveBeenCalled();
  });

  it('keeps polygon fills shape-aware instead of using raw arc iteration', () => {
    const canvas = makeCanvas(makeGl());
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

  it('fills polygons with a stencil evenodd pass instead of painting fan triangles directly', () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, beginRenderPass, draw, renderPass } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const points = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const arcs = {
      getShapeIter: vi.fn(() => {
        let i = -1;
        return {
          x: 0,
          y: 0,
          hasNext() {
            i++;
            const p = points[i];
            if (!p) return false;
            this.x = p[0];
            this.y = p[1];
            return true;
          },
        };
      }),
    };

    painter.resize(100, 50);
    painter.setTransform(new AffineTransform(2, -2, 10, 20));
    painter.drawPolygonFill([[[0]]], arcs as any, '#4db6ac', undefined, 0.5);

    expect(beginRenderPass).toHaveBeenNthCalledWith(1, {
      clearColor: false,
      clearDepth: false,
      clearStencil: 0,
      parameters: {
        viewport: [0, 0, 100, 50],
        colorMask: 0,
      },
    });
    expect(beginRenderPass).toHaveBeenNthCalledWith(2, {
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, 100, 50],
      },
    });
    expect(gl.stencilFunc).toHaveBeenNthCalledWith(1, gl.ALWAYS, 0, 0xff);
    expect(gl.stencilOp).toHaveBeenNthCalledWith(1, gl.KEEP, gl.KEEP, gl.INVERT);
    expect(gl.stencilFunc).toHaveBeenNthCalledWith(2, gl.NOTEQUAL, 0, 0xff);
    expect(gl.stencilOp).toHaveBeenNthCalledWith(2, gl.KEEP, gl.KEEP, gl.KEEP);
    expect(deps.createModel).toHaveBeenCalledTimes(2);
    expect(Array.from(deps.createModel.mock.calls[1][1].positions)).toEqual([
      -5, 10, 45, 10, 45, -15,
      -5, 10, 45, -15, -5, -15,
    ]);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenCalledWith(renderPass);
  });
});
