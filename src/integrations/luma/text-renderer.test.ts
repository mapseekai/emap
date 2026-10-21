import { expect, it, vi } from 'vitest';
import { GpuTextRenderer } from './text-renderer';
for (const backend of ['webgl', 'webgpu'] as const)
  it(`${backend}: bitmap label navigation reuses capacity and releases every owner`, () => {
    let glyphData: number[] = [];
    const resources: { destroy: ReturnType<typeof vi.fn> }[] = [];
    const object = () => {
      const r = { destroy: vi.fn() };
      resources.push(r);
      return r;
    };
    const device: any = {
      createShader: object,
      createRenderPipeline: object,
      createBuffer: (props: any) => ({
        ...object(),
        byteLength: props.byteLength ?? props.data?.byteLength ?? 0,
        write: vi.fn((data: Float32Array) => {
          if (props.id === 'emap-bitmap-label-instances') glyphData = Array.from(data);
        }),
      }),
      createTexture: (props: any) => ({
        ...object(),
        ...props,
        sampler: {},
        copyExternalImage: vi.fn(),
      }),
      createVertexArray: () => ({ ...object(), setBuffer: vi.fn(), getBufferSlot: () => 0 }),
    };
    const pass: any = {
      setPipeline: vi.fn(),
      setBindings: vi.fn(),
      setVertexArray: vi.fn(),
      draw: () => true,
    };
    const label: any = {
      x: 30,
      y: 30,
      angle: 0,
      raster: {
        page: { canvas: { width: 128, height: 128 }, version: 1 },
        rect: [1, 1, 20, 20],
        width: 20,
        height: 20,
      },
    };
    const renderer = new GpuTextRenderer(device, backend);
    renderer.draw(pass, { key: 'initial', labels: [label] }, 200, 200);
    const allocated = resources.length;
    for (let i = 0; i < 20; i++)
      renderer.draw(pass, { key: 'pan-' + i, labels: [{ ...label, x: 30 + i }] }, 200, 200);
    expect(resources.length).toBe(allocated);
    expect(renderer.stats.bufferAllocations).toBe(1);
    expect(renderer.stats.reusedBatches).toBe(20);
    expect(renderer.stats.textureUploads).toBe(1);
    renderer.draw(pass, { key: 'zoom-out', labels: [{ ...label, scale: 0.5 }] }, 200, 200);
    expect(glyphData.slice(0, 4)).toEqual([30, 30, 10, 10]);
    renderer.dispose();
    renderer.dispose();
    expect(renderer.stats.stagingBytes).toBe(0);
    expect(renderer.stats.liveBufferBytes).toBe(0);
    expect(resources.every((r) => r.destroy.mock.calls.length === 1)).toBe(true);
  });
