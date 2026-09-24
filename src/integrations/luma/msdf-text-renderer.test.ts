import { describe, expect, it, vi } from 'vitest';
import { MsdfTextRenderer } from './msdf-text-renderer';
function setup() {
  const resources: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const object = () => {
    const o = { destroy: vi.fn() };
    resources.push(o);
    return o;
  };
  const device: any = {
    createShader: () => object(),
    createRenderPipeline: () => object(),
    createBuffer: () => ({ ...object(), write: vi.fn() }),
    createTexture: () => ({
      ...object(),
      width: 1024,
      height: 1024,
      sampler: {},
      writeData: vi.fn(),
    }),
    createVertexArray: () => ({ ...object(), setBuffer: vi.fn(), getBufferSlot: () => 0 }),
  };
  const pass: any = {
    setPipeline: vi.fn(),
    setBindings: vi.fn(),
    setVertexArray: vi.fn(),
    draw: vi.fn(() => true),
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
  return { device, pass, page, label, resources };
}
describe('MSDF pass resource ownership', () => {
  for (const backend of ['webgl', 'webgpu'] as const)
    it(`${backend}: shares numeric texture and keeps separate halo/fill bindings`, () => {
      const f = setup(),
        r = new MsdfTextRenderer(f.device, backend);
      r.draw(f.pass, { key: 'a', labels: [f.label] }, 100, 100, 1);
      expect(r.stats.textureUploads).toBe(1);
      expect(r.stats.glyphInstances).toBe(1);
      expect(f.pass.draw.mock.calls.every((c) => c[0].isInstanced)).toBe(true);
      expect(f.pass.setBindings.mock.calls[0][0].textUniforms).not.toBe(
        f.pass.setBindings.mock.calls[1][0].textUniforms,
      );
      r.draw(f.pass, { key: 'a', labels: [f.label] }, 100, 100, 1);
      expect(r.stats.bufferUploads).toBe(1);
      r.draw(
        f.pass,
        { key: 'b', labels: [{ ...f.label, raster: { ...f.label.raster, color: [0, 0, 1, 1] } }] },
        100,
        100,
        2,
      );
      expect(r.stats.textureUploads).toBe(1);
      expect(r.stats.bufferUploads).toBe(2);
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
    );
    expect(r.stats.drawCalls).toBe(4);
    r.dispose();
  });
});

it('does not sample recycled atlas glyphs when a previous navigation frame is replayed', () => {
  const f = setup(),
    renderer = new MsdfTextRenderer(f.device, 'webgl');
  const page = f.page as typeof f.page & { generation: number };
  page.generation = 0;
  f.label.raster.glyphs[0].generation = 0;
  const frame = { key: 'navigation', labels: [f.label] };
  renderer.draw(f.pass, frame, 100, 100, 1);
  expect(renderer.stats.glyphInstances).toBe(1);
  page.generation = 1;
  page.version++;
  renderer.draw(f.pass, frame, 100, 100, 1);
  expect(renderer.stats.glyphInstances).toBe(0);
  f.label.raster.glyphs[0].generation = 1;
  renderer.draw(f.pass, { key: 'new', labels: [f.label] }, 100, 100, 1);
  expect(renderer.stats.glyphInstances).toBe(1);
  renderer.dispose();
});
