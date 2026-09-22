import {
  cameraUniforms,
  perspectiveActive,
  groundBounds,
} from '../../domain/geo/perspective-transform';
import { useMsaaPath, opaquePathGroup, type PathRenderMode } from './path-pipeline';
import { PATH_CORNERS, PATH_INDICES } from './path-shaders';
import {
  Buffer,
  Texture,
  type Device,
  type RenderPass,
  type RenderPipeline,
  type RenderPipelineParameters,
  type Shader,
  type VertexArray,
  type Bindings,
  type Sampler,
  type Framebuffer,
  type QuerySet,
} from '@luma.gl/core';
import { WebGLDevice } from '@luma.gl/webgl';
import { AffineTransform } from '../../domain/geo/transform';
import { isFilledCircle, opaqueCircleGroup } from './point-pipeline';
import { shaderSource, shaderLayouts, type PipelineKind } from './portable-shaders';
import type { GeometryBuffer, MeshPaint, Rect, PathDrawRange } from './types';

export interface GpuMesh {
  kind: GeometryBuffer['kind'];
  buffer: Buffer;
  indices?: Buffer;
  count: number;
  bytes: number;
  vertexArray?: VertexArray;
  circleVertexArray?: VertexArray;
  pathMsaaVertexArray?: VertexArray;
  rangeVertexArrays?: Map<string, VertexArray>;
}
const IMMUTABLE_IMAGE_CACHE_BYTES = 32 * 1024 ** 2;
interface ImageEntry {
  texture: Texture;
  frame: number;
  immutable: boolean;
  smoothing: boolean;
}
const parameters: RenderPipelineParameters = {
  cullMode: 'none',
  blend: true,
  blendColorOperation: 'add',
  blendAlphaOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
};
/**
 * Portable luma v10 WebGL2 / WebGPU renderer used by the independent A/B benchmark.
 * Not installed in the default emap presets.
 * Owns the WebGL2 device and every resource allocated through luma.gl v10.
 */
