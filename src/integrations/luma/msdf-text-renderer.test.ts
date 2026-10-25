import { describe, expect, it, vi } from 'vitest';
import type { RenderPass } from '@luma.gl/core';
import { MsdfTextRenderer } from './msdf-text-renderer';
import type { MsdfAtlasPage } from '../../engine/rendering/labels/text-types';
function setup() {
  const framebuffer = { width: 100, height: 100 };
  const resources: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const object = () => {
    const o = { destroy: vi.fn() };
    resources.push(o);
    return o;
  };
  const device: any = {
    createShader: () => object(),
    createRenderPipeline: () => object(),
    createBuffer: (props: any) => ({
      ...object(),
      byteLength: props.byteLength ?? props.data?.byteLength ?? 0,
      write: vi.fn(),
    }),
    createTexture: () => ({
      ...object(),
      width: 1024,
      height: 1024,
      sampler: {},
      writeData: vi.fn(),
    }),
    createVertexArray: () => ({ ...object(), setBuffer: vi.fn(), getBufferSlot: () => 0 }),
  };
  const draw = vi.fn<RenderPass['draw']>(() => true);
  const pass: any = {
    setPipeline: vi.fn(),
    setBindings: vi.fn(),
    setVertexArray: vi.fn(),
    draw,
  };
  const page = { data: new Uint8Array(1024 * 1024 * 4), width: 1024, height: 1024, version: 1 };
  const raster: any = {
    mode: 'msdf',
    width: 20,
    height: 20,
    color: [1, 0, 1, 1],
    haloColor: [1, 1, 1, 1],
    haloWidth: 2,
    shear: 0,
    glyphs: [{ page, rect: [1, 1, 64, 64], plane: [0, 0, 20, 20], rangeCss: 8 }],
  };
  const label: any = {
    ownerId: 'a',
    featureId: 0,
    text: 'A',
    x: 40,
    y: 40,
    angle: 0,
    bounds: [20, 20, 60, 60],
    raster,
  };
  return { device, pass, draw, page, label, resources, framebuffer };
}
for (const backend of ['webgl', 'webgpu'] as const)
  it(`${backend}: updates actual backing dimensions without rebuilding cached glyphs`, () => {
    const f = setup();
    f.framebuffer.width = 124;
    f.framebuffer.height = 126;
    const renderer = new MsdfTextRenderer(f.device, backend);
    const frame = { key: 'fractional-dpr', labels: [f.label] };
    renderer.draw(f.pass, frame, 95, 97, 1.3, f.framebuffer);
    const uniforms = f.pass.setBindings.mock.calls.map(
      ([bindings]: any[]) => bindings.textUniforms,
    );
    expect(uniforms).toHaveLength(2);
    for (const [stage, uniform] of uniforms.entries()) {
      expect(uniform.byteLength).toBe(32);
      expect(uniform.write.mock.calls[0][0]).toEqual(
        new Float32Array([95, 97, 1.3, stage, 124, 126, 0, 0]),
      );
    }
    const uploads = renderer.stats.bufferUploads;
    f.framebuffer.width = 125;
    renderer.draw(f.pass, frame, 95, 97, 1.3, f.framebuffer);
    expect(renderer.stats.bufferUploads).toBe(uploads);
    for (const [stage, uniform] of uniforms.entries()) {
      expect(uniform.write).toHaveBeenCalledTimes(2);
      expect(uniform.write.mock.calls[1][0]).toEqual(
        new Float32Array([95, 97, 1.3, stage, 125, 126, 0, 0]),
      );
    }
    renderer.dispose();
  });

describe('MSDF pass resource ownership', () => {
  for (const backend of ['webgl', 'webgpu'] as const)
    it(`${backend}: shares numeric texture and keeps separate halo/fill bindings`, () => {
      const f = setup(),
        r = new MsdfTextRenderer(f.device, backend);
      r.draw(f.pass, { key: 'a', labels: [f.label] }, 100, 100, 1, f.framebuffer);
      expect(r.stats.textureUploads).toBe(1);
      expect(r.stats.glyphInstances).toBe(1);
      expect(f.draw.mock.calls.every(([props]) => props.isInstanced)).toBe(true);
      expect(f.pass.setBindings.mock.calls[0][0].textUniforms).not.toBe(
        f.pass.setBindings.mock.calls[1][0].textUniforms,
      );
      r.draw(f.pass, { key: 'a', labels: [f.label] }, 100, 100, 1, f.framebuffer);
      expect(r.stats.bufferUploads).toBe(2);
      r.draw(
        f.pass,
        { key: 'b', labels: [{ ...f.label, raster: { ...f.label.raster, color: [0, 0, 1, 1] } }] },
        100,
        100,
        2,
        f.framebuffer,
      );
      expect(r.stats.textureUploads).toBe(1);
      expect(r.stats.bufferUploads).toBe(4);
      r.dispose();
      r.dispose();
      expect(r.stats.liveTextureBytes).toBe(0);
      expect(r.stats.liveBufferBytes).toBe(0);
      expect(f.resources.every((r) => r.destroy.mock.calls.length === 1)).toBe(true);
    });
  it('keeps overlapping labels in separate source-over groups', () => {
    const f = setup(),
      r = new MsdfTextRenderer(f.device, 'webgl');
    r.draw(
      f.pass,
      { key: 'overlap', labels: [f.label, { ...f.label, ownerId: 'b' }] },
      100,
      100,
      1,
      f.framebuffer,
    );
    expect(r.stats.drawCalls).toBe(4);
    r.dispose();
  });
});

