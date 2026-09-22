import {
  PerspectiveTransform,
  perspectiveActive,
  groundBounds,
} from '../../domain/geo/perspective-transform';
import type { RasterTextureResult } from '../../domain/raster/types';
import {
  Buffer,
  Texture,
  type Device,
  type RenderPipeline,
  type RenderPass,
  type Shader,
  type VertexArray,
  type Bindings,
} from '@luma.gl/core';
import { WebGLDevice } from '@luma.gl/webgl';
import type { AffineTransform } from '../../domain/geo/transform';
import type { RasterMetadata, RasterReadResult, RasterStyle } from '../../domain/raster/types';
import { resolveRasterRanges } from '../../domain/raster/statistics';
import { rasterBands, validateRasterStyle } from '../../engine/rendering/raster/tile';
import type { NativeRasterTile } from '../../engine/rendering/raster/native-tiles';
import { rasterVS, rasterFS, rasterWGSL } from './raster-shaders';
import { packRasterWindow } from './raster-packing';
import type { RasterWindow } from '../../domain/raster/types';

interface RegionUniform {
  buffer: Buffer;
  bindings: Bindings;
  values: Float32Array;
}

export interface NumericRasterTexture {
  readonly tile: NativeRasterTile;
  readonly texture: Texture;
  readonly uniform: Buffer;
  readonly bindings: Bindings;
  readonly values: Float32Array;
  readonly bytes: number;
  readonly coreOnly?: boolean;
}
export function supportsNumericRaster(metadata: RasterMetadata): boolean {
  return (
    !metadata.palette &&
    metadata.levels.every(
      (l) =>
        l.samples >= 1 &&
        l.samples <= 4 &&
        l.bits.every((b) => b === l.bits[0] && (b === 8 || b === 16)) &&
        l.formats.every((f) => f === 1) &&
        [0, 1, 2].includes(l.photometric),
    )
  );
}
/** Integer-data renderer for the dynamic source-CRS raster example. It owns only
 * raster pipelines (no vector MSAA/depth passes), and never generates CPU RGBA. */