export class GpuRenderer {
  private device!: Device;
  private pipelines = new Map<PipelineKind, { pipeline: RenderPipeline; shaders: Shader[] }>();
  private styles = new Map<
    string,
    {
      buffer: Buffer;
      values: Float32Array;
      frame: number;
      bindings: Bindings;
      images: Map<Texture, Bindings>;
    }
  >();
  private frameData = new Float32Array(60);
  private imageVertexArray: VertexArray | null = null;
  private msaaTexture: Texture | null = null;
  private msaaFramebuffer: Framebuffer | null = null;
  private pointDepthTexture: Texture | null = null;
  private pointDepthVertexArray: VertexArray | null = null;
  private pointGroup: string | null = null;
  private pointDepthDirty = false;
  private circleQueue: { mesh: GpuMesh; vao: VertexArray; bindings: Bindings }[] = [];
  private queuedCircleGroup: string | null = null;
  /** Debug/reference switch; both modes retain every source point. */
  circleOptimizationEnabled = true;
  private query: QuerySet | null = null;
  private queryBusy = false;
  private timing = false;
  private timedFrame = false;
  private timingEpoch = 0;
  readonly gpuTimings: number[] = [];
  private fullScissor = true;
  get backend(): 'webgl' | 'webgpu' {
    return this.device.type as 'webgl' | 'webgpu';
  }
  get label(): string {
    return `luma.gl 10.0.0-alpha.1 / ${this.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}`;
  }
  get timestampSupported(): boolean {
    return this.device.features.has('timestamp-query');
  }
  static async create(
    canvas: HTMLCanvasElement,
    invalidate: () => void,
    report: (error: Error) => void,
    backend: 'webgl' | 'webgpu' = 'webgl',
  ): Promise<GpuRenderer> {
    let device: Device | undefined;
    if (backend === 'webgpu') {
      canvas.dataset.gpuStage = 'loading-adapter';
      const { webgpuAdapter } = await import('@luma.gl/webgpu');
      canvas.dataset.gpuStage = 'requesting-device';
      if (!webgpuAdapter.isSupported())
        throw new Error(
          'WebGPU is unavailable on this browser / secure context. Select WebGL2 explicitly.',
        );
      device = await webgpuAdapter.create({
        createCanvasContext: {
          canvas,
          autoResize: false,
          useDevicePixels: false,
          alphaMode: 'premultiplied',
        },
        powerPreference: 'high-performance',
        featureLevel: 'core',
        optionalFeatures: ['timestamp-query'],
        onError: report,
      });
    }
    canvas.dataset.gpuStage = 'creating-pipelines';
    const renderer = new GpuRenderer(canvas, invalidate, report, device);
    canvas.dataset.gpuStage = 'compiling-shaders';
    try {
      // Request all compiler logs together, then flush the device command stream.
      // Serial getCompilationInfo awaits can stall until another native GPU operation
      // while the page module is still awaiting initialization (observed in Chrome 153).
      const checks = [...renderer.pipelines.values()].flatMap((entry) =>
        entry.shaders.map((shader) => shader.getCompilationInfo()),
      );
      if (renderer.backend === 'webgpu') renderer.device.submit();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const logs = await Promise.race([
          Promise.all(checks),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('GPU shader initialization timed out.')),
              30000,
            );
          }),
        ]);
        const errors = logs.flat().filter((message) => message.type === 'error');
        if (errors.length) throw new Error(errors.map((message) => message.message).join('\n'));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      canvas.dataset.gpuStage = 'ready';
      return renderer;
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }
  private quad!: Buffer;
  private pathCorners!: Buffer;
  private pathIndices!: Buffer;
  pathMode: PathRenderMode = 'auto';
  private pathSamples = 1;
  get pathRendering() {
    return { mode: this.pathMode, samples: this.pathSamples };
  }
  private circleQuad!: Buffer;
  private nearest!: Sampler;
  private linear!: Sampler;
  private meshes = new Set<GpuMesh>();
  private images = new Map<CanvasImageSource, ImageEntry>();
  private dashes = new Map<
    string,
    { texture: Texture; period: number; count: number; frame: number }
  >();
  private pass: RenderPass | null = null;
  private transform = new AffineTransform();
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private frame = 0;
  private disposed = false;
  private lost = false;
  readonly stats = {
    uploads: 0,
    uploadedBytes: 0,
    drawCalls: 0,
    liveBufferBytes: 0,
    textureUploads: 0,
    liveTextureBytes: 0,
    liveTextures: 0,
    uniformWrites: 0,
    frames: 0,
    pathMsaaDraws: 0,
    circleCoreDraws: 0,
    circleEdgeDraws: 0,
    pointDepthResets: 0,
  };
  constructor(
    private canvas: HTMLCanvasElement,
    private invalidate: () => void,
    private report: (error: Error) => void,
    device?: Device,
  ) {
    try {
      this.initialize(device);
    } catch (error) {
      this.release();
      this.device?.destroy();
      throw error;
    }
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }
  get deviceInfo() {
    return { ...this.device.info };
  }
  private onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.report(
      new Error('WebGL context lost; emap will rebuild GPU resources after restoration.'),
    );
  };
  private onRestored = (): void => {
    if (this.disposed) return;
    this.release();
    this.device.destroy();
    try {
      this.initialize();
      this.lost = false;
      this.invalidate();
    } catch (error) {
      this.report(error instanceof Error ? error : new Error(String(error)));
    }
  };
  private initialize(device?: Device): void {
    this.device =
      device ??
      new WebGLDevice({
        createCanvasContext: { canvas: this.canvas, autoResize: false, useDevicePixels: false },
        webgl: {
          alpha: true,
          depth: true,
          stencil: false,
          antialias: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
        },
        onError: (error) => this.report(error),
      });
    this.pathSamples =
      this.backend === 'webgpu'
        ? 4
        : (this.device as WebGLDevice).gl.getParameter((this.device as WebGLDevice).gl.SAMPLES);
    this.nearest = this.device.createSampler({
      minFilter: 'nearest',
      magFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.linear = this.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.quad = this.device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    });
    this.circleQuad = this.device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    });
    this.pathCorners = this.device.createBuffer({
      data: new Float32Array(PATH_CORNERS),
      usage: Buffer.VERTEX,
    });
    this.pathIndices = this.device.createBuffer({
      data: new Uint16Array(PATH_INDICES),
      usage: Buffer.INDEX,
      indexType: 'uint16',
    });
    for (const kind of [
      'fill',
      'point',
      'circle',
      'circle-core',
      'circle-edge',
      'point-depth-reset',
      'line',
      'path',
      'path-msaa',
      'path-msaa-reference',
      'image',
    ] as const) {
      const layout = shaderLayouts(kind, this.backend === 'webgpu');
      const source = shaderSource(kind);
      // Explicit locations keep GLSL and WGSL layouts identical.
      const located = (code: string) =>
        layout.shaderLayout.attributes.reduce(
          (text, a) =>
            text.replace(
              new RegExp(`in (vec[234]|float) ${a.name};`),
              `layout(location=${a.location}) in $1 ${a.name};`,
            ),
          code,
        );
      const vs = this.device.createShader({
        language: this.backend === 'webgpu' ? 'wgsl' : 'glsl',
        stage: 'vertex',
        source: this.backend === 'webgpu' ? source.source : located(source.vs),
      });
      const fs =
        this.backend === 'webgpu'
          ? vs
          : this.device.createShader({ language: 'glsl', stage: 'fragment', source: source.fs });
      try {
        const pipeline = this.device.createRenderPipeline({
          id: `emap-${kind}`,
          vs,
          fs,
          ...layout,
          vertexEntryPoint: 'vertexMain',
          fragmentEntryPoint: 'fragmentMain',
          topology: kind.startsWith('circle') ? 'triangle-strip' : 'triangle-list',
          depthStencilAttachmentFormat: this.backend === 'webgpu' ? 'depth24plus' : undefined,
          parameters: {
            ...parameters,
            depthCompare: 'always',
            depthWriteEnabled: false,
            ...(kind === 'path-msaa'
              ? { blend: false, depthCompare: 'less', depthWriteEnabled: true }
              : {}),
            ...(kind === 'circle-core'
              ? { blend: false, depthCompare: 'less', depthWriteEnabled: true }
              : {}),
            ...(kind === 'circle-edge' ? { depthCompare: 'less' } : {}),
            ...(kind === 'point-depth-reset'
              ? {
                  blend: false,
                  colorMask: 0,
                  depthCompare: 'greater-equal',
                  depthWriteEnabled: true,
                }
              : {}),
            ...(this.backend === 'webgpu' ? { sampleCount: 4 } : {}),
          },
        });
        this.pipelines.set(kind, { pipeline, shaders: fs === vs ? [vs] : [vs, fs] });
      } catch (error) {
        vs.destroy();
        if (fs !== vs) fs.destroy();
        throw error;
      }
    }
    if (this.backend === 'webgpu') {
      const owned = this.device;
      void owned.lost.then((info) => {
        if (!this.disposed && this.device === owned) {
          this.lost = true;
          this.report(
            new Error(
              `WebGPU device lost: ${info.message}. Reload this page; no silent backend fallback.`,
            ),
          );
        }
      });
    }
  }
  private vertexArray(
    kind: PipelineKind,
    buffer: Buffer,
    indices?: Buffer,
    firstInstance = 0,
  ): VertexArray {
    const entry = this.pipelines.get(kind)!;
    const { bufferLayout } = shaderLayouts(kind, this.backend === 'webgpu');
    if (firstInstance)
      for (const binding of bufferLayout) {
        if (binding.stepMode !== 'instance') continue;
        for (const attr of binding.attributes ?? [])
          attr.byteOffset += firstInstance * (binding.byteStride ?? 0);
      }
    const layout = entry.pipeline.shaderLayout;
    const vao = this.device.createVertexArray({ shaderLayout: layout, bufferLayout });
    try {
      for (const binding of bufferLayout) {
        const value =
          binding.name === 'corners'
            ? kind.startsWith('circle')
              ? this.circleQuad
              : kind.startsWith('path-msaa')
                ? this.pathCorners
                : this.quad
            : buffer;
        if (this.backend === 'webgpu') {
          const slot = vao.getBufferSlot(binding.name);
          if (slot === null) throw new Error(`Missing vertex-buffer slot: ${binding.name}`);
          vao.setBuffer(slot, value);
        } else {
          const names = binding.attributes?.map((a) => a.attribute) ?? [binding.name];
          for (const name of names) {
            const attr = layout.attributes.find((a) => a.name === name);
            if (attr) vao.setBuffer(attr.location, value);
          }
        }
      }
      if (indices) vao.setIndexBuffer(indices);
      return vao;
    } catch (error) {
      vao.destroy();
      throw error;
    }
  }

  createMesh(geometry: GeometryBuffer): GpuMesh | null {
    if (!geometry.count || this.lost || this.disposed) return null;
    // luma Resource.props retains initialization data. Allocate by size then write
    // so cached GPU buffers do not retain a duplicate CPU vertex/index payload.
    const buffer = this.device.createBuffer({
      byteLength: geometry.vertices.byteLength,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    });
    let indices: Buffer | undefined;
    try {
      buffer.write(geometry.vertices);
      if (geometry.indices) {
        indices = this.device.createBuffer({
          byteLength: geometry.indices.byteLength,
          usage: Buffer.INDEX | Buffer.COPY_DST,
          indexType: 'uint32',
        });
        indices.write(geometry.indices);
      }
    } catch (error) {
      indices?.destroy();
      buffer.destroy();
      throw error;
    }
    const bytes = geometry.vertices.byteLength + (geometry.indices?.byteLength ?? 0);
    const mesh = { kind: geometry.kind, buffer, indices, count: geometry.count, bytes };
    this.meshes.add(mesh);
    this.stats.uploads++;
    this.stats.uploadedBytes += bytes;
    this.stats.liveBufferBytes += bytes;
    return mesh;
  }
  destroyMesh(mesh: GpuMesh): void {
    if (this.circleQueue?.length) this.flushCircles();
    if (!this.meshes.delete(mesh)) return;
    mesh.vertexArray?.destroy();
    mesh.circleVertexArray?.destroy();
    mesh.pathMsaaVertexArray?.destroy();
    for (const vao of mesh.rangeVertexArrays?.values() ?? []) vao.destroy();
    mesh.rangeVertexArrays?.clear();
    mesh.buffer.destroy();
    mesh.indices?.destroy();
    this.stats.liveBufferBytes -= mesh.bytes;
  }
  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const w = Math.max(1, Math.round(width * pixelRatio)),
      h = Math.max(1, Math.round(height * pixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h)
      this.device.canvasContext!.setDrawingBufferSize(w, h);
    if (
      this.backend === 'webgpu' &&
      (!this.msaaTexture || this.msaaTexture.width !== w || this.msaaTexture.height !== h)
    ) {
      this.msaaFramebuffer?.destroy();
      this.msaaTexture?.destroy();
      this.pointDepthTexture?.destroy();
      this.msaaTexture = this.device.createTexture({
        width: w,
        height: h,
        format: this.device.preferredColorFormat,
        samples: 4,
        usage: Texture.RENDER_ATTACHMENT,
      });
      this.pointDepthTexture = this.device.createTexture({
        width: w,
        height: h,
        format: 'depth24plus',
        samples: 4,
        usage: Texture.RENDER_ATTACHMENT,
      });
      this.msaaFramebuffer = this.device.createFramebuffer({
        width: w,
        height: h,
        colorAttachments: [this.msaaTexture],
        depthStencilAttachment: this.pointDepthTexture,
      });
    }
  }
  begin(transform: AffineTransform): boolean {
    if (this.disposed || this.lost || this.device.isLost) return false;
    this.end();
    this.pointGroup = null;
    this.pointDepthDirty = false;
    this.transform = transform.clone();
    this.frame++;
    this.stats.frames++;
    const [x, y] = transform.unproject(this.width / 2, this.height / 2),
      hx = Math.fround(x),
      hy = Math.fround(y);
    this.frameData.set([
      hx,
      hy,
      x - hx,
      y - hy,
      transform.mx,
      transform.my,
      this.width,
      this.height,
    ]);
    this.frameData[46] = this.pixelRatio;
    this.frameData.set([transform.mx, transform.my], 48);
    this.frameData.set(cameraUniforms(transform), 52);
    this.frameData.set([0, 0, 1, 1], 56);
    const canvasFramebuffer = this.device.canvasContext!.getCurrentFramebuffer();
    if (this.backend === 'webgpu' && !this.msaaFramebuffer)
      this.resize(this.width, this.height, this.pixelRatio);
    this.timedFrame = this.timing && !this.queryBusy && Boolean(this.query);
    this.pass = this.device.beginRenderPass({
      framebuffer: this.msaaFramebuffer ?? canvasFramebuffer,
      ...(this.msaaFramebuffer ? { resolveTargets: [canvasFramebuffer.colorAttachments[0]] } : {}),
      clearColor: [0, 0, 0, 0],
      clearDepth: 1,
      clearStencil: false,
      ...(this.timedFrame
        ? { timestampQuerySet: this.query!, beginTimestampIndex: 0, endTimestampIndex: 1 }
        : {}),
      parameters: {
        viewport: [0, 0, this.canvas.width, this.canvas.height],
        scissorRect: [0, 0, this.canvas.width, this.canvas.height],
      },
    });
    this.fullScissor = true;
    return true;
  }

  private style(
    kind: PipelineKind,
    paint: MeshPaint,
    rect?: number[],
    identity = '',
    uv?: number[],
  ) {
    const key = kind + ':' + JSON.stringify(paint) + ':' + identity;
    let entry = this.styles.get(key);
    if (!entry) {
      const buffer = this.device.createBuffer({
        byteLength: 240,
        usage: Buffer.UNIFORM | Buffer.COPY_DST,
      });
      entry = {
        buffer,
        values: new Float32Array(60),
        frame: -1,
        bindings: { emapUniforms: buffer },
        images: new Map(),
      };
      this.styles.set(key, entry);
    }
    if (entry.frame !== this.frame) {
      const v = entry.values;
      v.set(this.frameData);
      if (paint.screenSpace) {
        v.set([this.width / 2, this.height / 2, 0, 0, 1, 1], 0);
        v.set([1, 1], 48);
        v.set([1, 0, 1, 0], 52);
      }
      v.set(paint.color, 8);
      v.set([1, 0, 0, 1], 12);
      v.fill(0, 20, 44);
      if (kind === 'point' || kind === 'circle') {
        v.set(
          [
            paint.radius ?? 4,
            paint.width ?? 1,
            (paint.marker?.length ?? 0) / 2,
            paint.filled === false ? 0 : 1,
          ],
          12,
        );
        if (paint.marker) v.set(paint.marker.slice(0, 24), 20);
      } else if (kind.startsWith('path-msaa')) {
        v[12] = paint.width ?? 1;
      } else if (kind === 'line' || kind === 'path') {
        if (kind === 'path' && paint.arrow)
          throw new Error('Arrow paint requires the segment pipeline.');
        const dash = this.dashTexture(paint.dash ?? []);
        entry.bindings.dashTexture = dash.texture;
        v.set([paint.width ?? 1, dash.period, dash.count, paint.arrow ? 1 : 0], 12);
        v.set([paint.arrow?.spacing ?? 32, paint.arrow?.size ?? 6], 44);
      } else if (kind === 'image') {
        v[12] = paint.color[3];
        if (rect) v.set(rect, 16);
        if (uv) v.set(uv, 56);
      }
      entry.buffer.write(v);
      entry.frame = this.frame;
      this.stats.uniformWrites++;
    }
    return entry;
  }
  drawMesh(mesh: GpuMesh, paint: MeshPaint, ranges?: readonly PathDrawRange[] | null): void {
    if (ranges && mesh.kind !== 'path') throw new Error('Instance ranges require a path mesh.');
    if (ranges?.length === 0) return;
    if (!this.pass || !this.meshes.has(mesh) || paint.color[3] <= 0) return;
    const circle = mesh.kind === 'point' && isFilledCircle(paint);
    if (!this.fullScissor) {
      this.pass.setParameters({ scissorRect: [0, 0, this.canvas.width, this.canvas.height] });
      this.fullScissor = true;
    }
    if ((mesh.kind === 'path' || mesh.kind === 'line') && (paint.width ?? 1) <= 0) return;
    const fastPath = mesh.kind === 'path' && useMsaaPath(paint, this.pathMode, this.pathSamples);
    const kind: PipelineKind = fastPath
      ? this.pathMode === 'reference'
        ? 'path-msaa-reference'
        : 'path-msaa'
      : circle
        ? 'circle'
        : mesh.kind;
    const vao = fastPath
      ? (mesh.pathMsaaVertexArray ??= this.vertexArray('path-msaa', mesh.buffer, this.pathIndices))
      : circle
        ? (mesh.circleVertexArray ??= this.vertexArray('circle', mesh.buffer))
        : (mesh.vertexArray ??= this.vertexArray(kind, mesh.buffer, mesh.indices));
    const style = this.style(kind, paint);
    const options = fastPath
      ? { indexCount: 12, vertexCount: 6, instanceCount: mesh.count, isInstanced: true }
      : mesh.kind === 'fill'
        ? { indexCount: mesh.count, vertexCount: mesh.count }
        : { vertexCount: circle ? 4 : 6, instanceCount: mesh.count, isInstanced: true };
    // A whole consecutive color run is classified before drawing its fringes,
    // including overlap across spatial chunks. Source-over order across different
    // colors, partial opacities, symbols and non-point layers is never changed.
    const group = circle
      ? opaqueCircleGroup(paint, this.circleOptimizationEnabled, this.pixelRatio)
      : null;
    if (group !== null) {
      if (this.circleQueue.length && this.queuedCircleGroup !== group) this.flushCircles();
      this.queuedCircleGroup = group;
      this.circleQueue.push({ mesh, vao, bindings: style.bindings });
    } else {
      this.flushCircles();
      if (kind === 'path-msaa') {
        const group = opaquePathGroup(paint);
        if (this.pointDepthDirty && this.pointGroup !== group) this.resetPointDepth();
        this.pointGroup = group;
        this.pointDepthDirty = true;
      } else this.pointGroup = null;
      this.pass.setPipeline(this.pipelines.get(kind)!.pipeline);
      this.pass.setBindings(style.bindings, { _bindGroupCacheKeys: { 0: style.bindings } });
      const draws = ranges ?? [{ firstInstance: 0, count: mesh.count }];
      for (const range of draws) {
        if (
          !Number.isSafeInteger(range.firstInstance) ||
          !Number.isSafeInteger(range.count) ||
          range.firstInstance < 0 ||
          range.count < 0 ||
          range.firstInstance + range.count > mesh.count
        )
          throw new Error('Invalid path instance range');
        let rangeVao = vao;
        if (this.backend === 'webgl' && range.firstInstance) {
          const key = `${fastPath ? 'path-msaa' : kind}:${range.firstInstance}`;
          mesh.rangeVertexArrays ??= new Map();
          const previous = mesh.rangeVertexArrays.get(key);
          if (previous) {
            mesh.rangeVertexArrays.delete(key);
            rangeVao = previous;
          } else
            rangeVao = this.vertexArray(
              fastPath ? 'path-msaa' : kind,
              mesh.buffer,
              fastPath ? this.pathIndices : mesh.indices,
              range.firstInstance,
            );
          mesh.rangeVertexArrays.set(key, rangeVao);
          if (mesh.rangeVertexArrays.size > 32) {
            const oldest = mesh.rangeVertexArrays.keys().next().value!;
            mesh.rangeVertexArrays.get(oldest)!.destroy();
            mesh.rangeVertexArrays.delete(oldest);
          }
        }
        this.pass.setVertexArray(rangeVao);
        const rangeOptions = ranges
          ? {
              ...options,
              instanceCount: range.count,
              firstInstance: this.backend === 'webgpu' ? range.firstInstance : 0,
            }
          : options;
        if (this.pass.draw(rangeOptions)) {
          this.stats.drawCalls++;
          if (fastPath) this.stats.pathMsaaDraws++;
        }
      }
    }
  }
  private flushCircles(): void {
    const pass = this.pass;
    if (!pass || !this.circleQueue.length) return;
    if (this.pointGroup !== this.queuedCircleGroup && this.pointDepthDirty) this.resetPointDepth();
    for (const kind of ['circle-core', 'circle-edge'] as const) {
      // Each circle instance is retained in BOTH passes, not deduplicated.
      for (const { mesh, vao, bindings } of this.circleQueue) {
        pass.setPipeline(this.pipelines.get(kind)!.pipeline);
        pass.setBindings(bindings, { _bindGroupCacheKeys: { 0: bindings } });
        pass.setVertexArray(vao);
        if (pass.draw({ vertexCount: 4, instanceCount: mesh.count, isInstanced: true })) {
          this.stats.drawCalls++;
          if (kind === 'circle-core') this.stats.circleCoreDraws++;
          else this.stats.circleEdgeDraws++;
        }
      }
    }
    this.pointDepthDirty = true;
    this.pointGroup = this.queuedCircleGroup;
    this.circleQueue.length = 0;
    this.queuedCircleGroup = null;
  }
  /** Reset private coverage depth without ending the pass or touching its color.
   * Depth=1 and greater-equal passes for every stored depth in [0,1]. Unlike
   * "always", this keeps depth testing enabled in luma v10's WebGL converter,
   * which is necessary for writes to actually reach the depth buffer.
   */
  private resetPointDepth(): void {
    const pass = this.pass!;
    this.pointDepthVertexArray ??= this.vertexArray('point-depth-reset', this.quad);
    pass.setPipeline(this.pipelines.get('point-depth-reset')!.pipeline);
    // The binding is inert in this shader but explicit layouts remain portable.
    const style = this.style('point-depth-reset', { color: [0, 0, 0, 0] });
    pass.setBindings(style.bindings);
    pass.setVertexArray(this.pointDepthVertexArray);
    // v10 WebGL treats colorMask as render-pass state; WebGPU bakes it into
    // the reset pipeline. Set/restore explicitly so resetting coverage cannot
    // erase colors drawn by earlier point groups, vectors or raster layers.
    if (this.backend === 'webgl') pass.setParameters({ colorMask: 0 });
    try {
      if (pass.draw({ vertexCount: 6, instanceCount: 1 })) {
        this.stats.drawCalls++;
        this.stats.pointDepthResets++;
      }
    } finally {
      if (this.backend === 'webgl') pass.setParameters({ colorMask: 0xf });
    }
  }
  enableTiming(enabled: boolean): void {
    this.timing = enabled;
    this.timingEpoch++;
    this.gpuTimings.length = 0;
    if (enabled && this.timestampSupported && !this.query)
      this.query = this.device.createQuerySet({ type: 'timestamp', count: 2 });
  }
  /** Completion barrier for snapshot publication/diagnostics, never called per pointermove.
   * WebGL polls a fence asynchronously; gl.finish/readPixels must not stall input handling.
   */
  async waitForIdle(): Promise<void> {
    if (this.disposed || this.lost) return;
    const device = this.device;
    if (this.backend === 'webgpu') {
      await (device as import('@luma.gl/webgpu').WebGPUDevice).handle.queue.onSubmittedWorkDone();
      return;
    }
    const gl = (device as WebGLDevice).gl;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('Unable to create GPU completion fence.');
    const deadline = performance.now() + 30000;
    gl.flush();
    try {
      while (!this.disposed && !this.lost && device === this.device) {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
        if (status === gl.WAIT_FAILED || performance.now() > deadline)
          throw new Error('GPU completion fence failed or timed out.');
        await new Promise<void>((resolve) => setTimeout(resolve, 4));
      }
    } finally {
      gl.deleteSync(fence);
    }
  }
  private dashTexture(input: readonly number[]) {
    const values = input.filter((v) => Number.isFinite(v) && v >= 0);
    if (values.length % 2) values.push(...values);
    const key = values.join(',');
    let entry = this.dashes.get(key);
    if (!entry) {
      let period = 0;
      const boundaries = Float32Array.from(values, (v) => (period += v));
      if (boundaries.length > this.device.limits.maxTextureDimension2D)
        throw new Error('Dash pattern exceeds GPU texture width');
      const texture = this.device.createTexture({
        width: Math.max(1, boundaries.length),
        height: 1,
        format: 'r32float',
        sampler: this.nearest,
      });
      texture.writeData(boundaries.length ? boundaries : new Float32Array([0]));
      entry = { texture, period, count: boundaries.length, frame: this.frame };
      this.dashes.set(key, entry);
    }
    entry.frame = this.frame;
    return entry;
  }
  drawImage(
    image: CanvasImageSource,
    bounds: Rect,
    opacity = 1,
    smoothing = true,
    clip?: Rect,
    immutable = false,
  ): void {
    if (!this.pass || !Number.isFinite(opacity) || opacity <= 0) return;
    const flat = perspectiveActive(this.transform) ? this.transform.flat : this.transform;
    const pr = this.pixelRatio;
    let rect: number[], scissor: number[], uv: number[] | undefined;
    if (perspectiveActive(this.transform)) {
      // Crop in source Float64 before upload. Homogeneous clipping preserves
      // the projected quadrilateral and perspective-correct texture coordinates.
      const footprint = groundBounds(this.transform, this.width, this.height);
      const crop = [
        Math.max(bounds[0], footprint[0], clip?.[0] ?? -Infinity),
        Math.max(bounds[1], footprint[1], clip?.[1] ?? -Infinity),
        Math.min(bounds[2], footprint[2], clip?.[2] ?? Infinity),
        Math.min(bounds[3], footprint[3], clip?.[3] ?? Infinity),
      ];
      if (crop[0] >= crop[2] || crop[1] >= crop[3]) return;
      const a = flat.project(crop[0], crop[3]),
        b = flat.project(crop[2], crop[1]);
      rect = [...a, ...b].map((v) => v * pr);
      uv = [
        (crop[0] - bounds[0]) / (bounds[2] - bounds[0]),
        (bounds[3] - crop[3]) / (bounds[3] - bounds[1]),
        (crop[2] - bounds[0]) / (bounds[2] - bounds[0]),
        (bounds[3] - crop[1]) / (bounds[3] - bounds[1]),
      ];
      scissor = [0, 0, this.canvas.width, this.canvas.height];
    } else {
      const a = flat.project(bounds[0], bounds[3]),
        b = flat.project(bounds[2], bounds[1]);
      rect = [...a, ...b].map((v) => Math.round(v * pr));
      scissor = [...rect];
      if (clip) {
        const a = flat.project(clip[0], clip[3]),
          b = flat.project(clip[2], clip[1]);
        scissor[0] = Math.max(scissor[0], Math.round(a[0] * pr));
        scissor[1] = Math.max(scissor[1], Math.round(a[1] * pr));
        scissor[2] = Math.min(scissor[2], Math.round(b[0] * pr));
        scissor[3] = Math.min(scissor[3], Math.round(b[1] * pr));
      }
      scissor[0] = Math.max(0, scissor[0]);
      scissor[1] = Math.max(0, scissor[1]);
      scissor[2] = Math.min(this.canvas.width, scissor[2]);
      scissor[3] = Math.min(this.canvas.height, scissor[3]);
    }
    if (
      ![...rect, ...scissor].every(Number.isFinite) ||
      rect[2] <= rect[0] ||
      rect[3] <= rect[1] ||
      scissor[2] <= scissor[0] ||
      scissor[3] <= scissor[1]
    )
      return;
    this.flushCircles();
    this.pointGroup = null;
    const entry = this.imageTexture(image, immutable);
    if (entry.smoothing !== smoothing) {
      entry.texture.setSampler(smoothing ? this.linear : this.nearest);
      entry.smoothing = smoothing;
    }
    this.pass.setParameters({
      scissorRect: [
        scissor[0],
        // WebGPU uses a top-left origin; WebGL scissor coordinates are bottom-left.
        this.backend === 'webgpu' ? scissor[1] : this.canvas.height - scissor[3],
        scissor[2] - scissor[0],
        scissor[3] - scissor[1],
      ],
    });
    this.fullScissor = false;
    const style = this.style(
      'image',
      { color: [1, 1, 1, Math.min(1, opacity)] },
      rect.map((v) => v / pr),
      bounds.join(',') + ':' + (clip?.join(',') ?? ''),
      uv,
    );
    let bindings = style.images.get(entry.texture);
    const sampler = smoothing ? this.linear : this.nearest;
    if (!bindings || bindings.imageSampler !== sampler) {
      bindings = {
        emapUniforms: style.buffer,
        imageTexture: entry.texture,
        ...(this.backend === 'webgpu' ? { imageSampler: sampler } : {}),
      };
      style.images.set(entry.texture, bindings);
    }
    this.imageVertexArray ??= this.vertexArray('image', this.quad);
    this.pass.setPipeline(this.pipelines.get('image')!.pipeline);
    this.pass.setBindings(bindings, { _bindGroupCacheKeys: { 0: bindings } });
    this.pass.setVertexArray(this.imageVertexArray);
    if (this.pass.draw({ vertexCount: 6 })) this.stats.drawCalls++;
  }

  private imageTexture(image: CanvasImageSource, immutable: boolean): ImageEntry {
    const source = image as {
      width?: number;
      height?: number;
      videoWidth?: number;
      videoHeight?: number;
      displayWidth?: number;
      displayHeight?: number;
    };
    const width = source.videoWidth ?? source.displayWidth ?? source.width ?? 0;
    const height = source.videoHeight ?? source.displayHeight ?? source.height ?? 0;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
      throw new Error('Raster image has invalid dimensions');
    let entry = this.images.get(image);
    if (entry && (entry.texture.width !== width || entry.texture.height !== height)) {
      this.destroyImage(entry);
      this.images.delete(image);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        texture: this.device.createTexture({
          width,
          height,
          format: 'rgba8unorm',
          sampler: this.linear,
        }),
        frame: -1,
        immutable,
        smoothing: true,
      };
      this.images.set(image, entry);
      this.stats.liveTextureBytes += width * height * 4;
      this.stats.liveTextures++;
    }
    if (entry.frame < 0 || (!immutable && entry.frame !== this.frame)) {
      entry.texture.copyExternalImage({
        image: image as Parameters<Texture['copyExternalImage']>[0]['image'],
        width,
        height,
        premultipliedAlpha: false,
        flipY: false,
      });
      this.stats.textureUploads++;
    }
    // Refresh insertion order so over-budget eviction is oldest-used first.
    this.images.delete(image);
    this.images.set(image, entry);
    entry.frame = this.frame;
    entry.immutable = immutable;
    return entry;
  }
  end(): void {
    if (!this.pass) return;
    this.flushCircles();
    this.pass.end();
    this.pass = null;
    this.device.submit();
    if (this.timedFrame && this.query) {
      const epoch = this.timingEpoch;
      this.timedFrame = false;
      this.queryBusy = true;
      void this.query
        .readTimestampDuration(0, 1)
        .then((ms) => {
          if (!this.disposed && epoch === this.timingEpoch && Number.isFinite(ms) && ms >= 0)
            this.gpuTimings.push(ms);
        })
        .catch(() => {
          /* Unavailable/disjoint queries are not reported as zero GPU time. */
        })
        .finally(() => {
          this.queryBusy = false;
        });
    }
    for (const [image, entry] of this.images)
      if (
        entry.frame !== this.frame &&
        (!entry.immutable || this.stats.liveTextureBytes > IMMUTABLE_IMAGE_CACHE_BYTES)
      ) {
        this.destroyImage(entry);
        this.images.delete(image);
      }
  }

  /** Release a completed editor backdrop without retaining its bitmap or texture. */
  forgetImage(image: CanvasImageSource): void {
    const entry = this.images.get(image);
    if (!entry) return;
    this.images.delete(image);
    this.destroyImage(entry);
    for (const [key, style] of this.styles) {
      if (style.images.delete(entry.texture) && key.startsWith('image:') && !style.images.size) {
        style.buffer.destroy();
        this.styles.delete(key);
      }
    }
  }

  /** Drop source-owned images when the dataset changes, not on every pan. */
  clearImages(): void {
    for (const entry of this.images.values()) this.destroyImage(entry);
    this.images.clear();
    for (const style of this.styles.values()) style.images.clear();
  }
  private destroyImage(entry: ImageEntry): void {
    entry.texture.destroy();
    this.stats.liveTextureBytes -= entry.texture.width * entry.texture.height * 4;
    this.stats.liveTextures--;
  }
  private release(): void {
    this.circleQueue.length = 0;
    this.queuedCircleGroup = null;
    this.pass?.end();
    this.pass = null;
    for (const mesh of this.meshes) this.destroyMesh(mesh);
    for (const entry of this.images.values()) this.destroyImage(entry);
    for (const entry of this.dashes.values()) entry.texture.destroy();
    this.images.clear();
    this.dashes.clear();
    for (const entry of this.pipelines.values()) {
      entry.pipeline.destroy();
      for (const shader of entry.shaders) shader.destroy();
    }
    this.pipelines.clear();
    for (const style of this.styles.values()) style.buffer.destroy();
    this.styles.clear();
    this.imageVertexArray?.destroy();
    this.imageVertexArray = null;
    this.msaaFramebuffer?.destroy();
    this.msaaFramebuffer = null;
    this.msaaTexture?.destroy();
    this.msaaTexture = null;
    this.pointDepthTexture?.destroy();
    this.pointDepthTexture = null;
    this.pointDepthVertexArray?.destroy();
    this.pointDepthVertexArray = null;
    this.pointGroup = null;
    this.pointDepthDirty = false;
    this.query?.destroy();
    this.query = null;
    this.pathCorners?.destroy();
    this.pathIndices?.destroy();
    this.quad?.destroy();
    this.circleQuad?.destroy();
    this.nearest?.destroy();
    this.linear?.destroy();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.release();
    const context = this.backend === 'webgl' ? (this.device as WebGLDevice).gl : null;
    this.device.destroy();
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
