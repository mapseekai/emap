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
import type {
  MsdfTextRaster,
  MsdfGlyphQuad,
  MsdfAtlasPage,
} from '../../engine/rendering/labels/text-types';
import { LabelCollisionGrid } from '../../engine/rendering/labels/geometry';

const vs = `#version 300 es
precision highp float;
layout(location=0) in vec2 corners;
layout(location=1) in vec4 rectangle;
layout(location=2) in vec2 rotation;
layout(location=3) in vec4 atlasRect;
layout(location=4) in vec4 fillColor;
layout(location=5) in vec4 outlineColor;
layout(location=6) in vec4 parameters;
layout(std140) uniform textUniforms {vec4 viewport;} text;
out vec2 uv;
flat out vec4 color;
flat out vec4 halo;
flat out vec4 effects;
void main(){
 vec2 offset=corners*rectangle.zw*0.5;offset.x-=parameters.z*offset.y;
 vec2 p=rectangle.xy+vec2(rotation.x*offset.x-rotation.y*offset.y,rotation.y*offset.x+rotation.x*offset.y);
 gl_Position=vec4(p/text.viewport.xy*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
 uv=mix(atlasRect.xy,atlasRect.zw,(corners+1.)*0.5);color=fillColor;halo=outlineColor;effects=parameters;
}`;
const fs = `#version 300 es
precision highp float;
uniform sampler2D atlasTexture;
layout(std140) uniform textUniforms {vec4 viewport;} text;
in vec2 uv;
flat in vec4 color;
flat in vec4 halo;
flat in vec4 effects;
out vec4 fragColor;
float median3(vec3 v){return max(min(v.r,v.g),min(max(v.r,v.g),v.b));}
void main(){
 vec3 sampleValue=texture(atlasTexture,uv).rgb;
 // Distance data is linear RGB, never premultiplied/sRGB. Placements are CSS-pixel billboards.
 float sd=(median3(sampleValue)-0.5)*effects.x*text.viewport.z;
 bool outline=text.viewport.w<0.5;
 float h=effects.y*text.viewport.z;
 float coverage=outline?clamp(sd+h+0.5,0.,1.)-clamp(sd-h+0.5,0.,1.):clamp(sd+0.5,0.,1.);
 vec4 paint=outline?halo:color;
 if(outline&&effects.y<=0.)coverage=0.;
 float a=paint.a*coverage;if(a<=0.)discard;fragColor=vec4(paint.rgb*a,a);
}`;
const wgsl = `
struct Uniforms{viewport:vec4<f32>};
@group(0) @binding(0) var<uniform> text:Uniforms;
@group(0) @binding(1) var atlasTexture:texture_2d<f32>;
@group(0) @binding(2) var atlasSampler:sampler;
struct Out{@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) @interpolate(flat) color:vec4<f32>,@location(2) @interpolate(flat) halo:vec4<f32>,@location(3) @interpolate(flat) effects:vec4<f32>};
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) rectangle:vec4<f32>,@location(2) rotation:vec2<f32>,@location(3) atlasRect:vec4<f32>,@location(4) fillColor:vec4<f32>,@location(5) outlineColor:vec4<f32>,@location(6) parameters:vec4<f32>)->Out{
 var offset=corners*rectangle.zw*0.5;offset.x-=parameters.z*offset.y;
 let p=rectangle.xy+vec2<f32>(rotation.x*offset.x-rotation.y*offset.y,rotation.y*offset.x+rotation.x*offset.y);
 return Out(vec4<f32>(p/text.viewport.xy*vec2<f32>(2.,-2.)+vec2<f32>(-1.,1.),0.,1.),mix(atlasRect.xy,atlasRect.zw,(corners+1.)*0.5),fillColor,outlineColor,parameters);
}
fn median3(v:vec3<f32>)->f32{return max(min(v.r,v.g),min(max(v.r,v.g),v.b));}
@fragment fn fragmentMain(p:Out)->@location(0) vec4<f32>{
 let sampleValue=textureSample(atlasTexture,atlasSampler,p.uv).rgb;
 let sd=(median3(sampleValue)-0.5)*p.effects.x*text.viewport.z;
 let outline=text.viewport.w<0.5;
 let h=p.effects.y*text.viewport.z;
 var coverage=select(clamp(sd+0.5,0.,1.),clamp(sd+h+0.5,0.,1.)-clamp(sd-h+0.5,0.,1.),outline);
 let paint=select(p.color,p.halo,outline);
 if(outline&&p.effects.y<=0.){coverage=0.;}
 let a=paint.a*coverage;if(a<=0.){discard;}return vec4<f32>(paint.rgb*a,a);
}`;
type MsdfLabel = PlacedLabel & { raster: MsdfTextRaster };
interface Instance {
  label: MsdfLabel;
  glyph: MsdfGlyphQuad;
}
interface Page {
  texture: Texture;
  version: number;
}
interface Batch {
  buffer: Buffer;
  vao: VertexArray;
  bindings: [Bindings, Bindings];
  count: number;
  bytes: number;
}

