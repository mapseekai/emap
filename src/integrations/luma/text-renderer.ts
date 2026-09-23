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
  private key = '';
  private size = '';
  private disposed = false;
  private layout!: ShaderLayout;
  private buffers!: BufferLayout[];
  readonly stats = {
    drawCalls: 0,
    bufferUploads: 0,
    textureUploads: 0,
    liveTextureBytes: 0,
    liveBufferBytes: 0,
  };
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
  draw(pass: RenderPass, frame: LabelFrame, width: number, height: number): void {
    if (this.disposed) return;
    if (frame.key !== this.key) {
      this.clearBatches();
      const labels = frame.labels.filter((l): l is BitmapLabel => !('mode' in l.raster));
      const used = new Set(labels.map((l) => l.raster.page));
      for (const [source, page] of this.pages)
        if (!used.has(source)) {
          this.stats.liveTextureBytes -= page.texture.width * page.texture.height * 4;
          page.texture.destroy();
          this.pages.delete(source);
        }
      // Contiguous page runs preserve label and parent-layer compositing order.
      const runs: BitmapLabel[][] = [];
      for (const label of labels) {
        const last = runs.at(-1);
        if (last?.[0].raster.page === label.raster.page) last.push(label);
        else runs.push([label]);
      }
      try {
        for (const labels of runs) this.batches.push(this.batch(labels));
        this.key = frame.key;
      } catch (error) {
        this.clearBatches();
        this.key = '';
        throw error;
      }
    }
    if (!this.batches.length) return;
    const size = `${width}:${height}`;
    if (size !== this.size) {
      this.uniform.write(new Float32Array([width, height, 0, 0]));
      this.size = size;
    }
    pass.setPipeline(this.pipeline);
    for (const batch of this.batches) {
      pass.setBindings(batch.bindings, { _bindGroupCacheKeys: { 0: batch.bindings } });
      pass.setVertexArray(batch.vao);
      if (pass.draw({ vertexCount: 6, instanceCount: batch.count, isInstanced: true }))
        this.stats.drawCalls++;
    }
  }
  private batch(labels: readonly BitmapLabel[]): Batch {
    const source = labels[0].raster.page,
      page = this.page(source),
      data = new Float32Array(labels.length * 10);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i],
        r = l.raster,
        [x, y, w, h] = r.rect;
      data.set(
        [
          l.x,
          l.y,
          r.width,
          r.height,
          Math.cos(l.angle),
          Math.sin(l.angle),
          x / source.canvas.width,
          y / source.canvas.height,
          (x + w) / source.canvas.width,
          (y + h) / source.canvas.height,
        ],
        i * 10,
      );
    }
    const buffer = this.device.createBuffer({
      byteLength: data.byteLength,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
    });
    let vao: VertexArray | undefined;
    try {
      buffer.write(data);
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
      const bindings: Bindings = {
        textUniforms: this.uniform,
        atlasTexture: page.texture,
        ...(this.backend === 'webgpu' ? { atlasSampler: page.texture.sampler } : {}),
      };
      this.stats.liveBufferBytes += data.byteLength;
      this.stats.bufferUploads++;
      return { buffer, vao, bindings, count: labels.length, bytes: data.byteLength };
    } catch (error) {
      vao?.destroy();
      buffer.destroy();
      throw error;
    }
  }
  private clearBatches(): void {
    for (const b of this.batches) {
      b.vao.destroy();
      b.buffer.destroy();
      this.stats.liveBufferBytes -= b.bytes;
    }
    this.batches = [];
  }
  clear(): void {
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
