import type { Device, PrimitiveTopology, RenderPass } from '@luma.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import { WebGLDevice } from '@luma.gl/webgl';
import { AffineTransform } from '../geo/transform';
import type { Painter, DrawOverlayState } from './painter';
import type {
  ArcCollection,
  PointStyle,
  StrokeStyle,
  VertexDotStyle,
} from '../types/mapshaper-types';
import {
  buildArcLineGeometry,
  buildExpandedLineGeometry,
  buildPointGeometry,
  buildPolygonRingGeometry,
} from './webgl/geometry';
import {
  parseColor,
  resolvePointUniforms,
  resolveStrokeUniforms,
  type Rgba,
} from './webgl/style';

const POSITION_VS = `#version 300 es
in vec2 positions;
uniform mat3 u_matrix;
uniform float u_pointSize;
void main() {
  vec3 p = u_matrix * vec3(positions, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}`;

const COLOR_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`;

interface DrawableModel {
  draw(renderPass: RenderPass): boolean | void;
  destroy(): void;
}

export interface WebGLPainterDependencies {
  createDevice?: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => Device;
  createModel?: (
    device: Device,
    props: {
      topology: PrimitiveTopology;
      positions: Float32Array;
      uniforms: Record<string, unknown>;
    },
  ) => DrawableModel;
}

export class WebGLPainter implements Painter {
  private _gl: WebGL2RenderingContext;
  private _device: Device;
  private _transform: AffineTransform = new AffineTransform();
  private _pixelRatio: number =
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  private _width = 0;
  private _height = 0;
  private _createModel: NonNullable<WebGLPainterDependencies['createModel']>;

  constructor(
    private _canvas: HTMLCanvasElement,
    deps: WebGLPainterDependencies = {},
  ) {
    const gl = _canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGLPainter requires WebGL2');

    this._gl = gl;
    this._device = deps.createDevice
      ? deps.createDevice(gl, _canvas)
      : this._createDefaultDevice(gl, _canvas);
    this._createModel = deps.createModel ?? this._createDefaultModel;
  }

  setTransform(transform: AffineTransform): void {
    this._transform = transform;
  }

  setPixelRatio(ratio: number): void {
    this._pixelRatio = ratio;
  }

  clear(): void {
    this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._canvas.width = Math.floor(width * this._pixelRatio);
    this._canvas.height = Math.floor(height * this._pixelRatio);
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
  }

  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void {
    if (style.width === 0) return;
    const used = new Set<number>();
    for (const shape of shapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) used.add(arcId >= 0 ? arcId : ~arcId);
      }
    }
    this.drawArcs(arcs, style, i => used.has(i));
  }

  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void {
    if (style.width === 0) return;
    const geometry = buildArcLineGeometry(arcs, filter);
    const uniforms = resolveStrokeUniforms(style, this._pixelRatio);
    const expanded = uniforms.width > 1
      ? buildExpandedLineGeometry(geometry.positions, uniforms.width)
      : geometry;
    this._drawPositions(
      expanded.positions,
      expanded.vertexCount,
      uniforms.width > 1 ? 'triangle-list' : 'line-list',
      {
        color: uniforms.color,
        pointSize: 1,
      },
    );
  }

  drawPoints(shapes: any[], style: PointStyle): void {
    const geometry = buildPointGeometry(shapes);
    const uniforms = resolvePointUniforms(style, this._pixelRatio);
    this._drawPositions(geometry.positions, geometry.vertexCount, 'point-list', {
      color: uniforms.color,
      pointSize: uniforms.radius * 2,
    });
  }

  drawPolygonFill(
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
  ): void {
    // Phase 1 keeps polygon conversion shape-aware; Phase 2 replaces this
    // simple fan fill with a stencil evenodd fill path for large polygons.
    const geometry = buildPolygonRingGeometry(shapes, arcs as any, filter);
    const triangles = this._triangulateRings(
      geometry.positions,
      geometry.ringStarts,
      geometry.ringCounts,
    );
    this._drawPositions(triangles, triangles.length / 2, 'triangle-list', {
      color: parseColor(fillColor, opacity),
      pointSize: 1,
    });
  }

  drawVertexDots(
    shapes: any[],
    arcs: ArcCollection,
    style: VertexDotStyle = {},
  ): void {
    const positions: number[] = [];
    for (const shape of shapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) {
          const iter = arcs.getArcIter(arcId >= 0 ? arcId : ~arcId);
          while (iter.hasNext()) positions.push(iter.x, iter.y);
        }
      }
    }

    this._drawPositions(new Float32Array(positions), positions.length / 2, 'point-list', {
      color: parseColor(style.dotColor || '#333'),
      pointSize: (style.dotRadius || 3) * this._pixelRatio * 2,
    });

    if (style.hoverVertex) {
      this._drawPositions(new Float32Array(style.hoverVertex), 1, 'point-list', {
        color: parseColor(style.hoverColor || '#cc6acc'),
        pointSize: (style.hoverRadius || 6) * this._pixelRatio * 2,
      });
    }
  }

  drawDrawingOverlay(state: DrawOverlayState): void {
    const color = parseColor(state.drawColor || '#0078ff');
    const lineCoords: number[] = [];
    const verts = state.vertices;

    for (let i = 1; i < verts.length; i++) {
      lineCoords.push(verts[i - 1][0], verts[i - 1][1], verts[i][0], verts[i][1]);
    }
    if (verts.length > 0 && state.cursorCoord) {
      const last = verts[verts.length - 1];
      lineCoords.push(last[0], last[1], state.cursorCoord[0], state.cursorCoord[1]);
      if (state.geometryType === 'polygon' && verts.length >= 2) {
        const first = verts[0];
        lineCoords.push(state.cursorCoord[0], state.cursorCoord[1], first[0], first[1]);
      }
    }

    const lines = buildExpandedLineGeometry(new Float32Array(lineCoords), 2 * this._pixelRatio);
    this._drawPositions(lines.positions, lines.vertexCount, 'triangle-list', {
      color,
      pointSize: 1,
    });
    this._drawPositions(new Float32Array(verts.flat()), verts.length, 'point-list', {
      color,
      pointSize: 8 * this._pixelRatio,
    });
    if (state.snapCoord) {
      this._drawPositions(new Float32Array(state.snapCoord), 1, 'point-list', {
        color: parseColor('#ff4444'),
        pointSize: 14 * this._pixelRatio,
      });
    }
  }

  private _createDefaultDevice(
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
  ): Device {
    return new WebGLDevice({
      _handle: gl,
      _reuseDevices: true,
      createCanvasContext: { canvas, autoResize: false },
    });
  }

  private _createDefaultModel(
    device: Device,
    props: {
      topology: PrimitiveTopology;
      positions: Float32Array;
      uniforms: Record<string, unknown>;
    },
  ): DrawableModel {
    const geometry = new Geometry({
      topology: props.topology,
      attributes: {
        POSITION: { size: 2, value: props.positions },
      },
    });
    return new Model(device, {
      vs: POSITION_VS,
      fs: COLOR_FS,
      geometry,
      uniforms: props.uniforms,
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha',
      },
    });
  }

  private _matrix(): Float32Array {
    const sx = 2 / (this._width || 1);
    const sy = -2 / (this._height || 1);
    return new Float32Array([
      this._transform.mx * sx, 0, 0,
      0, this._transform.my * sy, 0,
      this._transform.bx * sx - 1, this._transform.by * sy + 1, 1,
    ]);
  }

  private _drawPositions(
    positions: Float32Array,
    vertexCount: number,
    topology: PrimitiveTopology,
    uniforms: { color: Rgba; pointSize: number },
  ): void {
    if (vertexCount === 0) return;
    const model = this._createModel(this._device, {
      topology,
      positions,
      uniforms: {
        u_matrix: this._matrix(),
        u_color: uniforms.color,
        u_pointSize: uniforms.pointSize,
      },
    });
    const renderPass = this._device.beginRenderPass({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
    });
    model.draw(renderPass);
    renderPass.end();
    model.destroy();
  }

  private _triangulateRings(
    positions: Float32Array,
    ringStarts: number[],
    ringCounts: number[],
  ): Float32Array {
    const out: number[] = [];
    for (let ring = 0; ring < ringStarts.length; ring++) {
      const start = ringStarts[ring];
      const count = ringCounts[ring];
      if (count < 3) continue;
      const ax = positions[start * 2];
      const ay = positions[start * 2 + 1];
      for (let i = 1; i < count - 1; i++) {
        const b = start + i;
        const c = start + i + 1;
        out.push(
          ax, ay,
          positions[b * 2], positions[b * 2 + 1],
          positions[c * 2], positions[c * 2 + 1],
        );
      }
    }
    return new Float32Array(out);
  }
}
