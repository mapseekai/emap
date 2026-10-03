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
layout(location=1) in vec4 pose;
layout(location=2) in vec2 extent;
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
 vec2 offset=corners*extent*0.5;offset.x-=parameters.z*offset.y;
 vec2 p=pose.xy+vec2(pose.z*offset.x-pose.w*offset.y,pose.w*offset.x+pose.z*offset.y);
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
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) pose:vec4<f32>,@location(2) extent:vec2<f32>,@location(3) atlasRect:vec4<f32>,@location(4) fillColor:vec4<f32>,@location(5) outlineColor:vec4<f32>,@location(6) parameters:vec4<f32>)->Out{
 var offset=corners*extent*0.5;offset.x-=parameters.z*offset.y;
 let p=pose.xy+vec2<f32>(pose.z*offset.x-pose.w*offset.y,pose.w*offset.x+pose.z*offset.y);
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
  poses: Buffer;
  vao: VertexArray;
  bindings: [Bindings, Bindings];
  count: number;
  bytes: number;
  hasHalo: boolean;
  instances: readonly Instance[];
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
  private groupStarts: number[] = [];
  private staging = new Float32Array(0);
  private poses = new Float32Array(0);
  private key: string | undefined;
  private generations = new Map<MsdfAtlasPage, number>();
  private size = '';
  private disposed = false;
  private layout!: ShaderLayout;
  private buffers!: BufferLayout[];
  readonly stats = {
    mode: 'msdf',
    drawCalls: 0,
    bufferUploads: 0,
    bufferUploadedBytes: 0,
    bufferAllocations: 0,
    reusedBatches: 0,
    stagingBytes: 0,
    textureUploads: 0,
    textureUploadedBytes: 0,
    liveTextureBytes: 0,
    liveBufferBytes: 0,
    glyphInstances: 0,
  };
  get memoryStats() {
    return {
      bufferBytes: this.disposed
        ? 0
        : this.stats.liveBufferBytes +
          (this.quad?.byteLength ?? 0) +
          this.uniforms.reduce((n, b) => n + b.byteLength, 0),
      textureBytes: this.stats.liveTextureBytes,
    };
  }
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
        ['pose', 4],
        ['extent', 2],
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
          name: 'poses',
          byteStride: 16,
          stepMode: 'instance',
          attributes: [{ attribute: 'pose', format: 'float32x4', byteOffset: 0 }],
        },
        {
          name: 'glyphs',
          byteStride: 72,
          stepMode: 'instance',
          attributes: attributes.slice(2).map(([attribute, n]) => {
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
      const updates = source.updates;
      let x = 0,
        y = 0,
        width = source.width,
        height = source.height;
      if (
        entry.version >= 0 &&
        updates?.length &&
        entry.version >= updates[0].version - 1 &&
        updates[updates.length - 1].version === source.version
      ) {
        let right = 0,
          bottom = 0;
        x = source.width;
        y = source.height;
        for (const update of updates)
          if (update.version > entry.version) {
            const [left, top, w, h] = update.rect;
            x = Math.min(x, left);
            y = Math.min(y, top);
            right = Math.max(right, left + w);
            bottom = Math.max(bottom, top + h);
          }
        width = right - x;
        height = bottom - y;
      }
      entry.texture.writeData(source.data, {
        x,
        y,
        width,
        height,
        byteOffset: (y * source.width + x) * 4,
        bytesPerRow: source.width * 4,
      });
      entry.version = source.version;
      this.stats.textureUploads++;
      this.stats.textureUploadedBytes += width * height * 4;
    }
    return entry;
  }
  draw(
    pass: RenderPass,
    frame: LabelFrame,
    width: number,
    height: number,
    dpr: number,
    start = 0,
    end = frame.labels.length,
  ): void {
    if (this.disposed) return;
    let changed = frame.key !== this.key;
    for (const [page, generation] of this.generations)
      if ((page.generation ?? 0) !== generation) changed = true;
    if (changed) {
      const candidates = frame.labels.filter((l): l is MsdfLabel => 'mode' in l.raster);
      this.generations.clear();
      for (const label of candidates)
        for (const glyph of label.raster.glyphs)
          this.generations.set(glyph.page, glyph.page.generation ?? 0);
      const reusable = this.groups.flat();
      let consumed = 0;
      this.groups = [];
      this.groupStarts = [];
      this.stats.glyphInstances = 0;
      try {
        // Recheck membership/collision and atlas generations even on camera-only
        // frames. Only GPU storage is reused; stale placements are never retained.
        const labels = candidates.filter((l) =>
          l.raster.glyphs.every((g) => (g.generation ?? 0) === (g.page.generation ?? 0)),
        );
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
        const indices = new Map(frame.labels.map((label, index) => [label, index]));
        let previous = -1;
        for (const label of labels) {
          const index = indices.get(label)!;
          if (group.length && (index !== previous + 1 || grid.collides(label.bounds))) {
            groups.push(group);
            group = [];
            grid = new LabelCollisionGrid();
          }
          if (!group.length) this.groupStarts.push(index);
          group.push(label);
          grid.insert(label.bounds);
          previous = index;
        }
        if (group.length) groups.push(group);
        for (const labels of groups) {
          const runs = new Map<MsdfAtlasPage, Instance[]>();
          for (const label of labels)
            for (const glyph of label.raster.glyphs) {
              let run = runs.get(glyph.page);
              if (!run) runs.set(glyph.page, (run = []));
              run.push({ label, glyph });
            }
          const batches: Batch[] = [];
          this.groups.push(batches);
          for (const run of runs.values()) {
            const old = reusable[consumed];
            const batch = this.batch(run, old);
            consumed++;
            batches.push(batch);
            if (old && old !== batch) this.releaseBatches([old]);
          }
        }
        this.key = frame.key;
      } catch (error) {
        this.key = undefined;
        this.clearBatches();
        throw error;
      } finally {
        this.releaseBatches(reusable.slice(consumed));
      }
    }
    const size = `${width}:${height}:${dpr}`;
    if (size !== this.size) {
      for (let i = 0; i < 2; i++) this.uniforms[i].write(new Float32Array([width, height, dpr, i]));
      this.size = size;
    }
    pass.setPipeline(this.pipeline);
    let low = 0,
      high = start === 0 ? 0 : this.groupStarts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.groupStarts[mid] < start) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < this.groups.length && this.groupStarts[i] < end; i++) {
      const group = this.groups[i];
      for (const stage of [0, 1] as const)
        for (const batch of group) {
          if (stage === 0 && !batch.hasHalo) continue;
          pass.setBindings(batch.bindings[stage], {
            _bindGroupCacheKeys: { 0: batch.bindings[stage] },
          });
          pass.setVertexArray(batch.vao);
          if (pass.draw({ vertexCount: 6, instanceCount: batch.count, isInstanced: true }))
            this.stats.drawCalls++;
        }
    }
  }
  private batch(instances: readonly Instance[], previous?: Batch): Batch {
    const source = instances[0].glyph.page,
      page = this.page(source);
    const bytes = instances.length * 88;
    const reuse = previous && previous.bytes >= bytes ? previous : undefined;
    const sameStatic =
      reuse?.instances.length === instances.length &&
      instances.every(
        (instance, i) =>
          instance.glyph === reuse.instances[i].glyph &&
          instance.label.raster === reuse.instances[i].label.raster,
      );
    const length = instances.length * 18,
      poseLength = instances.length * 4;
    if (!sameStatic && this.staging.length < length) this.staging = new Float32Array(length);
    if (this.poses.length < poseLength) this.poses = new Float32Array(poseLength);
    this.stats.stagingBytes = this.staging.byteLength + this.poses.byteLength;
    const data = this.staging.subarray(0, length),
      poses = this.poses.subarray(0, poseLength);
    const hasHalo = instances.some(({ label }) => label.raster.haloWidth > 0);
    let last: MsdfLabel | undefined,
      c = 1,
      sine = 0;
    for (let i = 0; i < instances.length; i++) {
      const { label: l, glyph: g } = instances[i];
      if (l !== last) {
        c = Math.cos(l.angle);
        sine = Math.sin(l.angle);
        last = l;
      }
      const [x, y, w, h] = g.plane,
        [u, v, uw, vh] = g.rect,
        r = l.raster;
      const pose = i * 4;
      poses[pose] = l.x + c * x - sine * y;
      poses[pose + 1] = l.y + sine * x + c * y;
      poses[pose + 2] = c;
      poses[pose + 3] = sine;
      if (!sameStatic) {
        const at = i * 18;
        data[at] = w;
        data[at + 1] = h;
        data[at + 2] = u / source.width;
        data[at + 3] = v / source.height;
        data[at + 4] = (u + uw) / source.width;
        data[at + 5] = (v + vh) / source.height;
        data.set(r.color, at + 6);
        data.set(r.haloColor, at + 10);
        data[at + 14] = g.rangeCss;
        data[at + 15] = r.haloWidth;
        data[at + 16] = r.shear;
        data[at + 17] = 0;
      }
    }
    const buffer =
      reuse?.buffer ??
      this.device.createBuffer({
        id: 'emap-msdf-glyphs',
        byteLength: data.byteLength,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      });
    let vao = reuse?.vao,
      poseBuffer = reuse?.poses;
    try {
      poseBuffer ??= this.device.createBuffer({
        id: 'emap-msdf-poses',
        byteLength: poses.byteLength,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      });
      // Both adapters consume writes synchronously. One staging allocation can
      // serve every run without being retained in Buffer initialization props.
      poseBuffer.write(poses);
      this.stats.bufferUploads++;
      this.stats.bufferUploadedBytes += poses.byteLength;
      if (!sameStatic) {
        buffer.write(data);
        this.stats.bufferUploads++;
        this.stats.bufferUploadedBytes += data.byteLength;
      }
      if (!vao) {
        vao = this.device.createVertexArray({
          shaderLayout: this.layout,
          bufferLayout: this.buffers,
        });
        if (this.backend === 'webgpu') {
          const a = vao.getBufferSlot('corners'),
            b = vao.getBufferSlot('glyphs'),
            c = vao.getBufferSlot('poses');
          if (a === null || b === null || c === null) throw new Error('Missing MSDF buffer slots.');
          vao.setBuffer(a, this.quad);
          vao.setBuffer(b, buffer);
          vao.setBuffer(c, poseBuffer);
        } else {
          vao.setBuffer(0, this.quad);
          vao.setBuffer(1, poseBuffer);
          for (const location of [2, 3, 4, 5, 6]) vao.setBuffer(location, buffer);
        }
      }
      const bind = (u: Buffer): Bindings => ({
        textUniforms: u,
        atlasTexture: page.texture,
        ...(this.backend === 'webgpu' ? { atlasSampler: page.texture.sampler } : {}),
      });
      const bindings: [Bindings, Bindings] =
        reuse?.bindings[0].atlasTexture === page.texture
          ? reuse.bindings
          : [bind(this.uniforms[0]), bind(this.uniforms[1])];
      this.stats.glyphInstances += instances.length;
      if (reuse) {
        this.stats.reusedBatches++;
        reuse.bindings = bindings;
        reuse.count = instances.length;
        reuse.hasHalo = hasHalo;
        if (!sameStatic) reuse.instances = instances;
        return reuse;
      }
      this.stats.bufferAllocations += 2;
      this.stats.liveBufferBytes += bytes;
      return {
        buffer,
        poses: poseBuffer,
        vao,
        bindings,
        count: instances.length,
        bytes,
        hasHalo,
        instances,
      };
    } catch (error) {
      if (!reuse) {
        try {
          vao?.destroy();
        } finally {
          try {
            poseBuffer?.destroy();
          } finally {
            buffer.destroy();
          }
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
      try {
        b.poses.destroy();
      } catch (error) {
        errors.push(error);
      }
      this.stats.liveBufferBytes -= b.bytes;
    }
    if (errors.length) throw new AggregateError(errors, 'MSDF batch cleanup failed');
  }
  private clearBatches(): void {
    const batches = this.groups.flat();
    this.groups = [];
    this.stats.glyphInstances = 0;
    this.releaseBatches(batches);
  }
  clear(): void {
    this.staging = new Float32Array(0);
    this.poses = new Float32Array(0);
    this.stats.stagingBytes = 0;
    this.clearBatches();
    this.key = undefined;
    this.generations.clear();
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
