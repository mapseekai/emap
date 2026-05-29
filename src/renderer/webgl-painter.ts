import type { Device, PrimitiveTopology, RenderPass, RenderPassProps } from '@luma.gl/core';
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
  buildArcSegmentGeometry,
  buildExpandedLineGeometry,
  buildLineSegmentQuadGeometry,
  buildPointQuadGeometry,
  buildPolygonTessellatedGeometry,
} from './webgl/geometry';
import {
  parseColor,
  resolvePointUniforms,
  resolveStrokeUniforms,
  type Rgba,
} from './webgl/style';
import { makeFrameState } from './webgl/frame';
import {
  createRetainedWebGLModel,
  type WebGLDrawableModel,
  type WebGLModelProps,
} from './webgl/models';
import { WebGLGeometryCache } from './webgl/cache';
import type { WebGLArcChunkOptions, WebGLArcSegmentChunk } from './webgl/cache';

interface DrawableModel {
  update?(props: WebGLModelProps): void;
  draw(renderPass: RenderPass): boolean | void;
  destroy(): void;
}

interface DrawPositionOptions {
  renderPass?: RenderPassProps;
  beforeDraw?: () => void;
}

export interface WebGLPainterDependencies {
  createDevice?: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => Device;
  createModel?: (
    device: Device,
    props: WebGLModelProps,
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
  private _models = new Map<string, DrawableModel>();
  private _geometryCache = new WebGLGeometryCache();
  private _arcRevisions = new WeakMap<ArcCollection, number>();
  private _pointRevisions = new WeakMap<any[], number>();

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
    this._gl.clear(
      this._gl.COLOR_BUFFER_BIT |
      this._gl.DEPTH_BUFFER_BIT |
      this._gl.STENCIL_BUFFER_BIT,
    );
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    const drawingBufferWidth = Math.floor(width * this._pixelRatio);
    const drawingBufferHeight = Math.floor(height * this._pixelRatio);
    this._canvas.width = drawingBufferWidth;
    this._canvas.height = drawingBufferHeight;
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    this._device.getDefaultCanvasContext()
      .setDrawingBufferSize(drawingBufferWidth, drawingBufferHeight);
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
    const revision = this._arcRevisions.get(arcs) ?? 0;
    const geometry = filter
      ? this._geometryCache.getArcSegmentsForFilter(arcs, filter, revision)
      : this._geometryCache.getArcSegments(arcs, revision);
    this._drawArcSegmentGeometry(geometry, style);
  }

  drawArcFlags(arcs: ArcCollection, style: StrokeStyle, flags?: Uint8Array | null): void {
    if (style.width === 0) return;
    const geometry = this._geometryCache.getArcSegmentsForFlags(
      arcs,
      flags,
      this._arcRevisions.get(arcs) ?? 0,
    );
    this._drawArcSegmentGeometry(geometry, style);
  }

  drawArcChunks(
    arcs: ArcCollection,
    style: StrokeStyle,
    flags: Uint8Array | null | undefined,
    viewportBBox: [number, number, number, number] | null | undefined,
    options: WebGLArcChunkOptions = {},
  ): void {
    if (style.width === 0) return;
    const chunks = this._geometryCache.getArcSegmentChunksForFlags(
      arcs,
      flags,
      this._arcRevisions.get(arcs) ?? 0,
      options,
    );
    const visible = viewportBBox ? chunks.search(viewportBBox) : chunks.chunks;
    this._drawArcSegmentChunks(visible, style);
  }

  prefersGpuClipping(): boolean {
    return true;
  }

  private _drawArcSegmentGeometry(
    geometry: ReturnType<typeof buildArcSegmentGeometry>,
    style: StrokeStyle,
  ): void {
    const uniforms = resolveStrokeUniforms(style, this._pixelRatio);
    this._drawLineSegments(geometry, {
      color: uniforms.color,
      width: uniforms.width,
    });
  }

  setArcRenderRevision(arcs: ArcCollection, revision: number): void {
    this._arcRevisions.set(arcs, revision);
  }

  setPointRenderRevision(shapes: any[], revision: number): void {
    this._pointRevisions.set(shapes, revision);
  }

  invalidateArcs(arcs: ArcCollection): void {
    this._geometryCache.invalidateArcs(arcs);
    this._arcRevisions.delete(arcs);
  }

  invalidateAll(): void {
    this._geometryCache.invalidateAll();
    this._arcRevisions = new WeakMap();
    this._pointRevisions = new WeakMap();
  }

  drawPoints(shapes: any[], style: PointStyle): void {
    const geometry = this._geometryCache.getPointGeometry(
      shapes,
      this._pointRevisions.get(shapes) ?? 0,
    );
    const uniforms = resolvePointUniforms(style, this._pixelRatio);
    this._drawPointInstances(geometry.positions, geometry.vertexCount, {
      color: uniforms.color,
      radius: uniforms.radius,
    }, geometry.origin);
  }

