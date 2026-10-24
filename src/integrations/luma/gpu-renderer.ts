import { MeshCommandCache, type MeshDraw, type MeshCommandPlan } from './mesh-command-cache';
import { WebgpuMeshRecorder } from './webgpu-mesh-bundle';
import {
  GeometryBufferPages,
  pageEligible,
  pagePayloadBytes,
  PAGE_SLACK_RESERVE,
  type GeometrySlice,
} from './buffer-pages';
import type { PointIcon } from '../../engine/rendering/icons/images';
import { MsdfTextRenderer } from './msdf-text-renderer';
import { GpuTextRenderer } from './text-renderer';
import type { LabelFrame } from '../../engine/rendering/labels/manager';
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
import type { GeometryBuffer, MeshPaint, Rect, PathDrawRange, FillDrawRange } from './types';

export interface GpuMesh {
  kind: GeometryBuffer['kind'];
  buffer: Buffer;
  indices?: Buffer;
  indexBytes?: 2 | 4;
  compactStroke?: boolean;
  compactStrokeXY?: boolean;
  solidPath?: GeometryBuffer['solidPath'];
  pageSlice?: GeometrySlice;
  firstInstance?: number;
  firstIndex?: number;
  logicalCount?: number;
  count: number;
  bytes: number;
  vertexArray?: VertexArray;
  circleVertexArray?: VertexArray;
  iconVertexArray?: VertexArray;
  pathMsaaVertexArray?: VertexArray;
  rangeVertexArrays?: Map<string, VertexArray>;
}
interface GpuStyle {
  buffer: Buffer;
  values: Float32Array;
  frame: number;
  bindings: Bindings;
  images: Map<Texture, Bindings>;
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
/** Attempt every independent release before propagating cleanup failures. */
function cleanupGpu(actions: Iterable<() => void>): void {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'GPU resource cleanup failed');
}
/** Device.destroy() does not release its canvas observers/attachments in luma v10. */
function destroyDevice(device: Device): void {
  cleanupGpu([() => device.canvasContext?.destroy(), () => device.destroy()]);
}
/**
 * Portable luma v10 renderer shared by formal WebGL2/WebGPU maps and A/B examples.
 * Owns the selected device and all GPU resources, including shared geometry pages.
 */
