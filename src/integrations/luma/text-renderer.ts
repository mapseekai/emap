import {
  Buffer,
  type Device,
  type Texture,
  type RenderPass,
  type RenderPipeline,
  type Shader,
  type VertexArray,
  type Bindings,
  type ShaderLayout,
  type BufferLayout,
} from '@luma.gl/core';
import type { LabelFrame, PlacedLabel } from '../../engine/rendering/labels/manager';
import type { LabelRaster, LabelAtlasPage } from '../../engine/rendering/labels/atlas';

const vs = `#version 300 es
precision highp float;
layout(location=0) in vec2 corners;
layout(location=1) in vec4 rectangle;
layout(location=2) in vec2 rotation;
layout(location=3) in vec4 atlasRect;
layout(std140) uniform textUniforms { vec4 viewport; } text;
out vec2 uv;
void main() {
 vec2 offset=corners*rectangle.zw*0.5;
 vec2 p=rectangle.xy+vec2(rotation.x*offset.x-rotation.y*offset.y,rotation.y*offset.x+rotation.x*offset.y);
 gl_Position=vec4(p/text.viewport.xy*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
 uv=mix(atlasRect.xy,atlasRect.zw,(corners+1.)*0.5);
}`;
const fs = `#version 300 es
precision highp float;
uniform sampler2D atlasTexture;
in vec2 uv;
out vec4 fragColor;
void main() { vec4 c=texture(atlasTexture,uv); if(c.a==0.)discard; fragColor=vec4(c.rgb*c.a,c.a); }`;
const wgsl = `
struct Uniforms {viewport:vec4<f32>};
@group(0) @binding(0) var<uniform> text:Uniforms;
@group(0) @binding(1) var atlasTexture:texture_2d<f32>;
@group(0) @binding(2) var atlasSampler:sampler;
struct Out {@builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32>};
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) rectangle:vec4<f32>,@location(2) rotation:vec2<f32>,@location(3) atlasRect:vec4<f32>)->Out {
 let offset=corners*rectangle.zw*0.5;
 let p=rectangle.xy+vec2<f32>(rotation.x*offset.x-rotation.y*offset.y,rotation.y*offset.x+rotation.x*offset.y);
 return Out(vec4<f32>(p/text.viewport.xy*vec2<f32>(2.,-2.)+vec2<f32>(-1.,1.),0.,1.),mix(atlasRect.xy,atlasRect.zw,(corners+1.)*0.5));
}
@fragment fn fragmentMain(p:Out)->@location(0) vec4<f32> {
 let c=textureSample(atlasTexture,atlasSampler,p.uv);if(c.a==0.){discard;}return vec4<f32>(c.rgb*c.a,c.a);
}`;
type BitmapLabel = PlacedLabel & { raster: LabelRaster };
interface Batch {
  firstLabel: number;
  buffer: Buffer;
  vao: VertexArray;
  bindings: Bindings;
  count: number;
  bytes: number;
}
interface Page {
  texture: Texture;
  version: number;
}

/** Instanced, batched atlas quads in the existing luma render pass. Labels have no
 * independent map layer or DOM element. Screen placements already use the active camera. */