  drawPolygonFill(
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
  ): void {
    const geometry = filter
      ? buildPolygonTessellatedGeometry(shapes, arcs as any, filter, this._frame().origin)
      : this._geometryCache.getPolygonTessellation(
        shapes,
        arcs,
        this._arcRevisions.get(arcs) ?? 0,
      );
    if (geometry.vertexCount === 0) return;
    this._drawIndexedPositions(geometry.positions, geometry.indices, geometry.vertexCount, {
      color: parseColor(fillColor, opacity),
      pointSize: 1,
    }, geometry.origin);
  }

  drawPolygonFillArcFlags(
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    flags: Uint8Array | null | undefined,
    opacity?: number,
  ): void {
    const geometry = this._geometryCache.getPolygonTessellationForFlags(
      shapes,
      arcs,
      flags,
      this._arcRevisions.get(arcs) ?? 0,
    );
    if (geometry.vertexCount === 0) return;
    this._drawIndexedPositions(geometry.positions, geometry.indices, geometry.vertexCount, {
      color: parseColor(fillColor, opacity),
      pointSize: 1,
    }, geometry.origin);
  }

  drawVertexDots(
    shapes: any[],
    arcs: ArcCollection,
    style: VertexDotStyle = {},
  ): void {
    const positions: number[] = [];
    const frame = this._frame();
    for (const shape of shapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) {
          const iter = arcs.getArcIter(arcId >= 0 ? arcId : ~arcId);
          while (iter.hasNext()) {
            positions.push(iter.x - frame.origin[0], iter.y - frame.origin[1]);
          }
        }
      }
    }

    this._drawPointInstances(new Float32Array(positions), positions.length / 2, {
      color: parseColor(style.dotColor || '#333'),
      radius: (style.dotRadius || 3) * this._pixelRatio,
    });

    if (style.hoverVertex) {
      this._drawPointInstances(this._rebasePositions(style.hoverVertex), 1, {
        color: parseColor(style.hoverColor || '#cc6acc'),
        radius: (style.hoverRadius || 6) * this._pixelRatio,
      });
    }
  }

  drawDrawingOverlay(state: DrawOverlayState): void {
    const color = parseColor(state.drawColor || '#0078ff');
    const lineCoords: number[] = [];
    const verts = state.vertices;
    const frame = this._frame();

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

    const lines = buildExpandedLineGeometry(
      lineCoords,
      2,
      this._transform,
      frame.origin,
    );
    this._drawPositions(lines.positions, lines.vertexCount, 'triangle-list', {
      color,
      pointSize: 1,
    });
    this._drawPointInstances(this._rebasePositions(verts.flat()), verts.length, {
      color,
      radius: 4 * this._pixelRatio,
    });
    if (state.snapCoord) {
      this._drawPointInstances(this._rebasePositions(state.snapCoord), 1, {
        color: parseColor('#ff4444'),
        radius: 7 * this._pixelRatio,
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
    props: WebGLModelProps,
  ): WebGLDrawableModel {
    return createRetainedWebGLModel(device, props);
  }

  private _matrix(): Float32Array {
    return this._frame().matrix;
  }

  private _frame(origin?: [number, number]) {
    return makeFrameState(
      this._transform,
      this._width,
      this._height,
      this._pixelRatio,
      origin,
    );
  }

  private _drawPositions(
    positions: Float32Array,
    vertexCount: number,
    topology: PrimitiveTopology,
    uniforms: { color: Rgba; pointSize: number },
    options: DrawPositionOptions = {},
  ): void {
    if (vertexCount === 0) return;
    const props = {
      topology,
      positions,
      uniforms: {
        u_matrix: this._matrix(),
        u_color: uniforms.color,
        u_pointSize: uniforms.pointSize,
      },
    };
    const model = this._getModel(`positions:${topology}`, props);
    const renderPass = this._device.beginRenderPass(options.renderPass ?? {
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, this._canvas.width, this._canvas.height],
      },
    });
    options.beforeDraw?.();
    model.draw(renderPass);
    renderPass.end();
  }

  private _drawIndexedPositions(
    positions: Float32Array,
    indices: Uint32Array,
    vertexCount: number,
    uniforms: { color: Rgba; pointSize: number },
    origin?: [number, number],
  ): void {
    if (vertexCount === 0) return;
    const frame = this._frame(origin);
    const model = this._getModel('polygon-fill', {
      shaderKind: 'solid',
      topology: 'triangle-list',
      positions,
      indices,
      vertexCount,
      uniforms: {
        u_matrix: frame.matrix,
        u_color: uniforms.color,
        u_pointSize: uniforms.pointSize,
      },
    });
    const renderPass = this._device.beginRenderPass({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, this._canvas.width, this._canvas.height],
      },
    });
    model.draw(renderPass);
    renderPass.end();
  }

  private _drawPointInstances(
    instancePositions: Float32Array,
    instanceCount: number,
    uniforms: { color: Rgba; radius: number },
    origin?: [number, number],
  ): void {
    if (instanceCount === 0) return;
    const quad = buildPointQuadGeometry();
    const frame = this._frame(origin);
    const props = {
      topology: 'triangle-strip',
      positions: quad.positions,
      instancePositions,
      instanceCount,
      isInstanced: true,
      uniforms: {
        u_matrix: frame.matrix,
        u_color: uniforms.color,
        u_radius: uniforms.radius,
        u_viewportSize: frame.viewportSize,
      },
    } satisfies WebGLModelProps;
    const model = this._getModel('point-instances', props);
    const renderPass = this._device.beginRenderPass({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, this._canvas.width, this._canvas.height],
      },
    });
    model.draw(renderPass);
    renderPass.end();
  }

  private _drawLineSegments(
    geometry: ReturnType<typeof buildArcSegmentGeometry>,
    uniforms: { color: Rgba; width: number },
  ): void {
    if (geometry.segmentCount === 0) return;
    const quad = buildLineSegmentQuadGeometry();
    const frame = this._frame(geometry.origin);
    const model = this._getModel('line-segments', {
      shaderKind: 'line',
      topology: 'triangle-list',
      positions: quad.positions,
      instanceCount: geometry.segmentCount,
      isInstanced: true,
      uniforms: {
        u_matrix: frame.matrix,
        u_color: uniforms.color,
        u_width: uniforms.width / 2,
        u_viewportSize: frame.viewportSize,
      },
      attributes: {
        instanceLeftPositions: {
          data: geometry.leftPositions,
          format: 'float32x2',
          stepMode: 'instance',
        },
        instanceStartPositions: {
          data: geometry.startPositions,
          format: 'float32x2',
          stepMode: 'instance',
        },
        instanceEndPositions: {
          data: geometry.endPositions,
          format: 'float32x2',
          stepMode: 'instance',
        },
        instanceRightPositions: {
          data: geometry.rightPositions,
          format: 'float32x2',
          stepMode: 'instance',
        },
        instanceSegmentTypes: {
          data: geometry.segmentTypesFloat,
          format: 'float32',
          stepMode: 'instance',
        },
      },
    });
    const renderPass = this._device.beginRenderPass({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, this._canvas.width, this._canvas.height],
      },
    });
    model.draw(renderPass);
    renderPass.end();
  }

  private _drawArcSegmentChunks(
    chunks: WebGLArcSegmentChunk[],
    style: StrokeStyle,
  ): void {
    const visible = chunks.filter(chunk => chunk.geometry.segmentCount > 0);
    if (visible.length === 0) return;
    const uniforms = resolveStrokeUniforms(style, this._pixelRatio);
    const quad = buildLineSegmentQuadGeometry();
    const models = visible.map(chunk => {
      const geometry = chunk.geometry;
      const frame = this._frame(geometry.origin);
      return this._getModel(`line-segments:${chunk.id}`, {
        shaderKind: 'line',
        topology: 'triangle-list',
        positions: quad.positions,
        instanceCount: geometry.segmentCount,
        isInstanced: true,
        uniforms: {
          u_matrix: frame.matrix,
          u_color: uniforms.color,
          u_width: uniforms.width / 2,
          u_viewportSize: frame.viewportSize,
        },
        attributes: {
          instanceLeftPositions: {
            data: geometry.leftPositions,
            format: 'float32x2',
            stepMode: 'instance',
          },
          instanceStartPositions: {
            data: geometry.startPositions,
            format: 'float32x2',
            stepMode: 'instance',
          },
          instanceEndPositions: {
            data: geometry.endPositions,
            format: 'float32x2',
            stepMode: 'instance',
          },
          instanceRightPositions: {
            data: geometry.rightPositions,
            format: 'float32x2',
            stepMode: 'instance',
          },
          instanceSegmentTypes: {
            data: geometry.segmentTypesFloat,
            format: 'float32',
            stepMode: 'instance',
          },
        },
      } satisfies WebGLModelProps);
    });
    const renderPass = this._device.beginRenderPass({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      parameters: {
        viewport: [0, 0, this._canvas.width, this._canvas.height],
      },
    });
    for (const model of models) model.draw(renderPass);
    renderPass.end();
  }

  private _getModel(key: string, props: WebGLModelProps): DrawableModel {
    const cached = this._models.get(key);
    if (cached?.update) {
      cached.update(props);
      return cached;
    }
    cached?.destroy();
    const model = this._createModel(this._device, props);
    this._models.set(key, model);
    return model;
  }

  private _rebasePositions(positions: ArrayLike<number>): Float32Array {
    const { origin } = this._frame();
    if (origin[0] === 0 && origin[1] === 0 && positions instanceof Float32Array) {
      return positions;
    }
    const rebased = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 2) {
      rebased[i] = positions[i] - origin[0];
      rebased[i + 1] = positions[i + 1] - origin[1];
    }
    return rebased;
  }
}