for (const backend of ['webgl', 'webgpu'] as const) {
  it(`${backend}: scales glyph positions, extents and distance effects without replacing the font atlas`, () => {
    const f = setup(),
      writes = new Map<string, number[]>(),
      create = f.device.createBuffer;
    f.device.createBuffer = (props: any) => {
      const buffer = create(props);
      buffer.write = (data: Float32Array) => writes.set(props.id, Array.from(data));
      return buffer;
    };
    f.label.raster.glyphs[0].plane = [4, -6, 20, 24];
    const renderer = new MsdfTextRenderer(f.device, backend);
    renderer.draw(f.pass, { key: 'initial', labels: [f.label] }, 100, 100, 1, f.framebuffer);
    renderer.draw(
      f.pass,
      { key: 'zoom-out', labels: [{ ...f.label, scale: 0.5 }] },
      100,
      100,
      1,
      f.framebuffer,
    );
    expect(writes.get('emap-msdf-poses')!.slice(0, 2)).toEqual([42, 37]);
    const glyph = writes.get('emap-msdf-glyphs')!;
    expect(glyph.slice(0, 2)).toEqual([10, 12]);
    expect(glyph.slice(14, 16)).toEqual([4, 1]);
    expect(renderer.stats.textureUploads).toBe(1);
    expect(renderer.stats.bufferAllocations).toBe(2);
    renderer.dispose();
  });
  it(`${backend}: unchanged frames inspect atlas generations without scanning glyphs`, () => {
    const f = setup(),
      renderer = new MsdfTextRenderer(f.device, backend);
    const frame = { key: 'cached', labels: [f.label] };
    renderer.draw(f.pass, frame, 100, 100, 1, f.framebuffer);
    const quads = f.label.raster.glyphs;
    Object.defineProperty(f.label.raster, 'glyphs', { configurable: true, get: () => quads });
    const glyphs = vi.spyOn(f.label.raster, 'glyphs', 'get');
    renderer.draw(f.pass, frame, 100, 100, 1, f.framebuffer);
    expect(glyphs).not.toHaveBeenCalled();
    renderer.clear();
    renderer.draw(f.pass, frame, 100, 100, 1, f.framebuffer);
    expect(renderer.stats.glyphInstances).toBe(1);
    expect(glyphs).toHaveBeenCalled();
    renderer.dispose();
  });
  it(`${backend}: camera replay uploads poses without resending glyph UVs and paint`, () => {
    const f = setup(),
      writes: number[] = [];
    const create = f.device.createBuffer;
    f.device.createBuffer = (props: unknown) => {
      const buffer = create(props),
        write = buffer.write;
      buffer.write = (data: ArrayBufferView) => {
        writes.push(data.byteLength);
        write(data);
      };
      return buffer;
    };
    const renderer = new MsdfTextRenderer(f.device, backend);
    renderer.draw(f.pass, { key: 'first', labels: [f.label] }, 100, 100, 1, f.framebuffer);
    writes.length = 0;
    renderer.draw(
      f.pass,
      { key: 'pan', labels: [{ ...f.label, x: 50 }] },
      100,
      100,
      1,
      f.framebuffer,
    );
    expect(writes).toEqual([16]);
    renderer.dispose();
  });
  it(`${backend}: skips the outline draw when a batch has no halo`, () => {
    const f = setup(),
      r = new MsdfTextRenderer(f.device, backend);
    f.label.raster.haloWidth = 0;
    r.draw(f.pass, { key: 'no-halo', labels: [f.label] }, 100, 100, 1, f.framebuffer);
    expect(f.pass.draw).toHaveBeenCalledOnce();
    r.dispose();
  });
  it(`${backend}: uploads changed atlas regions independently for each consumer`, () => {
    const f = setup();
    const textures: { writeData: ReturnType<typeof vi.fn> }[] = [];
    const create = f.device.createTexture;
    f.device.createTexture = (...args: unknown[]) => {
      const texture = create(...args);
      textures.push(texture);
      return texture;
    };
    const a = new MsdfTextRenderer(f.device, backend),
      b = new MsdfTextRenderer(f.device, backend);
    const page: MsdfAtlasPage = f.page;
    for (const renderer of [a, b])
      renderer.draw(f.pass, { key: 'first', labels: [f.label] }, 100, 100, 1, f.framebuffer);
    page.version = 3;
    page.updates = [
      { version: 2, rect: [8, 16, 20, 30] },
      { version: 3, rect: [20, 30, 24, 20] },
    ];
    for (const renderer of [a, b])
      renderer.draw(f.pass, { key: 'next', labels: [f.label] }, 100, 100, 1, f.framebuffer);
    for (const texture of textures)
      expect(texture.writeData.mock.calls[1][1]).toEqual({
        x: 8,
        y: 16,
        width: 36,
        height: 34,
        byteOffset: (16 * 1024 + 8) * 4,
        bytesPerRow: 4096,
      });
    // A consumer that missed the bounded update history must receive the whole page.
    page.version = 100;
    page.updates = [{ version: 100, rect: [1, 1, 4, 4] }];
    a.draw(f.pass, { key: 'missed', labels: [f.label] }, 100, 100, 1, f.framebuffer);
    expect(textures[0].writeData.mock.calls[2][1]).toMatchObject({
      x: 0,
      y: 0,
      width: 1024,
      height: 1024,
    });
    a.dispose();
    b.dispose();
  });
}