export class GpuRenderer {
  private device!: Device;
  private pipelines = new Map<PipelineKind, { pipeline: RenderPipeline; shaders: Shader[] }>();
  private styles = new Map<string, GpuStyle>();
  private meshScopeStyles?: Map<PipelineKind, GpuStyle>;
  private textRenderer: GpuTextRenderer | null = null;
  private msdfTextRenderer: MsdfTextRenderer | null = null;
  private labelRunsKey?: string;
  private labelRuns: { start: number; end: number; msdf: boolean }[] = [];
  get textStats() {
    if (this.msdfTextRenderer && this.textRenderer) {
      const stats = { ...this.msdfTextRenderer.stats };
      for (const name of [
        'drawCalls',
        'bufferUploads',
        'bufferAllocations',
        'reusedBatches',
        'stagingBytes',
        'textureUploads',
        'liveTextureBytes',
        'liveBufferBytes',
      ] as const)
        stats[name] += this.textRenderer.stats[name];
      return stats;
    }
    return (
      this.msdfTextRenderer?.stats ??
      this.textRenderer?.stats ?? {
        drawCalls: 0,
        bufferUploads: 0,
        textureUploads: 0,
        liveTextureBytes: 0,
        liveBufferBytes: 0,
      }
    );
  }
  drawLabels(frame: LabelFrame): void {
    if (!this.pass) return;
    if (!frame.labels.length) return; // A pending layout hides text without re-uploading its atlas on pan.
    this.flushCircles();
    this.pointGroup = null;
    this.pass.setParameters({ scissorRect: [0, 0, this.canvas.width, this.canvas.height] });
    this.fullScissor = true;
    if (this.labelRunsKey !== frame.key) {
      this.labelRuns = [];
      for (let i = 0; i < frame.labels.length; i++) {
        const msdf = 'mode' in frame.labels[i].raster,
          last = this.labelRuns.at(-1);
        if (last?.msdf === msdf) last.end = i + 1;
        else this.labelRuns.push({ start: i, end: i + 1, msdf });
      }
      this.labelRunsKey = frame.key;
    }
    // Prepare each renderer from the whole frame once, then draw contiguous
    // runs in source order. Mixed text never uploads the same frame per run.
    for (const { start, end, msdf } of this.labelRuns) {
      if (msdf) {
        this.msdfTextRenderer ??= new MsdfTextRenderer(this.device, this.backend);
        const calls = this.msdfTextRenderer.stats.drawCalls;
        this.msdfTextRenderer.draw(
          this.pass,
          frame,
          this.width,
          this.height,
          this.pixelRatio,
          start,
          end,
        );
        this.stats.drawCalls += this.msdfTextRenderer.stats.drawCalls - calls;
      } else {
        this.textRenderer ??= new GpuTextRenderer(this.device, this.backend);
        const calls = this.textRenderer.stats.drawCalls;
        this.textRenderer.draw(this.pass, frame, this.width, this.height, start, end);
        this.stats.drawCalls += this.textRenderer.stats.drawCalls - calls;
      }
    }
  }
  clearLabels(): void {
    this.labelRunsKey = undefined;
    this.labelRuns = [];
    this.textRenderer?.clear();
    this.msdfTextRenderer?.clear();
  }
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
  /** Diagnostic comparison seam; formal affine geometry requests include this mode. */
  compactStrokesEnabled = true;
  meshPagesEnabled = true;
  private pages?: GeometryBufferPages;
  /** Internal comparison seams; no backend or quality fallback is involved. */
  commandPlansEnabled = true;
  renderBundlesEnabled = true;
  /** Reorder only a uniform opaque MSAA stroke scope, never source-over paints. */
  strokeBatchingEnabled = true;
  fillBatchingEnabled = true;
  private commandCache?: MeshCommandCache;
  private recordingKinds?: Set<PipelineKind>;
  private bundleCounters = { recordings: 0, replays: 0, drawsReplayed: 0, recordingMs: 0 };
  get commandStats() {
    return {
      ...this.bundleCounters,
      ...(this.commandCache?.stats ?? { entries: 0, commands: 0, hits: 0, builds: 0 }),
    };
  }
  get pageReservationBytes(): number {
    return this.meshPagesEnabled ? PAGE_SLACK_RESERVE : 0;
  }
  get pageSlackBytes(): number {
    return this.pages?.slackBytes ?? 0;
  }
  get pageStats() {
    return {
      pages: this.pages?.size ?? 0,
      allocatedBytes: this.pages?.allocatedBytes ?? 0,
      liveBytes: this.pages?.liveBytes ?? 0,
      slackBytes: this.pageSlackBytes,
    };
  }
  meshByteSize(g: GeometryBuffer): number {
    return this.meshPagesEnabled && pageEligible(g)
      ? pagePayloadBytes(g)
      : g.vertices.byteLength + Math.ceil((g.indices?.byteLength ?? 0) / 4) * 4;
  }
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
    return `luma.gl 10.0.0-alpha.4 / ${this.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}`;
  }
  /** Known payloads only: excludes swapchain/driver allocations and CPU caches.
   * Shared geometry pages are counted once, including slack. Attachment bytes
   * use four bytes per depth24plus sample as a nominal estimate, not measured VRAM. */
  get memoryStats() {
    const geometryBufferBytes = this.stats.liveBufferBytes ?? 0;
    const styleUniformBytes = (this.styles?.size ?? 0) * 240;
    const dashTextureBytes = [...(this.dashes?.values() ?? [])].reduce(
      (n, e) => n + e.texture.width * 4,
      0,
    );
    const sharedBufferBytes = this.disposed
      ? 0
      : [this.quad, this.circleQuad, this.pathCorners, this.pathIndices].reduce(
          (n, b) => n + (b?.byteLength ?? 0),
          0,
        );
    const text = [this.textRenderer, this.msdfTextRenderer].map((r) => r?.memoryStats);
    const textBufferBytes = text.reduce((n, s) => n + (s?.bufferBytes ?? 0), 0);
    const textTextureBytes = text.reduce((n, s) => n + (s?.textureBytes ?? 0), 0);
    const attachmentNominalBytes = [this.msaaTexture, this.pointDepthTexture].reduce(
      (n, t) => n + (t ? t.width * t.height * t.samples * 4 : 0),
      0,
    );
    const imageTextureBytes = this.stats.liveTextureBytes ?? 0;
    return {
      geometryBufferBytes,
      styleUniformBytes,
      dashTextureBytes,
      sharedBufferBytes,
      textBufferBytes,
      textTextureBytes,
      attachmentNominalBytes,
      imageTextureBytes,
      styles: this.styles?.size ?? 0,
      dashTextures: this.dashes?.size ?? 0,
      pipelines: this.pipelines?.size ?? 0,
      nominalKnownGpuBytes:
        geometryBufferBytes +
        styleUniformBytes +
        dashTextureBytes +
        sharedBufferBytes +
        textBufferBytes +
        textTextureBytes +
        attachmentNominalBytes +
        imageTextureBytes,
    };
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
    const device =
      backend === 'webgpu' ? await this.requestWebgpuDevice(canvas, report) : undefined;
    canvas.dataset.gpuStage = 'creating-pipelines';
    const renderer = new GpuRenderer(canvas, invalidate, report, device);
    canvas.dataset.gpuStage = 'compiling-shaders';
    try {
      await renderer.checkShaders();
      if (renderer.device.isLost) throw new Error('GPU device lost during initialization.');
      renderer.watchDeviceLoss();
      canvas.dataset.gpuStage = 'ready';
      return renderer;
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }
  private static async requestWebgpuDevice(
    canvas: HTMLCanvasElement,
    report: (error: Error) => void,
  ): Promise<Device> {
    canvas.dataset.gpuStage = 'loading-adapter';
    const { webgpuAdapter } = await import('@luma.gl/webgpu');
    canvas.dataset.gpuStage = 'requesting-device';
    if (!webgpuAdapter.isSupported())
      throw new Error(
        'WebGPU is unavailable on this browser / secure context. Select WebGL2 explicitly.',
      );
    return webgpuAdapter.create({
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
  private async checkShaders(): Promise<void> {
    // Request all compiler logs together, then flush the device command stream.
    // Serial getCompilationInfo awaits can stall until another native GPU operation
    // while the page module is still awaiting initialization (observed in Chrome 153).
    const checks = [...this.pipelines.values()].flatMap((entry) =>
      entry.shaders.map((shader) => shader.getCompilationInfo()),
    );
    if (this.backend === 'webgpu') this.device.submit();
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
  }
  private watchDeviceLoss(): void {
    if (this.backend !== 'webgpu') return;
    const owned = this.device;
    void owned.lost.then(() => {
      if (!this.disposed && !this.lost && this.device === owned) void this.recoverWebgpu();
    });
  }
  private async recoverWebgpu(): Promise<void> {
    this.lost = true;
    this.canvas.dataset.gpuStage = 'recovering';
    try {
      cleanupGpu([() => this.release(), () => destroyDevice(this.device)]);
      const device = await GpuRenderer.requestWebgpuDevice(this.canvas, this.report);
      if (this.disposed) {
        destroyDevice(device);
        return;
      }
      this.initialize(device);
      await this.checkShaders();
      if (this.disposed) return;
      if (device.isLost) throw new Error('Replacement WebGPU device was lost during recovery.');
      this.resize(this.width, this.height, this.pixelRatio);
      this.watchDeviceLoss();
      this.lost = false;
      this.canvas.dataset.gpuStage = 'ready';
      this.invalidate();
    } catch (error) {
      if (this.disposed) return;
      this.lost = true;
      this.canvas.dataset.gpuStage = 'recovery-failed';
      try {
        cleanupGpu([() => this.release(), () => destroyDevice(this.device)]);
      } catch (cleanupError) {
        error = new AggregateError([error, cleanupError], 'WebGPU recovery cleanup failed');
      }
      this.report(error instanceof Error ? error : new Error(String(error)));
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
  private images = new Map<CanvasImageSource | ImageData, ImageEntry>();
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
    pixelTextureUploads: 0,
    pixelTextureUploadedBytes: 0,
    liveTextureBytes: 0,
    liveTextures: 0,
    uniformWrites: 0,
    frames: 0,
    pathMsaaDraws: 0,
    pathFrameCandidates: 0,
    pathFrameSubmitted: 0,
    circleCoreDraws: 0,
    circleEdgeDraws: 0,
    pointDepthResets: 0,
    iconDrawCalls: 0,
    iconFrameInstances: 0,
    fillFrameCandidates: 0,
    fillFrameSubmitted: 0,
    fillFramePaddingTriangles: 0,
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
      try {
        cleanupGpu([
          () => this.release(),
          () => {
            if (this.device) destroyDevice(this.device);
          },
        ]);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'GPU initialization and cleanup failed');
      }
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
    // Lost-context deletes are no-ops. After restoration WebKit rejects the old handles.
    try {
      cleanupGpu([() => this.release(), () => destroyDevice(this.device)]);
    } catch (error) {
      this.report(error instanceof Error ? error : new Error(String(error)));
    }
    this.report(
      new Error('WebGL context lost; emap will rebuild GPU resources after restoration.'),
    );
  };
  private onRestored = (): void => {
    if (this.disposed || !this.lost) return;
    try {
      this.initialize();
      this.resize(this.width, this.height, this.pixelRatio);
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
        // Reattach the restored handle without accumulating native context listeners.
        _handle: (this.device as WebGLDevice | undefined)?.gl,
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
        : ((this.device as WebGLDevice).gl.getParameter(
            (this.device as WebGLDevice).gl.SAMPLES,
          ) as number);
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
      'path-msaa-solid',
      'path-msaa-solid-xy',
      'path-msaa-compact',
      'path-msaa-compact-xy',
      'image',
      'icon',
    ] as const) {
      this.pipelineEntry(kind);
    }
  }
  /** Production variants are warmed during initialization; diagnostic variants
   * are compiled only when requested, keeping their exact reference shaders. */
  private pipelineEntry(kind: PipelineKind): { pipeline: RenderPipeline; shaders: Shader[] } {
    const existing = this.pipelines.get(kind);
    if (existing) return existing;
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
    let fs = vs;
    try {
      if (this.backend !== 'webgpu')
        fs = this.device.createShader({
          id: `emap-${kind}-fragment`,
          language: 'glsl',
          stage: 'fragment',
          source: source.fs,
        });
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
          ...(kind.startsWith('path-msaa') && !kind.endsWith('-reference')
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
      const entry = { pipeline, shaders: fs === vs ? [vs] : [vs, fs] };
      this.pipelines.set(kind, entry);
      if (kind.endsWith('-reference')) {
        void Promise.all(entry.shaders.map((shader) => shader.getCompilationInfo()))
          .then((logs) => {
            const errors = logs.flat().filter((message) => message.type === 'error');
            if (!this.disposed && errors.length)
              this.report(new Error(errors.map((e) => e.message).join('\n')));
          })
          .catch((error) => {
            if (!this.disposed)
              this.report(error instanceof Error ? error : new Error(String(error)));
          });
      }
      return entry;
    } catch (error) {
      vs.destroy();
      if (fs !== vs) fs.destroy();
      throw error;
    }
  }
  private vertexArray(
    kind: PipelineKind,
    buffer: Buffer,
    indices?: Buffer,
    firstInstance = 0,
  ): VertexArray {
    const entry = this.pipelineEntry(kind);
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

  createMesh(geometry: GeometryBuffer, pageGroup?: string): GpuMesh | null {
    if (!geometry.count || this.lost || this.disposed) return null;
    if (pageGroup && this.meshPagesEnabled && pageEligible(geometry)) {
      this.pages ??= new GeometryBufferPages(this.device);
      const before = this.pages.allocatedBytes;
      const slice = this.pages.allocate(geometry, pageGroup);
      const mesh: GpuMesh = {
        kind: geometry.kind,
        compactStroke: geometry.compactStroke,
        compactStrokeXY: geometry.compactStrokeXY,
        solidPath: geometry.solidPath,
        buffer: slice.page.buffer,
        indices: slice.page.indices,
        indexBytes: 2,
        pageSlice: slice,
        firstInstance: slice.firstInstance,
        firstIndex: slice.firstIndex,
        count: geometry.count,
        bytes: slice.bytes,
      };
      this.meshes.add(mesh);
      this.stats.uploads++;
      this.stats.uploadedBytes += mesh.bytes;
      this.stats.liveBufferBytes += this.pages.allocatedBytes - before;
      return mesh;
    }
    // luma Resource.props retains initialization data. Allocate by size then write
    // so cached GPU buffers do not retain a duplicate CPU vertex/index payload.
    const buffer = this.device.createBuffer({
      byteLength: geometry.vertices.byteLength,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    });
    let indices: Buffer | undefined;
    const indexBytes = geometry.indices instanceof Uint16Array ? 2 : 4;
    const indexLength = Math.ceil((geometry.indices?.byteLength ?? 0) / 4) * 4;
    try {
      buffer.write(geometry.vertices);
      if (geometry.indices) {
        indices = this.device.createBuffer({
          byteLength: indexLength,
          usage: Buffer.INDEX | Buffer.COPY_DST,
          indexType: indexBytes === 2 ? 'uint16' : 'uint32',
        });
        // WebGPU writeBuffer requires a four-byte payload; padding is not drawn.
        if (geometry.indices.byteLength === indexLength) indices.write(geometry.indices);
        else {
          const padded = new Uint16Array(indexLength / 2);
          padded.set(geometry.indices);
          indices.write(padded);
        }
      }
    } catch (error) {
      indices?.destroy();
      buffer.destroy();
      throw error;
    }
    const bytes = geometry.vertices.byteLength + indexLength;
    const mesh: GpuMesh = {
      kind: geometry.kind,
      compactStroke: geometry.compactStroke,
      compactStrokeXY: geometry.compactStrokeXY,
      solidPath: geometry.solidPath,
      buffer,
      indices,
      indexBytes,
      count: geometry.count,
      bytes,
    };
    this.meshes.add(mesh);
    this.stats.uploads++;
    this.stats.uploadedBytes += bytes;
    this.stats.liveBufferBytes += bytes;
    return mesh;
  }
  destroyMesh(mesh: GpuMesh): void {
    if (!this.meshes.delete(mesh)) return;
    const vaos = new Set([
      mesh.vertexArray,
      mesh.circleVertexArray,
      mesh.iconVertexArray,
      mesh.pathMsaaVertexArray,
      ...(mesh.rangeVertexArrays?.values() ?? []),
    ]);
    const before = this.pages?.allocatedBytes ?? 0;
    try {
      cleanupGpu([
        () => {
          if (this.circleQueue?.length) this.flushCircles();
        },
        () => this.commandCache?.retire(mesh),
        ...[...vaos].map((vao) => () => vao?.destroy()),
        ...(mesh.pageSlice
          ? [() => this.pages!.release(mesh.pageSlice!)]
          : [() => mesh.buffer.destroy(), () => mesh.indices?.destroy()]),
      ]);
    } finally {
      mesh.rangeVertexArrays?.clear();
      this.stats.liveBufferBytes += mesh.pageSlice
        ? (this.pages?.allocatedBytes ?? 0) - before
        : -mesh.bytes;
    }
  }
  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    if (this.disposed || this.device.isLost) return;
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
    this.commandCache?.begin();
    this.pointGroup = null;
    this.pointDepthDirty = false;
    this.transform = transform.clone();
    this.frame++;
    this.stats.frames++;
    this.stats.iconFrameInstances = 0;
    this.stats.pathFrameCandidates = this.stats.pathFrameSubmitted = 0;
    this.stats.fillFrameCandidates =
      this.stats.fillFrameSubmitted =
      this.stats.fillFramePaddingTriangles =
        0;
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
    // Only ordered mesh scopes share one immutable paint. Immediate external
    // draws can mutate/reuse their paint object and must still revalidate it.
    const scoped = !rect && !uv && !identity ? this.meshScopeStyles : undefined;
    const ready = scoped?.get(kind);
    if (ready) return ready;
    const key = kind + ':' + JSON.stringify(paint) + ':' + identity;
    let entry = this.styles.get(key);
    if (!entry) {
      const buffer = this.device.createBuffer({
        id: `emap-${kind}-uniform-${this.frame}-${this.styles.size}`,
        byteLength: 240,
        usage: Buffer.UNIFORM | Buffer.COPY_DST,
      });
      entry = {
        buffer,
        values: new Float32Array(60),
        frame: -1,
        bindings: { emapUniforms: buffer },
        images: new Map<Texture, Bindings>(),
      };
      this.styles.set(key, entry);
    }
    if (entry.frame !== this.frame) {
      const v = entry.values;
      v.set(this.frameData);
      if (paint.screenSpace) {
        if (paint.screenView) {
          const old = new AffineTransform(...paint.screenView);
          const center = old.project(...this.transform.unproject(this.width / 2, this.height / 2));
          const hx = Math.fround(center[0]),
            hy = Math.fround(center[1]);
          const mx = this.transform.mx / old.mx,
            my = this.transform.my / old.my;
          v.set([hx, hy, center[0] - hx, center[1] - hy, mx, my], 0);
          v.set([mx, my], 48);
        } else {
          v.set([this.width / 2, this.height / 2, 0, 0, 1, 1], 0);
          v.set([1, 1], 48);
        }
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
      } else if (kind === 'icon' && paint.icon) {
        const icon = paint.icon;
        v.set([...icon.size, Math.cos(icon.angle), Math.sin(icon.angle)], 12);
        v.set([...icon.anchor, ...icon.offset], 16);
        v.set([1 / icon.textureSize[0], 1 / icon.textureSize[1]], 20);
        v[44] = icon.tint ? 1 : 0;
        if (uv) v.set(uv, 56);
      } else if (kind === 'image') {
        v[12] = paint.color[3];
        if (rect) v.set(rect, 16);
        if (uv) v.set(uv, 56);
      }
      entry.buffer.write(v);
      entry.frame = this.frame;
      this.stats.uniformWrites++;
    }
    scoped?.set(kind, entry);
    return entry;
  }
  /** Image symbols reuse the original point/LOD buffer, with no per-view point upload. */
  drawPointIcons(mesh: GpuMesh, icon: PointIcon): void {
    if (!this.pass || !this.meshes.has(mesh) || mesh.kind !== 'point' || icon.color[3] <= 0) return;
    this.flushCircles();
    this.pointGroup = null;
    this.pass.setParameters({ scissorRect: [0, 0, this.canvas.width, this.canvas.height] });
    this.fullScissor = true;
    const entry = this.imageTexture(icon.asset.image, true);
    if (!entry.smoothing) {
      entry.texture.setSampler(this.linear);
      entry.smoothing = true;
    }
    const [x, y, w, h] = icon.rect,
      iw = icon.asset.width,
      ih = icon.asset.height;
    const style = this.style(
      'icon',
      {
        color: icon.color,
        icon: {
          size: icon.size,
          anchor: icon.anchor,
          offset: icon.offset,
          angle: icon.angle,
          tint: !!icon.tint,
          textureSize: [iw, ih],
        },
      },
      undefined,
      icon.rect.join(','),
      [x / iw, y / ih, (x + w) / iw, (y + h) / ih],
    );
    let bindings = style.images.get(entry.texture);
    if (!bindings) {
      bindings = {
        emapUniforms: style.buffer,
        imageTexture: entry.texture,
        ...(this.backend === 'webgpu' ? { imageSampler: this.linear } : {}),
      };
      style.images.set(entry.texture, bindings);
    }
    mesh.iconVertexArray ??= this.vertexArray('icon', mesh.buffer);
    this.pass.setPipeline(this.pipelines.get('icon')!.pipeline);
    this.pass.setBindings(bindings, { _bindGroupCacheKeys: { 0: bindings } });
    this.pass.setVertexArray(mesh.iconVertexArray);
    if (this.pass.draw({ vertexCount: 6, instanceCount: mesh.count, isInstanced: true })) {
      this.stats.drawCalls++;
      this.stats.iconDrawCalls++;
      this.stats.iconFrameInstances += mesh.count;
    }
  }
  /** Reusable ordered mesh plans. A viewport range is part of the plan, camera
   * uniforms are not. Bundles only record uniform-only fills/opaque MSAA strokes. */
  drawMeshSequence(draws: readonly MeshDraw[], paint: MeshPaint): void {
    if (!draws.length || !this.pass || paint.color[3] <= 0) return;
    if (!draws.every((d) => this.meshes.has(d.mesh)))
      draws = draws.filter((d) => this.meshes.has(d.mesh));
    if (!draws.length) return;
    const key = JSON.stringify([paint, this.pathMode, this.pathSamples]);
    const cache = (this.commandCache ??= new MeshCommandCache());
    if (!this.commandPlansEnabled) cache.clear();
    const orderOpaque =
      this.strokeBatchingEnabled &&
      paint.color[3] === 1 &&
      useMsaaPath(paint, this.pathMode, this.pathSamples) &&
      draws.every((d) => d.mesh.kind === 'path');
    const groupFills = this.fillBatchingEnabled && draws.every((d) => d.mesh.kind === 'fill');
    const plan = cache.select(key, draws, orderOpaque, groupFills);
    const kind = draws[0].mesh.kind;
    const eligible =
      this.renderBundlesEnabled &&
      WebgpuMeshRecorder.supported(this.device) &&
      draws.every((d) => d.mesh.kind === kind) &&
      (kind === 'fill' ||
        (kind === 'path' &&
          this.pathMode !== 'legacy' &&
          useMsaaPath(paint, this.pathMode, this.pathSamples)));
    if (!eligible || plan.repeats < 1 || plan.compiled.length < 8) {
      this.runMeshPlan(plan, paint);
      return;
    }
    // Coverage resets and dynamic scissor state belong to the parent pass, not
    // the recorded bundle. Preserve source-over ordering with circles/text/raster.
    this.flushCircles();
    if (!this.fullScissor) {
      this.pass.setParameters({ scissorRect: [0, 0, this.canvas.width, this.canvas.height] });
      this.fullScissor = true;
    }
    if (kind === 'fill') this.pointGroup = null;
    else if (this.pathMode !== 'reference') {
      const group = opaquePathGroup(paint);
      if (this.pointDepthDirty && this.pointGroup !== group) this.resetPointDepth();
      this.pointGroup = group;
      this.pointDepthDirty = true;
    } else this.pointGroup = null;
    const counters = [
      'drawCalls',
      'pathMsaaDraws',
      'pathFrameCandidates',
      'pathFrameSubmitted',
      'fillFrameCandidates',
      'fillFrameSubmitted',
      'fillFramePaddingTriangles',
    ] as const;
    if (plan.native) {
      for (const pipelineKind of plan.native.kinds) this.style(pipelineKind, paint);
      this.pass.executeBundles([plan.native.bundle]);
      for (const name of counters) this.stats[name] += plan.native.counts[name] ?? 0;
      this.bundleCounters.replays++;
      this.bundleCounters.drawsReplayed += plan.native.counts.drawCalls ?? 0;
      return;
    }
    const pass = this.pass,
      started = performance.now();
    const recorder = new WebgpuMeshRecorder(this.device, 4, this.report);
    const before = counters.map((name) => this.stats[name]);
    this.recordingKinds = new Set();
    this.pass = recorder;
    try {
      this.runMeshPlan(plan, paint);
      const bundle = recorder.finish();
      plan.native = {
        bundle,
        kinds: [...this.recordingKinds],
        counts: Object.fromEntries(counters.map((name, i) => [name, this.stats[name] - before[i]])),
      };
      plan.dispose = () => bundle.destroy();
      pass.executeBundles([bundle]);
      this.bundleCounters.recordings++;
      this.bundleCounters.recordingMs += performance.now() - started;
    } catch (error) {
      plan.dispose?.();
      plan.native = undefined;
      plan.dispose = undefined;
      throw error;
    } finally {
      recorder.destroy();
      this.pass = pass;
      this.recordingKinds = undefined;
    }
  }
  private runMeshPlan(plan: MeshCommandPlan, paint: MeshPaint): void {
    const previous = this.meshScopeStyles;
    this.meshScopeStyles = new Map<PipelineKind, GpuStyle>();
    try {
      for (const command of plan.compiled) {
        const { mesh, original, ranges, indexRanges } = command;
        if (original) this.meshes.add(mesh);
        try {
          this.drawMesh(mesh, paint, ranges, indexRanges);
        } finally {
          if (original) {
            original.vertexArray = mesh.vertexArray;
            original.pathMsaaVertexArray = mesh.pathMsaaVertexArray;
            // Range VAOs use offsets relative to the original slice. Share their
            // bounded owner cache so compiled spans cannot leak orphan VAOs.
            original.rangeVertexArrays = mesh.rangeVertexArrays;
            this.meshes.delete(mesh);
          }
        }
      }
    } finally {
      this.meshScopeStyles = previous;
    }
  }
  drawMesh(
    mesh: GpuMesh,
    paint: MeshPaint,
    ranges?: readonly PathDrawRange[] | null,
    indexRanges?: readonly FillDrawRange[] | null,
  ): void {
    if (ranges && mesh.kind !== 'path') throw new Error('Instance ranges require a path mesh.');
    if (indexRanges && mesh.kind !== 'fill')
      throw new Error('Triangle ranges require a fill mesh.');
    if (mesh.kind === 'path' && this.meshes.has(mesh))
      this.stats.pathFrameCandidates = (this.stats.pathFrameCandidates ?? 0) + mesh.count;
    if (ranges?.length === 0) return;
    if (!this.pass || !this.meshes.has(mesh) || paint.color[3] <= 0) return;
    const circle = mesh.kind === 'point' && isFilledCircle(paint);
    if (!this.fullScissor) {
      this.pass.setParameters({ scissorRect: [0, 0, this.canvas.width, this.canvas.height] });
      this.fullScissor = true;
    }
    if ((mesh.kind === 'path' || mesh.kind === 'line') && (paint.width ?? 1) <= 0) return;
    const fastPath = mesh.kind === 'path' && useMsaaPath(paint, this.pathMode, this.pathSamples);
    if ((mesh.compactStroke || mesh.solidPath) && !fastPath) return;
    const baseInstance = mesh.firstInstance ?? 0;
    const msaaKind = mesh.compactStroke
      ? mesh.compactStrokeXY
        ? 'path-msaa-compact-xy'
        : 'path-msaa-compact'
      : mesh.solidPath
        ? mesh.solidPath === 'xy'
          ? 'path-msaa-solid-xy'
          : 'path-msaa-solid'
        : 'path-msaa';
    const kind: PipelineKind = fastPath
      ? this.pathMode === 'reference'
        ? `${msaaKind}-reference`
        : msaaKind
      : circle
        ? 'circle'
        : mesh.kind;
    const vao = fastPath
      ? (mesh.pathMsaaVertexArray ??= this.vertexArray(
          msaaKind,
          mesh.buffer,
          this.pathIndices,
          this.backend === 'webgl' ? baseInstance : 0,
        ))
      : circle
        ? (mesh.circleVertexArray ??= this.vertexArray('circle', mesh.buffer))
        : (mesh.vertexArray ??= this.vertexArray(kind, mesh.buffer, mesh.indices));
    this.recordingKinds?.add(kind);
    const style = this.style(kind, paint);
    if (mesh.kind === 'fill') {
      this.flushCircles();
      this.pointGroup = null;
      this.stats.fillFrameCandidates += (mesh.logicalCount ?? mesh.count) / 3;
      if (indexRanges?.length === 0) return;
      this.pass.setPipeline(this.pipelines.get('fill')!.pipeline);
      this.pass.setBindings(style.bindings, { _bindGroupCacheKeys: { 0: style.bindings } });
      this.pass.setVertexArray(vao);
      for (const range of indexRanges ?? [{ firstIndex: 0, indexCount: mesh.count }]) {
        if (
          !Number.isSafeInteger(range.firstIndex) ||
          !Number.isSafeInteger(range.indexCount) ||
          range.firstIndex < 0 ||
          range.indexCount < 0 ||
          range.firstIndex % 3 ||
          range.indexCount % 3 ||
          range.firstIndex + range.indexCount > mesh.count
        )
          throw new Error('Invalid fill index range');
        if (
          this.pass.draw({
            indexCount: range.indexCount,
            firstIndex: (mesh.firstIndex ?? 0) + range.firstIndex,
          })
        ) {
          this.stats.drawCalls++;
          const effective = indexRanges
            ? range.indexCount
            : (mesh.logicalCount ?? range.indexCount);
          this.stats.fillFrameSubmitted += effective / 3;
          this.stats.fillFramePaddingTriangles =
            (this.stats.fillFramePaddingTriangles ?? 0) + (range.indexCount - effective) / 3;
        }
      }
      return;
    }
    const options = fastPath
      ? {
          indexCount: 12,
          instanceCount: mesh.count,
          isInstanced: true,
          ...(this.backend === 'webgpu' && baseInstance ? { firstInstance: baseInstance } : {}),
        }
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
      if (kind.startsWith('path-msaa') && !kind.endsWith('-reference')) {
        const group = opaquePathGroup(paint);
        if (this.pointDepthDirty && this.pointGroup !== group) this.resetPointDepth();
        this.pointGroup = group;
        this.pointDepthDirty = true;
      } else this.pointGroup = null;
      this.pass.setPipeline(this.pipelineEntry(kind).pipeline);
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
          const key = `${fastPath ? msaaKind : kind}:${range.firstInstance}`;
          mesh.rangeVertexArrays ??= new Map<string, VertexArray>();
          const previous = mesh.rangeVertexArrays.get(key);
          if (previous) {
            mesh.rangeVertexArrays.delete(key);
            rangeVao = previous;
          } else
            rangeVao = this.vertexArray(
              fastPath ? msaaKind : kind,
              mesh.buffer,
              fastPath ? this.pathIndices : mesh.indices,
              baseInstance + range.firstInstance,
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
              firstInstance: this.backend === 'webgpu' ? baseInstance + range.firstInstance : 0,
            }
          : options;
        if (this.pass.draw(rangeOptions)) {
          this.stats.drawCalls++;
          if (mesh.kind === 'path')
            this.stats.pathFrameSubmitted = (this.stats.pathFrameSubmitted ?? 0) + range.count;
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
        pass.setPipeline(this.pipelineEntry(kind).pipeline);
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
  /** A navigation probe is polled by animation frames, with no timeout or blocking
   * GPU wait. In particular, a late JS timer must not make an already-signaled
   * WebGL fence look like expensive GPU execution. Timestamp diagnostics remain
   * separate; readiness measures queue pressure, not the duration of one draw. */
  probeCompletion(): { poll(): 'pending' | 'complete' | 'unavailable'; dispose(): void } {
    const device = this.device;
    let active = !this.disposed && !this.lost;
    let state: 'pending' | 'complete' | 'unavailable' = 'pending';
    let gl: WebGL2RenderingContext | undefined;
    let fence: WebGLSync | null = null;
    try {
      if (active && this.backend === 'webgpu') {
        void (device as import('@luma.gl/webgpu').WebGPUDevice).handle.queue
          .onSubmittedWorkDone()
          .then(
            () => {
              if (active) state = 'complete';
            },
            () => {
              if (active) state = 'unavailable';
            },
          );
      } else if (active) {
        gl = (device as WebGLDevice).gl;
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (fence) gl.flush();
        else state = 'unavailable';
      }
    } catch {
      state = 'unavailable';
    }
    return {
      poll: () => {
        if (!active || this.disposed || this.lost || device !== this.device) return 'unavailable';
        if (gl && fence && state === 'pending') {
          const status = gl.clientWaitSync(fence, 0, 0);
          if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED)
            state = 'complete';
          else if (status !== gl.TIMEOUT_EXPIRED) state = 'unavailable';
        }
        return state;
      },
      dispose: () => {
        if (!active) return;
        active = false;
        // Restored WebGL contexts reject handles owned by the old device.
        if (gl && fence && device === this.device) gl.deleteSync(fence);
        fence = null;
      },
    };
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
    image: CanvasImageSource | ImageData,
    bounds: Rect,
    opacity = 1,
    smoothing = true,
    clip?: Rect,
    immutable = false,
  ): void {
    if (!this.pass || !Number.isFinite(opacity) || opacity <= 0) return;
    const flat = perspectiveActive(this.transform) ? this.transform.flat : this.transform;
    // Backing dimensions are integer-rounded independently. CSS size * DPR can
    // be fractional; using the nominal DPR for a snapped rectangle but the real
    // backing dimensions for the GL viewport leaves partially covered seam pixels.
    const deviceScale = [this.canvas.width / this.width, this.canvas.height / this.height];
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
      rect = [...a, ...b].map((v, i) => v * deviceScale[i % 2]);
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
      rect = [...a, ...b].map((v, i) => Math.round(v * deviceScale[i % 2]));
      scissor = [...rect];
      if (clip) {
        const a = flat.project(clip[0], clip[3]),
          b = flat.project(clip[2], clip[1]);
        scissor[0] = Math.max(scissor[0], Math.round(a[0] * deviceScale[0]));
        scissor[1] = Math.max(scissor[1], Math.round(a[1] * deviceScale[1]));
        scissor[2] = Math.min(scissor[2], Math.round(b[0] * deviceScale[0]));
        scissor[3] = Math.min(scissor[3], Math.round(b[1] * deviceScale[1]));
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
      rect.map((v, i) => v / deviceScale[i % 2]),
      bounds.join(',') + ':' + (clip?.join(',') ?? ''),
      uv,
    );
    let bindings = style.images.get(entry.texture);
    const sampler = smoothing ? this.linear : this.nearest;
    if (!bindings || (this.backend === 'webgpu' && bindings.imageSampler !== sampler)) {
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

  private imageTexture(image: CanvasImageSource | ImageData, immutable: boolean): ImageEntry {
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
    const pixels = 'data' in image ? image.data : undefined;
    if (
      pixels !== undefined &&
      (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4)
    )
      throw new Error('Raster pixels must be tightly packed RGBA8 ImageData');
    if (
      width > this.device.limits.maxTextureDimension2D ||
      height > this.device.limits.maxTextureDimension2D
    )
      throw new Error('Raster image exceeds the device texture limit');
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
      if (pixels) {
        // Native queue.writeTexture / texSubImage2D accepts tightly packed CPU
        // rows. Do not impose the 256-byte alignment of GPU buffer-copy APIs.
        entry.texture.writeData(pixels, { width, height, bytesPerRow: width * 4 });
        this.stats.pixelTextureUploads++;
        this.stats.pixelTextureUploadedBytes += pixels.byteLength;
      } else {
        entry.texture.copyExternalImage({
          image: image as Parameters<Texture['copyExternalImage']>[0]['image'],
          width,
          height,
          premultipliedAlpha: false,
          flipY: false,
        });
      }
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
    const pass = this.pass;
    try {
      this.flushCircles();
      pass.end();
    } finally {
      this.pass = null;
    }
    this.commandCache?.end();
    this.device.submit();
    // Native replay marks every referenced style in style(). Unused command
    // plans retire above; destroy uniforms only after the current pass submits.
    for (const [key, entry] of this.styles)
      if (entry.frame !== this.frame) {
        this.styles.delete(key);
        entry.images.clear();
        entry.buffer.destroy();
      }
    for (const [key, entry] of this.dashes)
      if (entry.frame !== this.frame) {
        this.dashes.delete(key);
        entry.texture.destroy();
      }
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
          if (epoch === this.timingEpoch) this.queryBusy = false;
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
  forgetImage(image: CanvasImageSource | ImageData): void {
    const entry = this.images.get(image);
    if (!entry) return;
    this.images.delete(image);
    this.destroyImage(entry);
  }

  /** All retirement paths share texture-to-binding cleanup. */
  clearImages(): void {
    const entries = [...this.images.values()];
    this.images.clear();
    cleanupGpu(entries.map((entry) => () => this.destroyImage(entry)));
  }
  private destroyImage(entry: ImageEntry): void {
    const uniforms: Buffer[] = [];
    for (const [key, style] of this.styles ?? []) {
      if (
        style.images.delete(entry.texture) &&
        !style.images.size &&
        (key.startsWith('image:') || key.startsWith('icon:'))
      ) {
        this.styles.delete(key);
        uniforms.push(style.buffer);
      }
    }
    try {
      cleanupGpu([
        ...uniforms.map((buffer) => () => buffer.destroy()),
        () => entry.texture.destroy(),
      ]);
    } finally {
      this.stats.liveTextureBytes -= entry.texture.width * entry.texture.height * 4;
      this.stats.liveTextures--;
    }
  }

  private release(): void {
    this.circleQueue.length = 0;
    this.queuedCircleGroup = null;
    const pass = this.pass;
    this.pass = null;
    try {
      cleanupGpu([
        () => this.commandCache?.clear(),
        () => pass?.end(),
        () => this.textRenderer?.dispose(),
        () => this.msdfTextRenderer?.dispose(),
        ...[...this.meshes].map((mesh) => () => this.destroyMesh(mesh)),
        () => this.pages?.dispose(),
        () => this.clearImages(),
        ...[...this.dashes.values()].map((entry) => () => entry.texture.destroy()),
        ...[...this.pipelines.values()].flatMap((entry) => [
          () => entry.pipeline.destroy(),
          ...entry.shaders.map((shader) => () => shader.destroy()),
        ]),
        // clearImages may already retire image uniforms; enumerate afterwards.
        () => cleanupGpu([...this.styles.values()].map((style) => () => style.buffer.destroy())),
        ...[
          this.imageVertexArray,
          this.msaaFramebuffer,
          this.msaaTexture,
          this.pointDepthTexture,
          this.pointDepthVertexArray,
          this.query,
          this.pathCorners,
          this.pathIndices,
          this.quad,
          this.circleQuad,
          this.nearest,
          this.linear,
        ].map((resource) => () => resource?.destroy()),
      ]);
    } finally {
      this.msdfTextRenderer = this.textRenderer = null;
      this.pages = undefined;
      this.commandCache = undefined;
      this.timingEpoch++;
      this.queryBusy = this.timedFrame = false;
      this.images.clear();
      this.dashes.clear();
      this.pipelines.clear();
      this.styles.clear();
      this.imageVertexArray = this.pointDepthVertexArray = null;
      this.msaaFramebuffer = null;
      this.msaaTexture = this.pointDepthTexture = null;
      this.pointGroup = null;
      this.pointDepthDirty = false;
      this.query = null;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const context = this.backend === 'webgl' ? (this.device as WebGLDevice).gl : null;
    cleanupGpu([
      () => this.canvas.removeEventListener('webglcontextlost', this.onLost),
      () => this.canvas.removeEventListener('webglcontextrestored', this.onRestored),
      () => this.release(),
      () => destroyDevice(this.device),
      () => {
        context?.getExtension('WEBGL_lose_context')?.loseContext();
      },
    ]);
  }
}
