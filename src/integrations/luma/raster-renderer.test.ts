import { PerspectiveTransform } from '../../domain/geo/perspective-transform';
import { AffineTransform } from '../../domain/geo/transform';
import { describe, it, expect, vi } from 'vitest';
import { NumericRasterRenderer } from './raster-renderer';

function setup() {
  const copied: Uint16Array[] = [];
  const writes: unknown[] = [],
    copies: any[] = [];
  const textures: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const device = {
    commandEncoder: { copyTextureToTexture: (options: any) => copies.push(options) },
    submit: vi.fn(),
    isLost: false,
    limits: { maxTextureDimension2D: 16384 },
    destroy: vi.fn(),
    createTexture: vi.fn((options: any) => {
      const t = {
        ...options,
        destroy: vi.fn(),
        writeData: (a: Uint16Array, options: unknown) => {
          copied.push(a.slice());
          writes.push(options);
        },
      };
      textures.push(t);
      return t;
    }),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
  };
  // Exercise resource ownership without installing a default renderer or browser Device.
  const gpu = new (NumericRasterRenderer as any)(
    new EventTarget(),
    device,
    'webgl',
    vi.fn(),
  ) as NumericRasterRenderer;
  const tile: any = {
    key: '0:0:0',
    window: [0, 0, 2, 2],
    core: [0, 0, 2, 2],
    bounds: [0, 0, 2, 2],
  };
  return { gpu, device, copied, textures, tile, writes, copies };
}
describe('numeric raster upload memory ownership', () => {
  it('reuses one bounded scratch buffer and releases it with textures', () => {
    const { gpu, tile, copied, textures } = setup();
    const first = gpu.upload(tile, { width: 2, height: 2, data: [new Uint16Array(4).fill(65535)] });
    const second = gpu.upload(
      { ...tile, key: 'second' },
      { width: 2, height: 2, data: [new Uint16Array(4).fill(256)] },
    );
    expect(gpu.stats.packingAllocations).toBe(1);
    expect(gpu.stats.packingScratchBytes).toBe(32);
    expect(copied[0][0]).toBe(65535);
    expect(copied[1][0]).toBe(256);
    expect(copied[1][1]).toBe(0);
    expect(gpu.stats.liveTextureBytes).toBe(64);
    gpu.release(first);
    expect(gpu.stats.liveTextureBytes).toBe(32);
    gpu.dispose();
    gpu.dispose();
    expect(textures.every((t) => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(gpu.stats.liveTextureBytes).toBe(0);
    expect(gpu.stats.packingScratchBytes).toBe(0);
    expect(() =>
      gpu.upload(second.tile, { width: 2, height: 2, data: [new Uint16Array(4)] }),
    ).toThrow();
  });
  it('uploads UInt8 subwindows with row stride and copies exact integer halo borders', () => {
    const { gpu, tile, writes, copies, device } = setup();
    const a = { ...tile, key: 'a', level: { id: 0 }, core: [0, 0, 2, 2], window: [0, 0, 3, 2] };
    const b = { ...tile, key: 'b', level: { id: 0 }, core: [2, 0, 4, 2], window: [1, 0, 4, 2] };
    const data = new Uint8Array(4 * 2 * 4);
    const ta = gpu.uploadPrepared(a, { width: 4, height: 2, bits: 8, data }, [0, 0, 4, 2], true);
    const tb = gpu.uploadPrepared(b, { width: 4, height: 2, bits: 8, data }, [0, 0, 4, 2], true);
    expect(writes[1]).toMatchObject({
      x: 1,
      y: 0,
      width: 2,
      height: 2,
      byteOffset: 8,
      bytesPerRow: 16,
    });
    gpu.fillHalo(ta, [tb]);
    expect(copies[0]).toMatchObject({
      origin: [1, 0, 0],
      destinationOrigin: [2, 0, 0],
      width: 1,
      height: 2,
    });
    expect(device.submit).toHaveBeenCalledOnce();
    expect(gpu.stats.haloCopyBytes).toBe(8);
    expect(gpu.stats.packingScratchBytes).toBe(0);
    expect(gpu.stats.liveTextureBytes).toBe(48);
    gpu.dispose();
  });
  it('rejects an oversized window before allocating packing storage', () => {
    const { gpu, tile, device } = setup();
    expect(() =>
      gpu.upload(
        { ...tile, window: [0, 0, 4096, 4096] },
        { width: 1, height: 1, data: [new Uint16Array(1)] },
      ),
    ).toThrow();
    expect(gpu.stats.packingAllocations).toBe(0);
    expect(device.createTexture).not.toHaveBeenCalled();
    gpu.dispose();
  });
});

it('owns distinct deferred uniforms for disjoint perspective coverage and releases surplus slots', () => {
  const { gpu, device } = setup();
  const buffers: { destroy: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }[] = [];
  device.createBuffer = vi.fn(() => {
    const buffer = { destroy: vi.fn(), write: vi.fn() };
    buffers.push(buffer);
    return buffer;
  });
  const tile: any = {
    key: 'pose',
    core: [0, 0, 2, 2],
    window: [0, 0, 2, 2],
    bounds: [0, 0, 2, 2],
    level: { bits: [8, 8, 8], photometric: 2 },
  };
  const entry = gpu.upload(tile, {
    width: 2,
    height: 2,
    data: [new Uint8Array(4).fill(80), new Uint8Array(4).fill(160), new Uint8Array(4).fill(240)],
  });
  const pass = { setBindings: vi.fn(), draw: vi.fn(() => true) };
  const view = new PerspectiveTransform(new AffineTransform(20, -20, 100, 100), 200, 200, {
    pitch: 50,
    bearing: 35,
  });
  const method = Reflect.get(gpu, 'drawPerspectiveEntry');
  const draw = (regions: number[][]) =>
    method.call(
      gpu,
      pass,
      entry,
      view,
      200,
      200,
      250,
      250,
      { alphaBand: null, noData: null },
      { opacity: 0.5 },
      [0, 1, 2],
      [
        [0, 255],
        [0, 255],
        [0, 255],
      ],
      regions,
    );
  draw([
    [0, 0, 1, 2],
    [1, 0, 2, 2],
  ]);
  expect(gpu.stats.liveRegionUniforms).toBe(2);
  expect(pass.setBindings.mock.calls[0][0].rasterUniforms).not.toBe(
    pass.setBindings.mock.calls[1][0].rasterUniforms,
  );
  expect(buffers[1].write.mock.calls[0][0].byteLength).toBe(160);
  expect(buffers[2].write.mock.calls[0][0].slice(0, 4)).not.toEqual(
    buffers[1].write.mock.calls[0][0].slice(0, 4),
  );
  draw([[0, 0, 1, 2]]);
  expect(gpu.stats.liveRegionUniforms).toBe(1);
  expect(buffers[2].destroy).toHaveBeenCalledOnce();
  gpu.release(entry);
  expect(gpu.stats.liveRegionUniforms).toBe(0);
  gpu.dispose();
  expect(buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
});

it('cancels a lost WebGL context wait without recreating a disposed device', async () => {
  const { gpu, device } = setup();
  (device as any).gl = {};
  device.isLost = true;
  const event = new Event('webglcontextlost', { cancelable: true });
  gpu.canvas.dispatchEvent(event);
  await gpu.lost;
  expect(event.defaultPrevented).toBe(true);
  expect(gpu.available).toBe(false);
  const create = vi.spyOn(NumericRasterRenderer, 'create');
  const controller = new AbortController();
  const pending = gpu.recreate(controller.signal);
  const rejection = expect(pending).rejects.toThrow('cancelled');
  controller.abort(new Error('cancelled'));
  await rejection;
  gpu.canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(create).not.toHaveBeenCalled();
  expect(device.destroy).toHaveBeenCalledOnce();
  create.mockRestore();
});