it('does not sample recycled atlas glyphs when a previous navigation frame is replayed', () => {
  const f = setup(),
    renderer = new MsdfTextRenderer(f.device, 'webgl');
  const page = f.page as typeof f.page & { generation: number };
  page.generation = 0;
  f.label.raster.glyphs[0].generation = 0;
  const frame = { key: 'navigation', labels: [f.label] };
  renderer.draw(f.pass, frame, 100, 100, 1, f.framebuffer);
  expect(renderer.stats.glyphInstances).toBe(1);
  page.generation = 1;
  page.version++;
  renderer.draw(f.pass, frame, 100, 100, 1, f.framebuffer);
  expect(renderer.stats.glyphInstances).toBe(0);
  f.label.raster.glyphs[0].generation = 1;
  renderer.draw(f.pass, { key: 'new', labels: [f.label] }, 100, 100, 1, f.framebuffer);
  expect(renderer.stats.glyphInstances).toBe(1);
  renderer.dispose();
});

for (const backend of ['webgl', 'webgpu'] as const)
  it(`${backend}: navigation rewrites existing glyph buffers without reallocating buffers or VAOs`, () => {
    const f = setup(),
      r = new MsdfTextRenderer(f.device, backend);
    r.draw(f.pass, { key: 'first', labels: [f.label] }, 200, 200, 1, f.framebuffer);
    const allocated = f.resources.length,
      bytes = r.stats.liveBufferBytes;
    for (let i = 0; i < 20; i++)
      r.draw(
        f.pass,
        { key: 'pan-' + i, labels: [{ ...f.label, x: 40 + i }] },
        200,
        200,
        1,
        f.framebuffer,
      );
    expect(f.resources.length).toBe(allocated);
    expect(r.stats.liveBufferBytes).toBe(bytes);
    expect(r.stats.bufferAllocations).toBe(2);
    expect(r.stats.reusedBatches).toBe(20);
    expect(r.stats.textureUploads).toBe(1);
    r.dispose();
    expect(r.stats.stagingBytes).toBe(0);
    expect(f.resources.every((resource) => resource.destroy.mock.calls.length === 1)).toBe(true);
  });

it('grows a glyph buffer only when necessary and releases unused batches after membership shrinks', () => {
  const f = setup(),
    r = new MsdfTextRenderer(f.device, 'webgl');
  r.draw(f.pass, { key: 'one', labels: [f.label] }, 200, 200, 1, f.framebuffer);
  const second = { ...f.label, x: 100, bounds: [80, 20, 120, 60] };
  r.draw(f.pass, { key: 'two', labels: [f.label, second] }, 200, 200, 1, f.framebuffer);
  const allocated = f.resources.length;
  r.draw(f.pass, { key: 'back', labels: [f.label] }, 200, 200, 1, f.framebuffer);
  expect(f.resources.length).toBe(allocated);
  expect(r.stats.glyphInstances).toBe(1);
  expect(r.stats.bufferAllocations).toBe(4);
  r.draw(f.pass, { key: 'none', labels: [] }, 200, 200, 1, f.framebuffer);
  expect(r.stats.liveBufferBytes).toBe(0);
  r.dispose();
  expect(f.resources.every((resource) => resource.destroy.mock.calls.length === 1)).toBe(true);
});
