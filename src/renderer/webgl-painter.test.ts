import { describe, expect, it, vi } from "vitest";
import { AffineTransform } from "../geo/transform";
import { WebGLPainter } from "./webgl-painter";

function makeCanvas(gl: any = {}) {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: vi.fn((kind: string) => (kind === "webgl2" ? gl : null)),
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
  const update = vi.fn();
  const setDrawingBufferSize = vi.fn();
  const beginRenderPass = vi.fn(() => renderPass);
  return {
    renderPass,
    draw,
    destroy,
    update,
    setDrawingBufferSize,
    beginRenderPass,
    deps: {
      createDevice: vi.fn(() => ({
        beginRenderPass,
        getDefaultCanvasContext: vi.fn(() => ({ setDrawingBufferSize })),
      })),
      createModel: vi.fn(() => ({ draw, destroy, update })),
    },
  };
}

function makeArcIter(points: Array<[number, number]>) {
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
}

describe("WebGLPainter", () => {
  it("throws when WebGL2 is unavailable", () => {
    const canvas = makeCanvas(null);
    expect(() => new WebGLPainter(canvas)).toThrow("WebGL2");
  });

  it("tracks transform, pixel ratio, resize, and clear without touching Canvas 2D", () => {
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

  it("draws point geometry as instanced screen-space quads through luma model hooks", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, draw, destroy, update, renderPass, beginRenderPass } =
      makeDeps();
    const painter = new WebGLPainter(canvas, deps);

    painter.setPixelRatio(2);
    painter.resize(100, 100);
    painter.drawPoints(
      [
        [
          [1, 2],
          [3, 4],
        ],
      ],
      { color: "#336699", radius: 4 },
    );

    expect(deps.createModel).toHaveBeenCalled();
    const modelProps = deps.createModel.mock.calls[0][1];
    expect(modelProps.topology).toBe("triangle-strip");
    expect(Array.from(modelProps.positions)).toEqual([
      -1, -1, 1, -1, -1, 1, 1, 1,
    ]);
    expect(Array.from(modelProps.instancePositions)).toEqual([1, 2, 3, 4]);
    expect(modelProps.instanceCount).toBe(2);
    expect(modelProps.isInstanced).toBe(true);
    expect(modelProps.uniforms.u_radius).toBe(8);
    expect(modelProps.uniforms.u_viewportSize).toEqual([200, 200]);
    expect(beginRenderPass).toHaveBeenCalledWith({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: { viewport: [0, 0, 200, 200] },
    });
    expect(draw).toHaveBeenCalledWith(renderPass);
    expect(destroy).not.toHaveBeenCalled();

    painter.drawPoints([[[5, 6]]], { color: "#336699", radius: 4 });

    expect(deps.createModel).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(Array.from(update.mock.calls[0][0].instancePositions)).toEqual([
      5, 6,
    ]);
  });

  it("keeps polygon fills shape-aware instead of using raw arc iteration", () => {
    const canvas = makeCanvas(makeGl());
    const { deps } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const arcs = {
      getArcIter: vi.fn(() => ({ hasNext: () => false })),
      getShapeIter: vi.fn(() => ({ hasNext: () => false })),
    };

    painter.drawPolygonFill([[[0]]], arcs as any, "#000");

    expect(arcs.getShapeIter).toHaveBeenCalled();
    expect(arcs.getArcIter).not.toHaveBeenCalled();
  });

  it("draws arcs through PathLayer-style segment attributes", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const arcs = {
      size: () => 1,
      getArcIter: vi.fn(() =>
        makeArcIter([
          [0, 0],
          [10, 0],
          [10, 10],
        ]),
      ),
    };

    painter.setPixelRatio(2);
    painter.resize(100, 100);
    painter.drawArcs(arcs as any, { color: "#333", width: 3 });

    const props = deps.createModel.mock.calls[0][1];
    expect(props.shaderKind).toBe("line");
    expect(props.topology).toBe("triangle-list");
    expect(props.instanceCount).toBe(2);
    expect(Array.from(props.attributes.instanceStartPositions.data)).toEqual([
      0, 0, 10, 0,
    ]);
    expect(Array.from(props.attributes.instanceEndPositions.data)).toEqual([
      10, 0, 10, 10,
    ]);
    expect(Array.from(props.attributes.instanceSegmentTypes.data)).toEqual([
      1, 2,
    ]);
    expect(props.uniforms.u_width).toBe(3);
    expect(props.uniforms.u_viewportSize).toEqual([200, 200]);
  });

  it("draws layer arc flags through cached segment attributes", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const arcs = {
      size: () => 1,
      getArcIter: vi.fn(() =>
        makeArcIter([
          [0, 0],
          [10, 0],
        ]),
      ),
    };
    const flags = new Uint8Array([1]);

    painter.drawArcFlags(arcs as any, { color: "#333", width: 1 }, flags);
    painter.drawArcFlags(arcs as any, { color: "#333", width: 1 }, flags);

    const createdProps = deps.createModel.mock.calls[0][1];
    const updatedProps = deps.createModel.mock.results[0].value.update.mock.calls[0][0];
    expect(arcs.getArcIter).toHaveBeenCalledTimes(1);
    expect(deps.createModel).toHaveBeenCalledTimes(1);
    expect(updatedProps.attributes.instanceSegmentTypes.data)
      .toBe(createdProps.attributes.instanceSegmentTypes.data);
  });

  it("reuses polygon fill tessellation across redraws when topology is unchanged", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const arcs = {
      size: () => 1,
      getPointCount: () => points.length,
      getRetainedInterval: () => 0,
      getShapeIter: vi.fn(() => makeArcIter(points as Array<[number, number]>)),
    };
    const shapes = [[[0]]];

    painter.drawPolygonFill(shapes, arcs as any, "#4db6ac");
    painter.drawPolygonFill(shapes, arcs as any, "#4db6ac");

    expect(arcs.getShapeIter).toHaveBeenCalledTimes(1);
    expect(deps.createModel).toHaveBeenCalledTimes(1);
  });

  it("draws edit vertex dots as instanced screen-space quads", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, update } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const arcs = {
      getArcIter: vi.fn(() =>
        makeArcIter([
          [1, 2],
          [3, 4],
        ]),
      ),
    };

    painter.setPixelRatio(2);
    painter.resize(100, 100);
    painter.drawVertexDots([[[0]]], arcs as any, {
      dotColor: "#111111",
      dotRadius: 5,
      hoverColor: "#222222",
      hoverRadius: 7,
      hoverVertex: [9, 10],
    });

    expect(deps.createModel).toHaveBeenCalledTimes(1);
    const props = deps.createModel.mock.calls[0][1];
    expect(props.topology).toBe("triangle-strip");
    expect(props.isInstanced).toBe(true);
    expect(Array.from(props.instancePositions)).toEqual([1, 2, 3, 4]);
    expect(props.instanceCount).toBe(2);
    expect(props.uniforms.u_radius).toBe(10);
    expect(props.uniforms.u_viewportSize).toEqual([200, 200]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceCount: 1,
        instancePositions: new Float32Array([9, 10]),
        uniforms: expect.objectContaining({ u_radius: 14 }),
      }),
    );
  });

  it("draws drawing overlay vertices and snap target as instanced quads", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, update } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);

    painter.setPixelRatio(2);
    painter.resize(100, 100);
    painter.drawDrawingOverlay({
      active: true,
      geometryType: "line",
      vertices: [
        [1, 2],
        [3, 4],
      ],
      cursorCoord: [5, 6],
      snapCoord: [7, 8],
      drawColor: "#0078ff",
    });

    expect(deps.createModel).toHaveBeenCalledTimes(2);
    const pointProps = deps.createModel.mock.calls[1][1];
    expect(pointProps.topology).toBe("triangle-strip");
    expect(pointProps.isInstanced).toBe(true);
    expect(Array.from(pointProps.instancePositions)).toEqual([1, 2, 3, 4]);
    expect(pointProps.instanceCount).toBe(2);
    expect(pointProps.uniforms.u_radius).toBe(8);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceCount: 1,
        instancePositions: new Float32Array([7, 8]),
        uniforms: expect.objectContaining({ u_radius: 14 }),
      }),
    );
  });

  it("fills polygons through SolidPolygonLayer-style indexed triangle tessellation", () => {
    const gl = makeGl();
    const canvas = makeCanvas(gl);
    const { deps, beginRenderPass, draw, renderPass } = makeDeps();
    const painter = new WebGLPainter(canvas, deps);
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
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
    painter.drawPolygonFill([[[0]]], arcs as any, "#4db6ac", undefined, 0.5);

    expect(beginRenderPass).toHaveBeenCalledWith({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, 100, 50],
      },
    });
    expect(gl.enable).not.toHaveBeenCalled();
    expect(gl.stencilFunc).not.toHaveBeenCalled();
    expect(deps.createModel).toHaveBeenCalledTimes(1);
    const props = deps.createModel.mock.calls[0][1];
    expect(props.shaderKind).toBe("solid");
    expect(props.topology).toBe("triangle-list");
    expect(Array.from(props.positions)).toEqual([
      0, 0, 0, 10, 10, 10, 10, 0, 0, 0,
    ]);
    expect(props.indices).toBeInstanceOf(Uint32Array);
    expect(props.vertexCount).toBe(6);
    expect(props.uniforms.u_matrix).toEqual(
      new Float32Array([0.04, 0, 0, 0, 0.08, 0, -0.8, 0.2, 1]),
    );
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(renderPass);
  });
});