export class GpuTextRenderer {
  private shaders: Shader[] = [];
  private pipeline!: RenderPipeline;
  private quad!: Buffer;
  private uniform!: Buffer;
  private pages = new Map<LabelAtlasPage, Page>();
  private batches: Batch[] = [];
  private staging = new Float32Array(0);
  private key = '';
  private size = '';
  private disposed = false;
  private layout!: ShaderLayout;
  private buffers!: BufferLayout[];
  readonly stats = {
    drawCalls: 0,
    bufferUploads: 0,
    bufferAllocations: 0,
    reusedBatches: 0,
    stagingBytes: 0,
    textureUploads: 0,
    liveTextureBytes: 0,
    liveBufferBytes: 0,
  };
  get memoryStats() {
    return {
      bufferBytes: this.disposed
        ? 0
        : this.stats.liveBufferBytes +
          (this.quad?.byteLength ?? 0) +
          (this.uniform?.byteLength ?? 0),
      textureBytes: this.stats.liveTextureBytes,
    };
  }
  constructor(
    private device: Device,
    private backend: 'webgl' | 'webgpu',
  ) {
    const webgpu = backend === 'webgpu';
    try {
      const vertex = device.createShader({
        stage: 'vertex',
        language: webgpu ? 'wgsl' : 'glsl',
        source: webgpu ? wgsl : vs,
      });
      this.shaders.push(vertex);
      const fragment = webgpu
        ? vertex
        : device.createShader({ stage: 'fragment', language: 'glsl', source: fs });
      if (fragment !== vertex) this.shaders.push(fragment);
      this.layout = {
        attributes: [
          { name: 'corners', location: 0, type: 'vec2<f32>', stepMode: 'vertex' },
          { name: 'rectangle', location: 1, type: 'vec4<f32>', stepMode: 'instance' },
          { name: 'rotation', location: 2, type: 'vec2<f32>', stepMode: 'instance' },
          { name: 'atlasRect', location: 3, type: 'vec4<f32>', stepMode: 'instance' },
        ],
        bindings: [
          { name: 'textUniforms', type: 'uniform', group: 0, location: 0, minBindingSize: 16 },
          { name: 'atlasTexture', type: 'texture', group: 0, location: 1 },
          ...(webgpu
            ? [{ name: 'atlasSampler', type: 'sampler' as const, group: 0, location: 2 }]
            : []),
        ],
      };
      this.buffers = [
        { name: 'corners', format: 'float32x2', stepMode: 'vertex' },
        {
          name: 'labels',
          byteStride: 40,
          stepMode: 'instance',
          attributes: [
            { attribute: 'rectangle', format: 'float32x4', byteOffset: 0 },
            { attribute: 'rotation', format: 'float32x2', byteOffset: 16 },
            { attribute: 'atlasRect', format: 'float32x4', byteOffset: 24 },
          ],
        },
      ];
      this.pipeline = device.createRenderPipeline({
        id: 'emap-bound-labels',
        vs: vertex,
        fs: fragment,
        shaderLayout: this.layout,
        bufferLayout: this.buffers,
        vertexEntryPoint: 'vertexMain',
        fragmentEntryPoint: 'fragmentMain',
        topology: 'triangle-list',
        depthStencilAttachmentFormat: webgpu ? 'depth24plus' : undefined,
        parameters: {
          cullMode: 'none',
          depthCompare: 'always',
          depthWriteEnabled: false,
          blend: true,
          blendColorOperation: 'add',
          blendAlphaOperation: 'add',
          blendColorSrcFactor: 'one',
          blendColorDstFactor: 'one-minus-src-alpha',
          blendAlphaSrcFactor: 'one',
          blendAlphaDstFactor: 'one-minus-src-alpha',
          ...(webgpu ? { sampleCount: 4 } : {}),
        },
      });
      this.quad = device.createBuffer({
        data: new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        usage: Buffer.VERTEX,
      });
      this.uniform = device.createBuffer({
        byteLength: 16,
        usage: Buffer.UNIFORM | Buffer.COPY_DST,
      });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private page(source: LabelAtlasPage): Page {
    let entry = this.pages.get(source);
    if (!entry) {
      const texture = this.device.createTexture({
        width: source.canvas.width,
        height: source.canvas.height,
        format: 'rgba8unorm',
        sampler: {
          minFilter: 'linear',
          magFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        },
      });
      entry = { texture, version: -1 };
      this.pages.set(source, entry);
      this.stats.liveTextureBytes += source.canvas.width * source.canvas.height * 4;
    }
    if (entry.version !== source.version) {
      entry.texture.copyExternalImage({
        image: source.canvas,
        width: source.canvas.width,
        height: source.canvas.height,
        premultipliedAlpha: false,
        flipY: false,
      });
      entry.version = source.version;
      this.stats.textureUploads++;
    }
    return entry;
  }
  draw(
    pass: RenderPass,
    frame: LabelFrame,
    width: number,
    height: number,
    start = 0,
    end = frame.labels.length,
  ): void {
    if (this.disposed) return;
    if (frame.key !== this.key) {
      const reusable = this.batches;
      this.batches = [];
      let consumed = 0;
      try {
        const labels = frame.labels.filter((l): l is BitmapLabel => !('mode' in l.raster));
        const used = new Set(labels.map((l) => l.raster.page));
        for (const [source, page] of this.pages)
          if (!used.has(source)) {
            this.stats.liveTextureBytes -= page.texture.width * page.texture.height * 4;
            page.texture.destroy();
            this.pages.delete(source);
          }
        // Contiguous page runs preserve label and parent-layer compositing order.
        const runs: { labels: BitmapLabel[]; first: number }[] = [];
        let previous = -2;
        for (let index = 0; index < frame.labels.length; index++) {
          const label = frame.labels[index];
          if ('mode' in label.raster) continue;
          const bitmap = label as BitmapLabel;
          const last = runs.at(-1);
          if (previous === index - 1 && last?.labels[0].raster.page === bitmap.raster.page)
            last.labels.push(bitmap);
          else runs.push({ labels: [bitmap], first: index });
          previous = index;
        }
        for (const run of runs) {
          const old = reusable[consumed],
            batch = this.batch(run.labels, old);
          batch.firstLabel = run.first;
          consumed++;
          this.batches.push(batch);
          if (old && old !== batch) this.releaseBatches([old]);
        }
        this.key = frame.key;
      } catch (error) {
        this.key = '';
        this.clearBatches();
        throw error;
      } finally {
        this.releaseBatches(reusable.slice(consumed));
      }
    }
    if (!this.batches.length) return;
    const size = `${width}:${height}`;
    if (size !== this.size) {
      this.uniform.write(new Float32Array([width, height, 0, 0]));
      this.size = size;
    }
    pass.setPipeline(this.pipeline);
    let low = 0,
      high = start === 0 ? 0 : this.batches.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.batches[mid].firstLabel < start) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < this.batches.length && this.batches[i].firstLabel < end; i++) {
      const batch = this.batches[i];
      pass.setBindings(batch.bindings, { _bindGroupCacheKeys: { 0: batch.bindings } });
      pass.setVertexArray(batch.vao);
      if (pass.draw({ vertexCount: 6, instanceCount: batch.count, isInstanced: true }))
        this.stats.drawCalls++;
    }
  }
  private batch(labels: readonly BitmapLabel[], previous?: Batch): Batch {
    const source = labels[0].raster.page,
      page = this.page(source);
    const length = labels.length * 10;
    if (this.staging.length < length) this.staging = new Float32Array(length);
    this.stats.stagingBytes = this.staging.byteLength;
    const data = this.staging.subarray(0, length);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i],
        r = l.raster,
        [x, y, w, h] = r.rect,
        at = i * 10;
      data[at] = l.x;
      data[at + 1] = l.y;
      data[at + 2] = r.width * (l.scale ?? 1);
      data[at + 3] = r.height * (l.scale ?? 1);
      data[at + 4] = Math.cos(l.angle);
      data[at + 5] = Math.sin(l.angle);
      data[at + 6] = x / source.canvas.width;
      data[at + 7] = y / source.canvas.height;
      data[at + 8] = (x + w) / source.canvas.width;
      data[at + 9] = (y + h) / source.canvas.height;
    }
    const reuse = previous && previous.bytes >= data.byteLength ? previous : undefined;
    const buffer =
      reuse?.buffer ??
      this.device.createBuffer({
        id: 'emap-bitmap-label-instances',
        byteLength: data.byteLength,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      });
    let vao = reuse?.vao;
    try {
      buffer.write(data);
      if (!vao) {
        vao = this.device.createVertexArray({
          shaderLayout: this.layout,
          bufferLayout: this.buffers,
        });
        if (this.backend === 'webgpu') {
          const a = vao.getBufferSlot('corners'),
            b = vao.getBufferSlot('labels');
          if (a === null || b === null) throw new Error('Missing text vertex-buffer slots.');
          vao.setBuffer(a, this.quad);
          vao.setBuffer(b, buffer);
        } else {
          vao.setBuffer(0, this.quad);
          for (const location of [1, 2, 3]) vao.setBuffer(location, buffer);
        }
      }
      const bindings: Bindings =
        reuse?.bindings.atlasTexture === page.texture
          ? reuse.bindings
          : {
              textUniforms: this.uniform,
              atlasTexture: page.texture,
              ...(this.backend === 'webgpu' ? { atlasSampler: page.texture.sampler } : {}),
            };
      this.stats.bufferUploads++;
      if (reuse) {
        this.stats.reusedBatches++;
        reuse.bindings = bindings;
        reuse.count = labels.length;
        return reuse;
      }
      this.stats.bufferAllocations++;
      this.stats.liveBufferBytes += data.byteLength;
      return { buffer, vao, bindings, count: labels.length, bytes: data.byteLength, firstLabel: 0 };
    } catch (error) {
      if (!reuse) {
        try {
          vao?.destroy();
        } finally {
          buffer.destroy();
        }
      }
      throw error;
    }
  }
  private releaseBatches(batches: readonly Batch[]): void {
    const errors: unknown[] = [];
    for (const b of batches) {
      try {
        b.vao.destroy();
      } catch (error) {
        errors.push(error);
      }
      try {
        b.buffer.destroy();
      } catch (error) {
        errors.push(error);
      }
      this.stats.liveBufferBytes -= b.bytes;
    }
    if (errors.length) throw new AggregateError(errors, 'Bitmap label cleanup failed');
  }
  private clearBatches(): void {
    const batches = this.batches;
    this.batches = [];
    this.releaseBatches(batches);
  }
  clear(): void {
    this.staging = new Float32Array(0);
    this.stats.stagingBytes = 0;
    this.clearBatches();
    this.key = '';
    for (const page of this.pages.values()) page.texture.destroy();
    this.pages.clear();
    this.stats.liveTextureBytes = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.pipeline?.destroy();
    this.quad?.destroy();
    this.uniform?.destroy();
    for (const shader of this.shaders) shader.destroy();
    this.shaders = [];
  }
}