/** One instance per shaped glyph, halo and fill in separate immutable uniform passes.
 * Default nonoverlapping labels batch together. Overlapping owners retain source-over order. */
export class MsdfTextRenderer {
  private shaders: Shader[] = [];
  private pipeline!: RenderPipeline;
  private quad!: Buffer;
  private uniforms: Buffer[] = [];
  private pages = new Map<MsdfAtlasPage, Page>();
  private groups: Batch[][] = [];
  private key = '';
  private size = '';
  private disposed = false;
  private layout!: ShaderLayout;
  private buffers!: BufferLayout[];
  readonly stats = {
    mode: 'msdf',
    drawCalls: 0,
    bufferUploads: 0,
    textureUploads: 0,
    liveTextureBytes: 0,
    liveBufferBytes: 0,
    glyphInstances: 0,
  };
  constructor(
    private readonly device: Device,
    private readonly backend: 'webgl' | 'webgpu',
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
      const attributes = [
        ['corners', 2],
        ['rectangle', 4],
        ['rotation', 2],
        ['atlasRect', 4],
        ['fillColor', 4],
        ['outlineColor', 4],
        ['parameters', 4],
      ] as const;
      this.layout = {
        attributes: attributes.map(([name, n], location) => ({
          name,
          location,
          type: `vec${n}<f32>` as 'vec2<f32>' | 'vec4<f32>',
          stepMode: location ? 'instance' : 'vertex',
        })),
        bindings: [
          { name: 'textUniforms', type: 'uniform', group: 0, location: 0, minBindingSize: 16 },
          { name: 'atlasTexture', type: 'texture', group: 0, location: 1 },
          ...(webgpu
            ? [{ name: 'atlasSampler', type: 'sampler' as const, group: 0, location: 2 }]
            : []),
        ],
      };
      let offset = 0;
      this.buffers = [
        { name: 'corners', format: 'float32x2', stepMode: 'vertex' },
        {
          name: 'glyphs',
          byteStride: 88,
          stepMode: 'instance',
          attributes: attributes.slice(1).map(([attribute, n]) => {
            const byteOffset = offset;
            offset += n * 4;
            return { attribute, format: `float32x${n}` as 'float32x2' | 'float32x4', byteOffset };
          }),
        },
      ];
      this.pipeline = device.createRenderPipeline({
        id: 'emap-msdf-glyphs',
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
      for (let i = 0; i < 2; i++)
        this.uniforms.push(
          device.createBuffer({ byteLength: 16, usage: Buffer.UNIFORM | Buffer.COPY_DST }),
        );
    } catch (e) {
      this.dispose();
      throw e;
    }
  }
  private page(source: MsdfAtlasPage): Page {
    let entry = this.pages.get(source);
    if (!entry) {
      entry = {
        texture: this.device.createTexture({
          width: source.width,
          height: source.height,
          format: 'rgba8unorm',
          sampler: {
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
          },
        }),
        version: -1,
      };
      this.pages.set(source, entry);
      this.stats.liveTextureBytes += source.data.byteLength;
    }
    if (entry.version !== source.version) {
      entry.texture.writeData(source.data, {
        width: source.width,
        height: source.height,
        bytesPerRow: source.width * 4,
      });
      entry.version = source.version;
      this.stats.textureUploads++;
    }
    return entry;
  }
  draw(pass: RenderPass, frame: LabelFrame, width: number, height: number, dpr: number): void {
    if (this.disposed) return;
    if (frame.key !== this.key) {
      this.clearBatches();
      const labels = frame.labels.filter((l): l is MsdfLabel => 'mode' in l.raster);
      const used = new Set(labels.flatMap((l) => l.raster.glyphs.map((g) => g.page)));
      for (const [source, p] of this.pages)
        if (!used.has(source)) {
          this.stats.liveTextureBytes -= p.texture.width * p.texture.height * 4;
          p.texture.destroy();
          this.pages.delete(source);
        }
      let grid = new LabelCollisionGrid(),
        group: MsdfLabel[] = [];
      const groups: MsdfLabel[][] = [];
      for (const label of labels) {
        if (grid.collides(label.bounds)) {
          groups.push(group);
          group = [];
          grid = new LabelCollisionGrid();
        }
        group.push(label);
        grid.insert(label.bounds);
      }
      if (group.length) groups.push(group);
      try {
        for (const labels of groups) {
          const runs = new Map<MsdfAtlasPage, Instance[]>();
          // This group has disjoint label bounds; page batching cannot change compositing.
          for (const label of labels)
            for (const glyph of label.raster.glyphs) {
              let run = runs.get(glyph.page);
              if (!run) {
                run = [];
                runs.set(glyph.page, run);
              }
              run.push({ label, glyph });
            }
          const batches: Batch[] = [];
          this.groups.push(batches);
          for (const run of runs.values()) batches.push(this.batch(run));
        }
        this.key = frame.key;
      } catch (e) {
        this.clearBatches();
        this.key = '';
        throw e;
      }
    }
    const size = `${width}:${height}:${dpr}`;
    if (size !== this.size) {
      for (let i = 0; i < 2; i++) this.uniforms[i].write(new Float32Array([width, height, dpr, i]));
      this.size = size;
    }
    pass.setPipeline(this.pipeline);
    for (const group of this.groups)
      for (const stage of [0, 1] as const)
        for (const batch of group) {
          pass.setBindings(batch.bindings[stage], {
            _bindGroupCacheKeys: { 0: batch.bindings[stage] },
          });
          pass.setVertexArray(batch.vao);
          if (pass.draw({ vertexCount: 6, instanceCount: batch.count, isInstanced: true }))
            this.stats.drawCalls++;
        }
  }
  private batch(instances: readonly Instance[]): Batch {
    const source = instances[0].glyph.page,
      page = this.page(source),
      data = new Float32Array(instances.length * 22);
    instances.forEach(({ label: l, glyph: g }, i) => {
      const [x, y, w, h] = g.plane,
        [u, v, uw, vh] = g.rect,
        c = Math.cos(l.angle),
        s = Math.sin(l.angle),
        r = l.raster;
      data.set(
        [
          l.x + c * x - s * y,
          l.y + s * x + c * y,
          w,
          h,
          c,
          s,
          u / source.width,
          v / source.height,
          (u + uw) / source.width,
          (v + vh) / source.height,
          ...r.color,
          ...r.haloColor,
          g.rangeCss,
          r.haloWidth,
          r.shear,
          0,
        ],
        i * 22,
      );
    });
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
          b = vao.getBufferSlot('glyphs');
        if (a === null || b === null) throw new Error('Missing MSDF buffer slots.');
        vao.setBuffer(a, this.quad);
        vao.setBuffer(b, buffer);
      } else {
        vao.setBuffer(0, this.quad);
        for (const location of [1, 2, 3, 4, 5, 6]) vao.setBuffer(location, buffer);
      }
      const bind = (u: Buffer): Bindings => ({
        textUniforms: u,
        atlasTexture: page.texture,
        ...(this.backend === 'webgpu' ? { atlasSampler: page.texture.sampler } : {}),
      });
      const bindings: [Bindings, Bindings] = [bind(this.uniforms[0]), bind(this.uniforms[1])];
      this.stats.bufferUploads++;
      this.stats.liveBufferBytes += data.byteLength;
      this.stats.glyphInstances += instances.length;
      return { buffer, vao, bindings, count: instances.length, bytes: data.byteLength };
    } catch (e) {
      vao?.destroy();
      buffer.destroy();
      throw e;
    }
  }
  private clearBatches(): void {
    for (const group of this.groups)
      for (const b of group) {
        b.vao.destroy();
        b.buffer.destroy();
        this.stats.liveBufferBytes -= b.bytes;
      }
    this.groups = [];
    this.stats.glyphInstances = 0;
  }
  clear(): void {
    this.clearBatches();
    this.key = '';
    for (const p of this.pages.values()) p.texture.destroy();
    this.pages.clear();
    this.stats.liveTextureBytes = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.pipeline?.destroy();
    this.quad?.destroy();
    for (const u of this.uniforms) u.destroy();
    for (const s of this.shaders) s.destroy();
    this.uniforms = [];
    this.shaders = [];
  }
}