export class NumericRasterRenderer {
  private pipeline!: RenderPipeline;
  private shaders: Shader[] = [];
  private quad!: Buffer;
  private vao!: VertexArray;
  private tiles = new Set<NumericRasterTexture>();
  private regionUniforms = new Map<NumericRasterTexture, RegionUniform[]>();
  private disposed = false;
  private packingScratch: Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | null = null;
  readonly stats = {
    haloCopies: 0,
    haloCopyBytes: 0,
    preparedUploads: 0,
    packingScratchBytes: 0,
    packingAllocations: 0,
    packingAllocatedBytes: 0,
    textureUploads: 0,
    uploadedBytes: 0,
    uploadSubmitMs: 0,
    packMs: 0,
    liveTextureBytes: 0,
    liveTextures: 0,
    drawCalls: 0,
    frames: 0,
    cpuDrawMs: 0,
    uniformWrites: 0,
    liveRegionUniforms: 0,
  };
  private constructor(
    readonly canvas: HTMLCanvasElement,
    private device: Device,
    readonly backend: 'webgl' | 'webgpu',
  ) {}
  get deviceInfo() {
    return { ...this.device.info };
  }
  static async create(
    canvas: HTMLCanvasElement,
    backend: 'webgl' | 'webgpu',
    report: (e: Error) => void,
  ): Promise<NumericRasterRenderer> {
    let device: Device;
    if (backend === 'webgpu') {
      const { webgpuAdapter } = await import('@luma.gl/webgpu');
      if (!webgpuAdapter.isSupported())
        throw new Error('WebGPU 不可用，请显式选择 WebGL2 或 Canvas。');
      device = await webgpuAdapter.create({
        createCanvasContext: {
          canvas,
          autoResize: false,
          useDevicePixels: false,
          alphaMode: 'premultiplied',
        },
        onError: report,
      });
    } else
      device = new WebGLDevice({
        createCanvasContext: { canvas, autoResize: false, useDevicePixels: false },
        webgl: {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
        },
        onError: report,
      });
    const renderer = new NumericRasterRenderer(canvas, device, backend);
    try {
      if (!device.isTextureFormatSupported('rgba16uint'))
        throw new Error('The device does not support rgba16uint textures.');
      const vs = device.createShader({
        language: backend === 'webgpu' ? 'wgsl' : 'glsl',
        stage: 'vertex',
        source: backend === 'webgpu' ? rasterWGSL : rasterVS,
      });
      renderer.shaders.push(vs);
      const fs =
        backend === 'webgpu'
          ? vs
          : device.createShader({ language: 'glsl', stage: 'fragment', source: rasterFS });
      if (fs !== vs) renderer.shaders.push(fs);
      const shaderLayout = {
        attributes: [
          { name: 'corners', location: 0, type: 'vec2<f32>' as const, stepMode: 'vertex' as const },
        ],
        bindings: [
          {
            name: 'rasterUniforms',
            type: 'uniform' as const,
            group: 0,
            location: 0,
            minBindingSize: 160,
          },
          {
            name: 'dataTexture',
            type: 'texture' as const,
            group: 0,
            location: 1,
            sampleType: 'uint' as const,
          },
        ],
      };
      const bufferLayout = [
        { name: 'corners', format: 'float32x2' as const, stepMode: 'vertex' as const },
      ];
      renderer.pipeline = device.createRenderPipeline({
        id: 'emap-numeric-raster',
        vs,
        fs,
        shaderLayout,
        bufferLayout,
        topology: 'triangle-list',
        vertexEntryPoint: 'vertexMain',
        fragmentEntryPoint: 'fragmentMain',
        parameters: {
          cullMode: 'none',
          blend: true,
          blendColorOperation: 'add',
          blendAlphaOperation: 'add',
          blendColorSrcFactor: 'one',
          blendColorDstFactor: 'one-minus-src-alpha',
          blendAlphaSrcFactor: 'one',
          blendAlphaDstFactor: 'one-minus-src-alpha',
        },
      });
      renderer.quad = device.createBuffer({
        data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
        usage: Buffer.VERTEX,
      });
      renderer.vao = device.createVertexArray({ shaderLayout, bufferLayout });
      renderer.vao.setBuffer(0, renderer.quad);
      const pending = Promise.all(renderer.shaders.map((s) => s.getCompilationInfo()));
      device.submit();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const logs = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Raster shader compilation timed out')),
              30000,
            );
          }),
        ]);
        const errors = logs.flat().filter((l) => l.type === 'error');
        if (errors.length) throw new Error(errors.map((l) => l.message).join('\n'));
      } finally {
        clearTimeout(timer);
      }
      void device.lost.then((info) => {
        if (!renderer.disposed)
          report(new Error(`栅格 GPU 设备丢失：${info.message}。请重新加载页面。`));
      });
      return renderer;
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }
  upload(
    tile: NativeRasterTile,
    result: RasterReadResult,
    readWindow: RasterWindow = tile.window,
  ): NumericRasterTexture {
    if (this.disposed || this.device.isLost) throw new Error('Raster GPU device is unavailable.');
    const width = tile.window[2] - tile.window[0],
      height = tile.window[3] - tile.window[1];
    if (
      width > this.device.limits.maxTextureDimension2D ||
      height > this.device.limits.maxTextureDimension2D ||
      !Number.isSafeInteger(width * height) ||
      width < 1 ||
      height < 1 ||
      width * height > 4 * 1024 ** 2
    )
      throw new Error('Unsupported UInt16 texture dimensions.');
    const start = performance.now(),
      length = width * height * 4,
      bits = result.data[0] instanceof Uint8Array ? 8 : 16;
    // writeData consumes CPU input synchronously in both luma backends. Keep a
    // single bounded packing workspace instead of allocating one buffer per tile.
    if (
      !this.packingScratch ||
      this.packingScratch.length < length ||
      this.packingScratch.BYTES_PER_ELEMENT !== bits / 8
    ) {
      this.packingScratch = bits === 8 ? new Uint8Array(length) : new Uint16Array(length);
      this.stats.packingScratchBytes = this.packingScratch.byteLength;
      this.stats.packingAllocations++;
      this.stats.packingAllocatedBytes += this.packingScratch.byteLength;
    }
    const packed = packRasterWindow(
      result,
      readWindow,
      tile.window,
      this.packingScratch.subarray(0, length),
    );
    this.stats.packMs += performance.now() - start;
    return this.uploadPrepared(tile, { width, height, bits, data: packed }, tile.window);
  }
  /** Upload a subrectangle of a Worker-owned packed result with row stride;
   * there is no main-thread crop or channel packing allocation. */
  uploadPrepared(
    tile: NativeRasterTile,
    result: RasterTextureResult,
    readWindow: RasterWindow = tile.window,
    coreOnly = false,
  ): NumericRasterTexture {
    if (this.disposed || this.device.isLost) throw new Error('Raster GPU device is unavailable.');
    const region = coreOnly ? tile.core : tile.window;
    const width = tile.window[2] - tile.window[0],
      height = tile.window[3] - tile.window[1];
    const rw = region[2] - region[0],
      rh = region[3] - region[1],
      stride = result.width;
    const bytesPerPixel = (result.bits / 8) * 4;
    if (
      ![...region, ...readWindow, ...tile.window].every(Number.isSafeInteger) ||
      ![8, 16].includes(result.bits) ||
      !(result.bits === 8
        ? result.data instanceof Uint8Array
        : result.data instanceof Uint16Array) ||
      stride !== readWindow[2] - readWindow[0] ||
      result.height !== readWindow[3] - readWindow[1] ||
      result.data.length !== stride * result.height * 4 ||
      width < 1 ||
      height < 1 ||
      rw < 1 ||
      rh < 1 ||
      width * height > 4 * 1024 ** 2 ||
      width > this.device.limits.maxTextureDimension2D ||
      height > this.device.limits.maxTextureDimension2D ||
      region[0] < readWindow[0] ||
      region[1] < readWindow[1] ||
      region[2] > readWindow[2] ||
      region[3] > readWindow[3]
    )
      throw new Error('Invalid prepared integer texture subwindow.');
    let texture: Texture | undefined, uniform: Buffer | undefined;
    const at = performance.now();
    try {
      texture = this.device.createTexture({
        width,
        height,
        format: result.bits === 8 ? 'rgba8uint' : 'rgba16uint',
        usage: Texture.SAMPLE | Texture.COPY_DST | Texture.COPY_SRC | Texture.RENDER_ATTACHMENT,
        sampler: {
          minFilter: 'nearest',
          magFilter: 'nearest',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        },
      });
      texture.writeData(result.data, {
        x: region[0] - tile.window[0],
        y: region[1] - tile.window[1],
        width: rw,
        height: rh,
        byteOffset:
          ((region[1] - readWindow[1]) * stride + region[0] - readWindow[0]) * bytesPerPixel,
        bytesPerRow: stride * bytesPerPixel,
        rowsPerImage: result.height,
      });
      uniform = this.device.createBuffer({
        byteLength: 160,
        usage: Buffer.UNIFORM | Buffer.COPY_DST,
      });
      const entry: NumericRasterTexture = {
        tile,
        texture,
        uniform,
        coreOnly,
        bindings: { rasterUniforms: uniform, dataTexture: texture },
        values: new Float32Array(40).fill(NaN),
        bytes: width * height * bytesPerPixel,
      };
      this.tiles.add(entry);
      this.stats.textureUploads++;
      this.stats.preparedUploads++;
      this.stats.uploadedBytes += rw * rh * bytesPerPixel;
      this.stats.liveTextureBytes += entry.bytes;
      this.stats.liveTextures++;
      return entry;
    } catch (error) {
      texture?.destroy();
      uniform?.destroy();
      throw error;
    } finally {
      this.stats.uploadSubmitMs += performance.now() - at;
    }
  }
  /** Copy the original one-pixel edge/corner from already resident neighbor
   * cores. Integer GPU-to-GPU copies never interpolate, recolor or read back. */
  fillHalo(target: NumericRasterTexture, neighbors: readonly NumericRasterTexture[]): void {
    if (!this.tiles.has(target)) throw new Error('Halo target is not resident.');
    let copies = 0;
    for (const source of neighbors) {
      if (
        !this.tiles.has(source) ||
        source.tile.level.id !== target.tile.level.id ||
        source.texture.format !== target.texture.format
      )
        throw new Error('Incompatible halo neighbor.');
      const w = target.tile.window,
        c = source.tile.core,
        sw = source.tile.window;
      const x = Math.max(w[0], c[0]),
        y = Math.max(w[1], c[1]);
      const width = Math.min(w[2], c[2]) - x,
        height = Math.min(w[3], c[3]) - y;
      if (width <= 0 || height <= 0 || source === target) continue;
      this.device.commandEncoder.copyTextureToTexture({
        sourceTexture: source.texture,
        destinationTexture: target.texture,
        origin: [x - sw[0], y - sw[1], 0],
        destinationOrigin: [x - w[0], y - w[1], 0],
        width,
        height,
        depthOrArrayLayers: 1,
      });
      copies++;
      this.stats.haloCopyBytes += width * height * (source.texture.format === 'rgba8uint' ? 4 : 8);
    }
    if (copies) {
      this.device.submit();
      this.stats.haloCopies += copies;
    }
  }
  draw(
    entries: readonly NumericRasterTexture[],
    view: AffineTransform,
    width: number,
    height: number,
    dpr: number,
    metadata: RasterMetadata,
    style: RasterStyle,
    coverage?: ReadonlyMap<string, readonly RasterWindow[]>,
  ): void {
    if (this.disposed || this.device.isLost) return;
    validateRasterStyle(metadata, style);
    const started = performance.now();
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.canvas.width !== w || this.canvas.height !== h)
      this.device.canvasContext!.setDrawingBufferSize(w, h);
    const bands = rasterBands(metadata, style),
      gray = bands.length === 1,
      range = resolveRasterRanges(metadata, style, bands);
    const pass = this.device.beginRenderPass({
      framebuffer: this.device.canvasContext!.getCurrentFramebuffer({ depthStencilFormat: false }),
      clearColor: [0, 0, 0, 0],
      clearDepth: false,
      clearStencil: false,
      parameters: { viewport: [0, 0, w, h], scissorRect: [0, 0, w, h] },
    });
    try {
      pass.setPipeline(this.pipeline);
      pass.setVertexArray(this.vao);
      for (const e of entries) {
        if (!this.tiles.has(e)) continue;
        if (perspectiveActive(view)) {
          this.drawPerspectiveEntry(
            pass,
            e,
            view,
            width,
            height,
            w,
            h,
            metadata,
            style,
            bands,
            range,
            coverage?.get(e.tile.key) ?? (coverage ? [] : [e.tile.bounds]),
          );
          continue;
        }
        this.releaseRegionUniforms(e);
        const { tile } = e,
          b = tile.bounds,
          a = view.project(b[0], b[3]),
          z = view.project(b[2], b[1]);
        // Clip in CPU Float64 before storing uniforms. Neither GPU endpoints nor UV
        // interpolation inherit huge off-screen pixel coordinates at deep zoom.
        const left = Math.max(0, a[0]),
          top = Math.max(0, a[1]),
          right = Math.min(width, z[0]),
          bottom = Math.min(height, z[1]);
        if (right <= left || bottom <= top) continue;
        const c = tile.core,
          r = tile.window;
        const px = (x: number) => c[0] - r[0] + ((x - a[0]) / (z[0] - a[0])) * (c[2] - c[0]);
        const py = (y: number) => c[1] - r[1] + ((y - a[1]) / (z[1] - a[1])) * (c[3] - c[1]);
        const values = Float32Array.from([
          left,
          top,
          right,
          bottom,
          px(left),
          py(top),
          px(right),
          py(bottom),
          width,
          height,
          e.texture.width,
          e.texture.height,
          range[0][0],
          range[gray ? 0 : 1][0],
          range[gray ? 0 : 2][0],
          2 **
            (metadata.alphaBand === null
              ? tile.level.bits[0]
              : tile.level.bits[metadata.alphaBand]) -
            1,
          range[0][1],
          range[gray ? 0 : 1][1],
          range[gray ? 0 : 2][1],
          0,
          bands[0],
          bands[gray ? 0 : 1],
          bands[gray ? 0 : 2],
          metadata.alphaBand ?? -1,
          style.resampling === 'bilinear' ? 1 : 0,
          metadata.noData ?? -1,
          style.opacity ?? 1,
          tile.level.photometric === 0 ? 1 : 0,
          w,
          h,
          width / w,
          height / h,
          1,
          0,
          1,
          0,
          left,
          top,
          right,
          bottom,
        ]);
        if (values.some((v, i) => v !== e.values[i])) {
          e.values.set(values);
          e.uniform.write(values);
          this.stats.uniformWrites++;
        }
        pass.setBindings(e.bindings, { _bindGroupCacheKeys: { 0: e.bindings } });
        // Old and newly refined tiles own disjoint rectangles, including NoData.
        // Scissor changes (not repeated writes to the same uniform buffer) keep
        // every draw correct on WebGPU's deferred command submission.
        const regions = coverage?.get(tile.key) ?? (coverage ? [] : [tile.bounds]);
        for (const bounds of regions) {
          const lo = view.project(bounds[0], bounds[3]),
            hi = view.project(bounds[2], bounds[1]);
          const pixel = (v: number, ratio: number, max: number) =>
            Math.max(0, Math.min(max, Math.ceil(v * ratio - 0.5)));
          const x0 = pixel(lo[0], w / width, w),
            x1 = pixel(hi[0], w / width, w);
          const y0 = pixel(lo[1], h / height, h),
            y1 = pixel(hi[1], h / height, h);
          if (x1 <= x0 || y1 <= y0) continue;
          pass.setParameters({
            scissorRect: [x0, this.backend === 'webgpu' ? y0 : h - y1, x1 - x0, y1 - y0],
          });
          if (pass.draw({ vertexCount: 6 })) this.stats.drawCalls++;
        }
      }
    } finally {
      pass.end();
      this.device.submit();
      this.stats.frames++;
      this.stats.cpuDrawMs += performance.now() - started;
    }
  }
  /** A separate buffer per coverage region is essential for deferred WebGPU submission. */
  private drawPerspectiveEntry(
    pass: RenderPass,
    e: NumericRasterTexture,
    view: PerspectiveTransform,
    width: number,
    height: number,
    w: number,
    h: number,
    metadata: RasterMetadata,
    style: RasterStyle,
    bands: readonly number[],
    range: ReturnType<typeof resolveRasterRanges>,
    regions: readonly RasterWindow[],
  ): void {
    const footprint = groundBounds(view, width, height),
      flat = view.flat;
    const { tile } = e,
      b = tile.bounds,
      c = tile.core,
      r = tile.window;
    const gray = bands.length === 1;
    const uniforms = this.regionUniforms.get(e) ?? [];
    this.regionUniforms.set(e, uniforms);
    let used = 0;
    for (const region of regions) {
      const crop = [
        Math.max(region[0], b[0], footprint[0]),
        Math.max(region[1], b[1], footprint[1]),
        Math.min(region[2], b[2], footprint[2]),
        Math.min(region[3], b[3], footprint[3]),
      ];
      if (crop[0] >= crop[2] || crop[1] >= crop[3]) continue;
      const a = flat.project(crop[0], crop[3]),
        z = flat.project(crop[2], crop[1]);
      const corners = [
        [crop[0], crop[1]],
        [crop[0], crop[3]],
        [crop[2], crop[1]],
        [crop[2], crop[3]],
      ].map(([x, y]) => view.project(x, y));
      // A rectangle crossing the camera plane can still cover the viewport.
      // Use a conservative screen rectangle; the fragment ray owns exact ground coverage.
      let screen = [0, 0, width, height];
      if (corners.every((p) => p.every(Number.isFinite)))
        screen = [
          Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0])))),
          Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1])))),
          Math.min(width, Math.ceil(Math.max(...corners.map((p) => p[0])))),
          Math.min(height, Math.ceil(Math.max(...corners.map((p) => p[1])))),
        ];
      if (screen[0] >= screen[2] || screen[1] >= screen[3]) continue;
      const px = (x: number) => c[0] - r[0] + ((x - b[0]) / (b[2] - b[0])) * (c[2] - c[0]);
      const py = (y: number) => c[1] - r[1] + ((b[3] - y) / (b[3] - b[1])) * (c[3] - c[1]);
      const values = Float32Array.from([
        ...a,
        ...z,
        px(crop[0]),
        py(crop[3]),
        px(crop[2]),
        py(crop[1]),
        width,
        height,
        e.texture.width,
        e.texture.height,
        range[0][0],
        range[gray ? 0 : 1][0],
        range[gray ? 0 : 2][0],
        2 **
          (metadata.alphaBand === null ? tile.level.bits[0] : tile.level.bits[metadata.alphaBand]) -
          1,
        range[0][1],
        range[gray ? 0 : 1][1],
        range[gray ? 0 : 2][1],
        0,
        bands[0],
        bands[gray ? 0 : 1],
        bands[gray ? 0 : 2],
        metadata.alphaBand ?? -1,
        style.resampling === 'bilinear' ? 1 : 0,
        metadata.noData ?? -1,
        style.opacity ?? 1,
        tile.level.photometric === 0 ? 1 : 0,
        w,
        h,
        width / w,
        height / h,
        ...view.cameraUniforms,
        ...screen,
      ]);
      let uniform = uniforms[used++];
      if (!uniform) {
        const buffer = this.device.createBuffer({
          byteLength: 160,
          usage: Buffer.UNIFORM | Buffer.COPY_DST,
        });
        uniform = {
          buffer,
          bindings: { rasterUniforms: buffer, dataTexture: e.texture },
          values: new Float32Array(40).fill(NaN),
        };
        uniforms.push(uniform);
        this.stats.liveRegionUniforms++;
      }
      if (values.some((v, i) => v !== uniform.values[i])) {
        uniform.values.set(values);
        uniform.buffer.write(values);
        this.stats.uniformWrites++;
      }
      pass.setBindings(uniform.bindings, { _bindGroupCacheKeys: { 0: uniform.bindings } });
      if (pass.draw({ vertexCount: 6 })) this.stats.drawCalls++;
    }
    while (uniforms.length > used) {
      uniforms.pop()!.buffer.destroy();
      this.stats.liveRegionUniforms--;
    }
  }

  private releaseRegionUniforms(e: NumericRasterTexture): void {
    const uniforms = this.regionUniforms.get(e);
    if (!uniforms) return;
    for (const u of uniforms) {
      u.buffer.destroy();
      this.stats.liveRegionUniforms--;
    }
    this.regionUniforms.delete(e);
  }

  release(entry: NumericRasterTexture): void {
    if (!this.tiles.delete(entry)) return;
    this.releaseRegionUniforms(entry);
    entry.texture.destroy();
    entry.uniform.destroy();
    this.stats.liveTextureBytes -= entry.bytes;
    this.stats.liveTextures--;
  }
  async waitForIdle(): Promise<void> {
    if (this.disposed || this.device.isLost) return;
    if (this.backend === 'webgpu') {
      await (
        this.device as import('@luma.gl/webgpu').WebGPUDevice
      ).handle.queue.onSubmittedWorkDone();
      return;
    }
    const gl = (this.device as WebGLDevice).gl,
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) return;
    gl.flush();
    const start = performance.now();
    try {
      while (!this.disposed && !this.device.isLost) {
        const r = gl.clientWaitSync(fence, 0, 0);
        if (r === gl.CONDITION_SATISFIED || r === gl.ALREADY_SIGNALED) return;
        if (r === gl.WAIT_FAILED || performance.now() - start > 30000)
          throw new Error('Raster GPU fence failed.');
        await new Promise((r) => setTimeout(r, 4));
      }
    } finally {
      gl.deleteSync(fence);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.packingScratch = null;
    this.stats.packingScratchBytes = 0;
    for (const e of this.tiles) this.release(e);
    this.vao?.destroy();
    this.quad?.destroy();
    this.pipeline?.destroy();
    for (const s of this.shaders) s.destroy();
    this.device.destroy();
  }
}
