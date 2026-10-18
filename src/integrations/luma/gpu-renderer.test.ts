import type { GeometryBuffer } from './types';
import { describe, expect, it, vi } from 'vitest';
import { GpuRenderer } from './gpu-renderer';

describe('nonblocking navigation completion probes', () => {
  it('observes a WebGL fence immediately after JS resumes and owns no polling timer', () => {
    vi.useFakeTimers();
    const fence = {};
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      ALREADY_SIGNALED: 2,
      CONDITION_SATISFIED: 3,
      TIMEOUT_EXPIRED: 4,
      WAIT_FAILED: 5,
      fenceSync: vi.fn(() => fence),
      flush: vi.fn(),
      deleteSync: vi.fn(),
      clientWaitSync: vi.fn().mockReturnValueOnce(4).mockReturnValue(2),
    };
    const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { type: 'webgl', gl },
      disposed: false,
      lost: false,
    });
    try {
      const probe = renderer.probeCompletion();
      expect(probe.poll()).toBe('pending');
      vi.advanceTimersByTime(150);
      expect(probe.poll()).toBe('complete');
      expect(gl.clientWaitSync).toHaveBeenLastCalledWith(fence, 0, 0);
      probe.dispose();
      probe.dispose();
      expect(gl.deleteSync).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(probe.poll()).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores late WebGPU callbacks after cancellation and reports failed probes as unavailable', async () => {
    let complete!: () => void;
    const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: {
        type: 'webgpu',
        handle: {
          queue: {
            onSubmittedWorkDone: () =>
              new Promise<void>((r) => {
                complete = r;
              }),
          },
        },
      },
      disposed: false,
      lost: false,
    });
    const probe = renderer.probeCompletion();
    expect(probe.poll()).toBe('pending');
    probe.dispose();
    complete();
    await Promise.resolve();
    expect(probe.poll()).toBe('unavailable');
    Reflect.get(renderer, 'device').handle.queue.onSubmittedWorkDone = () =>
      Promise.reject(new Error('device lost'));
    const failed = renderer.probeCompletion();
    await Promise.resolve();
    expect(failed.poll()).toBe('unavailable');
  });
});

describe('GPU allocation failure cleanup', () => {
  it('releases the vertex buffer if the following index allocation fails', () => {
    const vertex = { destroy: vi.fn(), write: vi.fn() };
    const createBuffer = vi
      .fn()
      .mockReturnValueOnce(vertex)
      .mockImplementationOnce(() => {
        throw new Error('out of memory');
      });
    // Exercise resource bookkeeping without constructing a DOM/WebGL device.
    const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { createBuffer },
      meshes: new Set(),
      disposed: false,
      lost: false,
      stats: { uploads: 0, uploadedBytes: 0, liveBufferBytes: 0 },
    });
    expect(() =>
      renderer.createMesh({
        kind: 'fill',
        vertices: new Float32Array(12),
        indices: new Uint32Array([0, 1, 2]),
        count: 3,
      }),
    ).toThrow('out of memory');
    expect(vertex.destroy).toHaveBeenCalledOnce();
    expect(renderer.stats.uploads).toBe(0);
    expect(renderer.stats.liveBufferBytes).toBe(0);
  });
  it('uploads without retaining geometry arrays in buffer initialization props', () => {
    const vertex = { write: vi.fn(), destroy: vi.fn() };
    const index = { write: vi.fn(), destroy: vi.fn() };
    const createBuffer = vi.fn().mockReturnValueOnce(vertex).mockReturnValueOnce(index);
    const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { createBuffer },
      meshes: new Set(),
      disposed: false,
      lost: false,
      stats: { uploads: 0, uploadedBytes: 0, liveBufferBytes: 0 },
    });
    const vertices = new Float32Array(12),
      indices = new Uint32Array([0, 1, 2]);
    const mesh = renderer.createMesh({ kind: 'fill', vertices, indices, count: 3 });
    expect(createBuffer.mock.calls[0][0]).not.toHaveProperty('data');
    expect(createBuffer.mock.calls[1][0]).not.toHaveProperty('data');
    expect(vertex.write).toHaveBeenCalledWith(vertices);
    expect(index.write).toHaveBeenCalledWith(indices);
    expect(renderer.stats.liveBufferBytes).toBe(60);
    renderer.destroyMesh(mesh!);
    expect(vertex.destroy).toHaveBeenCalledOnce();
    expect(index.destroy).toHaveBeenCalledOnce();
    expect(renderer.stats.liveBufferBytes).toBe(0);
  });
  it('releases both buffers if the index upload fails', () => {
    const vertex = { write: vi.fn(), destroy: vi.fn() };
    const index = {
      write: vi.fn(() => {
        throw new Error('upload failed');
      }),
      destroy: vi.fn(),
    };
    const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { createBuffer: vi.fn().mockReturnValueOnce(vertex).mockReturnValueOnce(index) },
      meshes: new Set(),
      disposed: false,
      lost: false,
      stats: { uploads: 0, liveBufferBytes: 0 },
    });
    expect(() =>
      renderer.createMesh({
        kind: 'fill',
        vertices: new Float32Array(12),
        indices: new Uint32Array([0, 1, 2]),
        count: 3,
      }),
    ).toThrow('upload failed');
    expect(vertex.destroy).toHaveBeenCalledOnce();
    expect(index.destroy).toHaveBeenCalledOnce();
    expect(renderer.stats.uploads).toBe(0);
  });
});

describe('opaque point run scheduling', () => {
  function fixture() {
    const pass = {
      setPipeline: vi.fn(),
      setBindings: vi.fn(),
      setVertexArray: vi.fn(),
      setParameters: vi.fn(),
      draw: vi.fn((_options: Record<string, unknown>) => true),
    };
    const a = {
      kind: 'point' as const,
      buffer: { destroy: vi.fn() } as unknown as import('@luma.gl/core').Buffer,
      count: 10,
      bytes: 160,
    };
    const b = {
      kind: 'point' as const,
      buffer: { destroy: vi.fn() } as unknown as import('@luma.gl/core').Buffer,
      count: 20,
      bytes: 320,
    };
    const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { type: 'webgl' },
      pass,
      meshes: new Set([a, b]),
      fullScissor: true,
      pixelRatio: 1.25,
      circleOptimizationEnabled: true,
      circleQueue: [],
      queuedCircleGroup: null,
      pointGroup: null,
      pointDepthDirty: false,
      pipelines: new Map(
        ['point', 'circle', 'circle-core', 'circle-edge', 'point-depth-reset'].map((k) => [
          k,
          { pipeline: k },
        ]),
      ),
      vertexArray: vi.fn(() => ({ destroy: vi.fn() })),
      style: vi.fn(() => ({ bindings: {} })),
      stats: {
        drawCalls: 0,
        circleCoreDraws: 0,
        circleEdgeDraws: 0,
        pointDepthResets: 0,
        liveBufferBytes: 480,
      },
    });
    const flush = () => Reflect.get(renderer, 'flushCircles').call(renderer);
    return { renderer, pass, a, b, flush };
  }
  const blue = { color: [0, 0, 1, 1] as [number, number, number, number], radius: 3 };
  it('classifies a whole multi-chunk run before drawing any fringe, keeping every instance', () => {
    const { renderer, pass, a, b, flush } = fixture();
    renderer.drawMesh(a, blue);
    renderer.drawMesh(b, blue);
    expect(pass.draw).not.toHaveBeenCalled();
    flush();
    expect(pass.setPipeline.mock.calls.map((c) => c[0])).toEqual([
      'circle-core',
      'circle-core',
      'circle-edge',
      'circle-edge',
    ]);
    expect(pass.draw.mock.calls.map((c) => c[0])).toEqual(
      [10, 20, 10, 20].map((instanceCount) => ({
        vertexCount: 4,
        instanceCount,
        isInstanced: true,
      })),
    );
    expect(renderer.stats.circleCoreDraws).toBe(2);
    expect(renderer.stats.circleEdgeDraws).toBe(2);
  });
  it('does not defer or approximate partial opacity', () => {
    const { renderer, pass, a, flush } = fixture();
    renderer.drawMesh(a, { ...blue, color: [0, 0, 1, 0.99] });
    flush();
    expect(pass.setPipeline).toHaveBeenCalledExactlyOnceWith('circle');
    expect(pass.draw).toHaveBeenCalledTimes(1);
  });
  it('clears coverage at color barriers while preserving the existing color attachment', () => {
    const { renderer, pass, a, b, flush } = fixture();
    renderer.drawMesh(a, blue);
    renderer.drawMesh(b, { ...blue, color: [1, 0, 0, 1] });
    flush();
    expect(pass.setPipeline.mock.calls.map((c) => c[0])).toEqual([
      'circle-core',
      'circle-edge',
      'point-depth-reset',
      'circle-core',
      'circle-edge',
    ]);
    expect(pass.setParameters.mock.calls).toEqual([[{ colorMask: 0 }], [{ colorMask: 15 }]]);
  });
  it('flushes pending commands before their buffer is destroyed', () => {
    const { renderer, pass, a } = fixture();
    renderer.drawMesh(a, blue);
    renderer.destroyMesh(a);
    expect(pass.draw).toHaveBeenCalledTimes(2);
    expect(a.buffer.destroy).toHaveBeenCalledOnce();
    expect(renderer.stats.liveBufferBytes).toBe(320);
  });
  it('keeps the generic six-vertex path for non-circular markers', () => {
    const { renderer, pass, a } = fixture();
    renderer.drawMesh(a, { ...blue, marker: [-1, -1, 1, -1, 0, 1] });
    expect(pass.setPipeline).toHaveBeenCalledExactlyOnceWith('point');
    expect(pass.draw).toHaveBeenCalledExactlyOnceWith({
      vertexCount: 6,
      instanceCount: 10,
      isInstanced: true,
    });
  });
});

describe('full precision solid path scheduling', () => {
  function fixture() {
    const pass = {
      setPipeline: vi.fn(),
      setBindings: vi.fn(),
      setVertexArray: vi.fn(),
      setParameters: vi.fn(),
      draw: vi.fn(() => true),
    };
    const a = {
      kind: 'path',
      count: 12,
      bytes: 400,
      buffer: { destroy: vi.fn() },
      pathMsaaVertexArray: { destroy: vi.fn() },
    };
    const b = {
      ...a,
      count: 40,
      buffer: { destroy: vi.fn() },
      pathMsaaVertexArray: { destroy: vi.fn() },
    };
    const renderer = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { type: 'webgl' },
      pass,
      meshes: new Set([a, b]),
      fullScissor: true,
      circleQueue: [],
      pathMode: 'auto',
      pathSamples: 4,
      pointGroup: null,
      pointDepthDirty: false,
      pipelines: new Map(
        ['path', 'path-msaa', 'path-msaa-reference'].map((k) => [k, { pipeline: k }]),
      ),
      vertexArray: vi.fn(() => ({ destroy: vi.fn() })),
      style: vi.fn(() => ({ bindings: {} })),
      resetPointDepth: vi.fn(),
      stats: { drawCalls: 0, pathMsaaDraws: 0, liveBufferBytes: 800 },
    }) as GpuRenderer;
    return { renderer, pass, a: a as any, b: b as any };
  }
  const paint = { color: [0, 0.5, 0.4, 1] as [number, number, number, number], width: 1.2 };
  it('uses the six-vertex indexed envelope for every original instance and reuses its vertex array', () => {
    const { renderer, pass, a } = fixture();
    renderer.drawMesh(a, paint);
    renderer.drawMesh(a, paint);
    expect(pass.draw).toHaveBeenCalledTimes(2);
    expect(pass.draw).toHaveBeenLastCalledWith({
      indexCount: 12,
      instanceCount: 12,
      isInstanced: true,
    });
    expect(Reflect.get(renderer, 'vertexArray')).not.toHaveBeenCalled();
    expect(Reflect.get(renderer, 'resetPointDepth')).not.toHaveBeenCalled();
  });
  it('resets coverage across different colors without merging or reordering them', () => {
    const { renderer, pass, a, b } = fixture();
    renderer.drawMesh(a, paint);
    renderer.drawMesh(b, paint);
    expect(Reflect.get(renderer, 'resetPointDepth')).not.toHaveBeenCalled();
    renderer.drawMesh(a, { ...paint, color: [1, 0, 0, 1] });
    expect(Reflect.get(renderer, 'resetPointDepth')).toHaveBeenCalledOnce();
    expect(pass.draw.mock.calls.map((c) => c[0].instanceCount)).toEqual([12, 40, 12]);
  });
  it('restores the standard route for dashes, translucent strokes and missing MSAA', () => {
    const { renderer, pass, a } = fixture();
    renderer.drawMesh(a, paint);
    renderer.drawMesh(a, { ...paint, dash: [4, 3] });
    renderer.drawMesh(a, { ...paint, color: [0, 0.5, 1, 0.4] });
    Reflect.set(renderer, 'pathSamples', 0);
    renderer.drawMesh(a, paint);
    expect(pass.setPipeline.mock.calls.map((c) => c[0])).toEqual([
      'path-msaa',
      'path',
      'path',
      'path',
    ]);
  });
  it('uses identical geometry in reference mode without writing private coverage depth', () => {
    const { renderer, pass, a } = fixture();
    renderer.pathMode = 'reference';
    renderer.drawMesh(a, paint);
    expect(pass.setPipeline).toHaveBeenCalledExactlyOnceWith('path-msaa-reference');
    expect(Reflect.get(renderer, 'pointDepthDirty')).toBe(false);
  });
  it('filters immutable path ranges with cached offset bindings on WebGL', () => {
    const { renderer, pass, a } = fixture();
    renderer.drawMesh(a, paint, [{ firstInstance: 4, count: 3 }]);
    renderer.drawMesh(a, paint, [{ firstInstance: 4, count: 2 }]);
    expect(Reflect.get(renderer, 'vertexArray')).toHaveBeenCalledTimes(1);
    expect(pass.draw).toHaveBeenLastCalledWith({
      indexCount: 12,
      instanceCount: 2,
      isInstanced: true,
      firstInstance: 0,
    });
    const vao = a.rangeVertexArrays.values().next().value;
    renderer.destroyMesh(a);
    expect(vao.destroy).toHaveBeenCalledOnce();
  });
  it('uses firstInstance on WebGPU without a new buffer/VAO or changing path order', () => {
    const { renderer, pass, a } = fixture();
    Reflect.set(renderer, 'device', { type: 'webgpu' });
    renderer.drawMesh(a, paint, [
      { firstInstance: 2, count: 3 },
      { firstInstance: 9, count: 2 },
    ]);
    expect(pass.draw.mock.calls.map((c) => [c[0].firstInstance, c[0].instanceCount])).toEqual([
      [2, 3],
      [9, 2],
    ]);
    expect(Reflect.get(renderer, 'vertexArray')).not.toHaveBeenCalled();
  });
  it('releases the cached indexed path vertex array once', () => {
    const { renderer, a } = fixture();
    renderer.destroyMesh(a);
    renderer.destroyMesh(a);
    expect(a.pathMsaaVertexArray.destroy).toHaveBeenCalledOnce();
    expect(a.buffer.destroy).toHaveBeenCalledOnce();
  });
});

it('isolates screen-space path uniforms from source-coordinate edit uniforms', () => {
  const writes: Float32Array[] = [];
  const renderer = Object.assign(Object.create(GpuRenderer.prototype), {
    frame: 1,
    width: 200,
    height: 100,
    frameData: Float32Array.from({ length: 60 }, (_, i) => i + 10),
    styles: new Map(),
    device: { createBuffer: () => ({ write: (v: Float32Array) => writes.push(v.slice()) }) },
    stats: { uniformWrites: 0 },
  });
  const style = Reflect.get(renderer, 'style');
  style.call(renderer, 'path-msaa', { color: [0, 1, 0, 1], width: 1, screenSpace: true });
  style.call(renderer, 'path-msaa', { color: [0, 1, 0, 1], width: 1 });
  expect([...writes[0].slice(0, 6)]).toEqual([100, 50, 0, 0, 1, 1]);
  expect([...writes[1].slice(0, 6)]).toEqual([10, 11, 12, 13, 14, 15]);
  expect([...writes[0].slice(48, 50)]).toEqual([1, 1]);
  expect([...writes[1].slice(48, 50)]).toEqual([58, 59]);
  expect([...writes[0].slice(52, 56)]).toEqual([1, 0, 1, 0]);
  expect([...writes[1].slice(52, 56)]).toEqual([62, 63, 64, 65]);
  expect(writes.every((v) => v.byteLength === 240)).toBe(true);
});

it('forgets the editor bitmap texture and its obsolete bindings without double release', () => {
  const texture = { width: 40, height: 20, destroy: vi.fn() },
    image = {} as ImageBitmap,
    uniform = { destroy: vi.fn() };
  const renderer: any = Object.assign(Object.create(GpuRenderer.prototype), {
    images: new Map([[image, { texture }]]),
    styles: new Map([['image:editor', { buffer: uniform, images: new Map([[texture, {}]]) }]]),
    stats: { liveTextureBytes: 3200, liveTextures: 1 },
  });
  renderer.forgetImage(image);
  renderer.forgetImage(image);
  expect(texture.destroy).toHaveBeenCalledOnce();
  expect(uniform.destroy).toHaveBeenCalledOnce();
  expect(renderer.stats.liveTextures).toBe(0);
  expect(renderer.stats.liveTextureBytes).toBe(0);
  expect(renderer.styles.size).toBe(0);
});

it('writes both independent projection scales on every frame, including mirrored/nonuniform views', () => {
  const data = new Float32Array(60);
  const renderer = Object.assign(Object.create(GpuRenderer.prototype), {
    end: vi.fn(),
    frame: 0,
    width: 641,
    height: 479,
    pixelRatio: 1.25,
    frameData: data,
    stats: { frames: 0 },
    device: {
      type: 'webgl',
      isLost: false,
      canvasContext: { getCurrentFramebuffer: () => ({ colorAttachments: [] }) },
      beginRenderPass: vi.fn(() => ({})),
    },
    canvas: { width: 801, height: 599 },
  }) as GpuRenderer;
  const view = {
    mx: 1e7 + 0.375,
    my: -9e6 - 0.25,
    bx: 0,
    by: 0,
    unproject: (x: number, y: number) => [110.123456789 + x / 1e7, 30.987654321 + y / 9e6],
    clone() {
      return this;
    },
  };
  expect(renderer.begin(view as any)).toBe(true);
  expect([...data.slice(48, 50)]).toEqual([...data.slice(4, 6)]);
  expect(data[46]).toBe(1.25);
  view.mx = -32768.25;
  view.my = 16384.5;
  renderer.begin(view as any);
  expect([...data.slice(48, 50)]).toEqual([-32768.25, 16384.5]);
});

describe('raster scissor coordinate origins', () => {
  for (const backend of ['webgl', 'webgpu'] as const)
    for (const [width, height] of [
      [200, 100],
      [641, 479],
    ])
      for (const dpr of [1, 1.25, 2]) {
        it(`${backend} ${width}x${height} DPR ${dpr}: clips an off-center image in the backend coordinate system`, async () => {
          const { AffineTransform } = await import('../../domain/geo/transform');
          const pass = {
            setParameters: vi.fn(),
            setPipeline: vi.fn(),
            setBindings: vi.fn(),
            setVertexArray: vi.fn(),
            draw: vi.fn(() => true),
          };
          const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
            device: { type: backend },
            pass,
            canvas: { width: Math.round(width * dpr), height: Math.round(height * dpr) },
            width,
            height,
            pixelRatio: dpr,
            transform: new AffineTransform(1, -1, 0, 100),
            flushCircles: vi.fn(),
            imageTexture: vi.fn(() => ({ texture: {}, smoothing: true })),
            style: vi.fn(() => ({ buffer: {}, images: new Map() })),
            linear: {},
            nearest: {},
            imageVertexArray: {},
            pipelines: new Map([['image', { pipeline: {} }]]),
            stats: { drawCalls: 0 },
          });
          renderer.drawImage({} as HTMLCanvasElement, [20, 10, 100, 70], 1, true, [25, 20, 95, 65]);
          const rx = Math.round(width * dpr) / width,
            ry = Math.round(height * dpr) / height;
          const top = Math.round(35 * ry),
            bottom = Math.round(80 * ry);
          expect(pass.setParameters).toHaveBeenCalledWith({
            scissorRect: [
              Math.round(25 * rx),
              backend === 'webgpu' ? top : Math.round(height * dpr) - bottom,
              Math.round(95 * rx) - Math.round(25 * rx),
              bottom - top,
            ],
          });
          expect(pass.draw).toHaveBeenCalledOnce();
          const style = Reflect.get(renderer, 'style');
          const rect = style.mock.calls[0][2];
          for (let i = 0; i < 4; i++) {
            const ratio = i % 2 ? ry : rx;
            expect(rect[i] * ratio).toBeCloseTo(Math.round([20, 30, 100, 90][i] * ratio), 10);
          }
        });
      }
});

describe('point icon GPU submission', () => {
  it('uses the resident point buffer as instanced data and releases its additional vertex binding', () => {
    const mesh: any = { kind: 'point', count: 7, bytes: 112, buffer: { destroy: vi.fn() } };
    const pass = {
      setPipeline: vi.fn(),
      setBindings: vi.fn(),
      setParameters: vi.fn(),
      setVertexArray: vi.fn(),
      draw: vi.fn(() => true),
    };
    const texture = {},
      vao = { destroy: vi.fn() },
      vertexArray = vi.fn(() => vao),
      style = vi.fn(() => ({ buffer: {}, images: new Map() }));
    const r: any = Object.assign(Object.create(GpuRenderer.prototype), {
      pass,
      meshes: new Set([mesh]),
      canvas: { width: 800, height: 600 },
      circleQueue: [],
      device: { type: 'webgl' },
      linear: {},
      pipelines: new Map([['icon', { pipeline: 'icon' }]]),
      imageTexture: vi.fn(() => ({ texture, smoothing: true })),
      style,
      vertexArray,
      stats: { drawCalls: 0, iconDrawCalls: 0, iconFrameInstances: 0, liveBufferBytes: 112 },
    });
    const icon: any = {
      asset: { image: {}, width: 64, height: 64 },
      size: [32, 32],
      anchor: [0.5, 1],
      offset: [0, 0],
      angle: 0,
      rect: [0, 0, 64, 64],
      color: [1, 1, 1, 1],
    };
    r.drawPointIcons(mesh, icon);
    r.drawPointIcons(mesh, icon);
    expect(vertexArray).toHaveBeenCalledOnce();
    expect(vertexArray).toHaveBeenCalledWith('icon', mesh.buffer);
    expect(pass.draw).toHaveBeenCalledWith({ vertexCount: 6, instanceCount: 7, isInstanced: true });
    expect(r.stats.iconFrameInstances).toBe(14);
    r.destroyMesh(mesh);
    expect(vao.destroy).toHaveBeenCalledOnce();
    expect(mesh.buffer.destroy).toHaveBeenCalledOnce();
    expect(r.stats.liveBufferBytes).toBe(0);
  });
});

it('releases icon style bindings when a shared image texture is evicted', () => {
  const texture = { width: 64, height: 64, destroy: vi.fn() },
    style = { buffer: { destroy: vi.fn() }, images: new Map([[texture, {}]]) };
  const renderer: any = Object.assign(Object.create(GpuRenderer.prototype), {
    styles: new Map([['icon:test', style]]),
    stats: { liveTextureBytes: 16384, liveTextures: 1 },
  });
  renderer.destroyImage({ texture });
  expect(texture.destroy).toHaveBeenCalledOnce();
  expect(style.buffer.destroy).toHaveBeenCalledOnce();
  expect(renderer.styles.size).toBe(0);
  expect(renderer.stats.liveTextureBytes).toBe(0);
});

function indexFixture(backend: 'webgl' | 'webgpu') {
  const allocations: {
    byteLength: number;
    indexType?: string;
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const device = {
    type: backend,
    createBuffer: vi.fn((props) => {
      const buffer = {
        ...props,
        write: vi.fn((value) => {
          if (backend === 'webgpu' && value.byteLength % 4) throw new Error('unaligned upload');
        }),
        destroy: vi.fn(),
      };
      allocations.push(buffer);
      return buffer;
    }),
  };
  const pass = {
    draw: vi.fn(() => true),
    setPipeline: vi.fn(),
    setBindings: vi.fn(),
    setVertexArray: vi.fn(),
  };
  // Only the allocation/draw ABI is mocked. Browser tests cover actual luma adapters.
  const gpu = Object.create(GpuRenderer.prototype) as GpuRenderer;
  Object.assign(gpu, {
    device,
    pass,
    meshes: new Set(),
    fullScissor: true,
    pipelines: new Map([['fill', { pipeline: {} }]]),
    style: () => ({ bindings: {} }),
    vertexArray: () => ({ destroy: vi.fn() }),
    flushCircles: () => {},
    stats: {
      uploads: 0,
      uploadedBytes: 0,
      liveBufferBytes: 0,
      drawCalls: 0,
      fillFrameCandidates: 0,
      fillFrameSubmitted: 0,
    },
  });
  return { gpu, allocations, pass };
}
describe('portable fill index ABI', () => {
  for (const backend of ['webgl', 'webgpu'] as const) {
    it(`${backend}: pads odd uint16 uploads but never draws padding or retains CPU data`, () => {
      const f = indexFixture(backend);
      const indices = Uint16Array.from([99, 0, 1, 2, 99]).subarray(1, 4);
      const g: GeometryBuffer = { kind: 'fill', vertices: new Float32Array(12), indices, count: 3 };
      const mesh = f.gpu.createMesh(g)!;
      expect(f.allocations[1].indexType).toBe('uint16');
      expect(f.allocations[1].byteLength).toBe(8);
      expect(f.allocations[1].write.mock.calls[0][0]).toEqual(Uint16Array.from([0, 1, 2, 0]));
      expect(f.allocations[1]).not.toHaveProperty('data');
      expect(mesh.bytes).toBe(56);
      f.gpu.drawMesh(mesh, { color: [1, 0, 0, 1] });
      expect(f.pass.draw.mock.calls[0][0].indexCount).toBe(3);
      f.gpu.destroyMesh(mesh);
      expect(f.gpu.stats.liveBufferBytes).toBe(0);
      for (const allocation of f.allocations) expect(allocation.destroy).toHaveBeenCalledOnce();
    });
    for (const ArrayType of [Uint16Array, Uint32Array]) {
      it(`${backend}: ${ArrayType.name} uses the correct indexed draw offset`, () => {
        const f = indexFixture(backend);
        const mesh = f.gpu.createMesh({
          kind: 'fill',
          vertices: new Float32Array(24),
          indices: ArrayType.from([0, 1, 2, 3, 4, 5]),
          count: 6,
        })!;
        f.gpu.drawMesh(mesh, { color: [1, 0, 0, 1] }, undefined, [
          { firstIndex: 3, indexCount: 3 },
        ]);
        expect(f.pass.draw).toHaveBeenCalledExactlyOnceWith({ firstIndex: 3, indexCount: 3 });
      });
    }
  }
});

describe('pooled resident draw spans', () => {
  for (const backend of ['webgl', 'webgpu'] as const) {
    const setup = () => {
      const draw = vi.fn((_options: Record<string, number | boolean>) => true);
      const pass = {
        draw,
        setPipeline: vi.fn(),
        setBindings: vi.fn(),
        setVertexArray: vi.fn(),
        setParameters: vi.fn(),
      };
      const createBuffer = vi.fn((props: { byteLength: number }) => ({
        ...props,
        write: vi.fn(),
        destroy: vi.fn(),
      }));
      const renderer: GpuRenderer = Object.assign(Object.create(GpuRenderer.prototype), {
        device: { type: backend, createBuffer },
        meshPagesEnabled: true,
        meshes: new Set(),
        disposed: false,
        lost: false,
        fullScissor: true,
        pass,
        circleQueue: [],
        pathMode: 'auto',
        pathSamples: 4,
        pointDepthDirty: false,
        pointGroup: null,
        pipelines: new Map([
          ['fill', { pipeline: 'fill' }],
          ['path-msaa-compact', { pipeline: 'compact' }],
        ]),
        style: () => ({ bindings: {} }),
        vertexArray: vi.fn(() => ({ destroy: vi.fn() })),
        stats: {
          uploads: 0,
          uploadedBytes: 0,
          liveBufferBytes: 0,
          drawCalls: 0,
          fillFrameCandidates: 0,
          fillFrameSubmitted: 0,
          pathMsaaDraws: 0,
        },
      });
      return { renderer, pass, createBuffer };
    };
    it(`${backend}: merges only adjacent slices, excludes a retired middle feature and counts real triangles`, () => {
      const { renderer, pass } = setup();
      const g = {
        kind: 'fill' as const,
        vertices: new Float32Array(12),
        indices: new Uint16Array([0, 1, 2]),
        count: 3,
      };
      const a = renderer.createMesh(g, 's')!,
        b = renderer.createMesh(g, 's')!,
        c = renderer.createMesh(g, 's')!;
      const paint = { color: [1, 0, 0, 0.5] as [number, number, number, number] };
      renderer.drawMeshSequence(
        [a, b, c].map((mesh) => ({ mesh })),
        paint,
      );
      expect(pass.draw).toHaveBeenCalledTimes(1);
      expect(pass.draw.mock.calls[0][0].indexCount).toBe(15);
      expect(renderer.stats.fillFrameSubmitted).toBe(3);
      pass.draw.mockClear();
      renderer.drawMesh(b, paint);
      expect(pass.draw).toHaveBeenCalledExactlyOnceWith({
        firstIndex: b.firstIndex,
        indexCount: 3,
      });
      renderer.destroyMesh(b);
      pass.draw.mockClear();
      renderer.drawMeshSequence(
        [a, c].map((mesh) => ({ mesh })),
        paint,
      );
      expect(pass.draw).toHaveBeenCalledTimes(2);
      const d = renderer.createMesh(g, 's')!;
      expect(d.firstIndex).toBe(b.firstIndex);
      pass.draw.mockClear();
      renderer.drawMeshSequence(
        [a, d, c].map((mesh) => ({ mesh })),
        paint,
      );
      expect(pass.draw).toHaveBeenCalledTimes(1);
      renderer.destroyMesh(a);
      renderer.destroyMesh(c);
      renderer.destroyMesh(d);
      expect(renderer.stats.liveBufferBytes).toBe(0);
      expect(renderer.pageStats.pages).toBe(0);
    });
    it(`${backend}: compact slice offsets remain correct when drawing individually or as a run`, () => {
      const { renderer, pass } = setup();
      const g = {
        kind: 'path' as const,
        compactStroke: true,
        vertices: new Float32Array(16),
        count: 1,
      };
      const a = renderer.createMesh(g, 's')!,
        b = renderer.createMesh(g, 's')!;
      const paint = { color: [1, 0, 0, 1] as [number, number, number, number], width: 2 };
      renderer.drawMesh(b, paint);
      expect(pass.draw.mock.calls[0][0].firstInstance ?? 0).toBe(backend === 'webgpu' ? 1 : 0);
      pass.draw.mockClear();
      renderer.drawMeshSequence(
        [a, b].map((mesh) => ({ mesh })),
        paint,
      );
      expect(pass.draw).toHaveBeenCalledTimes(1);
      expect(pass.draw.mock.calls[0][0].instanceCount).toBe(2);
      renderer.destroyMesh(a);
      renderer.destroyMesh(b);
      expect(renderer.stats.liveBufferBytes).toBe(0);
    });
  }
});

it('a retired mesh never suppresses other resident commands in the same ordered scope', () => {
  const { gpu, pass } = indexFixture('webgl');
  const geometry: GeometryBuffer = {
    kind: 'fill',
    vertices: new Float32Array(12),
    indices: new Uint16Array([0, 1, 2]),
    count: 3,
  };
  const retired = gpu.createMesh(geometry)!,
    live = gpu.createMesh(geometry)!;
  gpu.destroyMesh(retired);
  gpu.drawMeshSequence([{ mesh: retired }, { mesh: live }], { color: [1, 0, 0, 1] });
  expect(pass.draw).toHaveBeenCalledOnce();
  gpu.destroyMesh(live);
  expect(gpu.stats.liveBufferBytes).toBe(0);
});

it('physical page ordering is restricted to opaque solid MSAA path scopes', () => {
  const { gpu } = indexFixture('webgl');
  const plans: { orderOpaque: boolean }[] = [];
  Object.assign(gpu, {
    strokeBatchingEnabled: true,
    pathMode: 'auto',
    pathSamples: 4,
    runMeshPlan: (p: { orderOpaque: boolean }) => plans.push(p),
  });
  const m = gpu.createMesh({ kind: 'path', vertices: new Float32Array(28), count: 1 })!;
  for (const [opacity, dash] of [
    [1, undefined],
    [0.5, undefined],
    [1, [2, 3]],
  ] as const) {
    gpu.drawMeshSequence([{ mesh: m }], { color: [1, 0, 0, opacity], width: 2, dash });
  }
  gpu.pathMode = 'legacy';
  gpu.drawMeshSequence([{ mesh: m }], { color: [1, 0, 0, 1], width: 2 });
  expect(plans.map((p) => !!p.orderOpaque)).toEqual([true, false, false, false]);
  gpu.destroyMesh(m);
  expect(gpu.stats.liveBufferBytes).toBe(0);
});

describe('bounded GPU style and image lifetimes', () => {
  function lifetime(backend: 'webgl' | 'webgpu' = 'webgl') {
    const allocations: any[] = [];
    const createBuffer = vi.fn((props) => {
      const buffer = { byteLength: props.byteLength, write: vi.fn(), destroy: vi.fn() };
      allocations.push(buffer);
      return buffer;
    });
    const createTexture = vi.fn((props) => ({
      ...props,
      destroy: vi.fn(),
      writeData: vi.fn(),
      setSampler: vi.fn(),
    }));
    const g: any = Object.assign(Object.create(GpuRenderer.prototype), {
      device: {
        type: backend,
        createBuffer,
        createTexture,
        submit: vi.fn(),
        limits: { maxTextureDimension2D: 4096 },
      },
      styles: new Map(),
      images: new Map(),
      dashes: new Map(),
      meshes: new Set(),
      pipelines: new Map(),
      frameData: new Float32Array(60),
      frame: 0,
      width: 800,
      height: 600,
      nearest: {},
      linear: {},
      circleQueue: [],
      stats: { uniformWrites: 0, liveBufferBytes: 0, liveTextureBytes: 0, liveTextures: 0 },
    });
    const end = () => {
      g.pass = { end: vi.fn() };
      g.end();
    };
    return { g, end, allocations };
  }
  it('retires inactive uniforms after submission instead of retaining historical paints', () => {
    const { g, end, allocations } = lifetime();
    for (let i = 1; i <= 1000; i++) {
      g.frame = i;
      g.style('point', { color: [0, 0, 1, 1], radius: i });
      end();
      expect(g.styles.size).toBe(1);
    }
    expect(allocations.filter((b) => !b.destroy.mock.calls.length)).toHaveLength(1);
    g.frame++;
    end();
    expect(g.styles.size).toBe(0);
    expect(allocations.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('keeps a style marked by native replay, then retires it after its plan ends', () => {
    const { g, end } = lifetime('webgpu');
    g.frame = 1;
    const paint = { color: [1, 0, 0, 1] };
    const style = g.style('fill', paint);
    end();
    g.frame++;
    const ordering: string[] = [];
    g.commandCache = { end: () => ordering.push('retire-plans') };
    g.device.submit = () => ordering.push('submit');
    style.buffer.destroy.mockImplementation(() => ordering.push('destroy-uniform'));
    expect(g.style('fill', paint)).toBe(style);
    end();
    expect(style.buffer.destroy).not.toHaveBeenCalled();
    g.frame++;
    end();
    expect(ordering.slice(-3)).toEqual(['retire-plans', 'submit', 'destroy-uniform']);
  });
  it('releases old dash textures along with inactive dash paints', () => {
    const { g, end } = lifetime();
    for (let i = 1; i <= 40; i++) {
      g.frame = i;
      g.style('path', { color: [0, 0, 1, 1], dash: [i, 3] });
      end();
      expect(g.dashes.size).toBe(1);
    }
    g.frame++;
    end();
    expect(g.dashes.size).toBe(0);
  });
  it('automatic texture eviction removes image bindings even after forgetImage can no longer find it', () => {
    const { g, end } = lifetime();
    const texture = { width: 40, height: 20, destroy: vi.fn() },
      image = {};
    const uniform = { destroy: vi.fn() };
    g.frame = 3;
    g.images.set(image, { texture, frame: 2, immutable: false });
    g.styles.set('image:test', { frame: 3, buffer: uniform, images: new Map([[texture, {}]]) });
    g.stats.liveTextures = 1;
    g.stats.liveTextureBytes = 3200;
    end();
    g.forgetImage(image);
    expect(texture.destroy).toHaveBeenCalledOnce();
    expect(uniform.destroy).toHaveBeenCalledOnce();
    expect(g.styles.size).toBe(0);
  });
  it('accounts style buffers and framebuffer attachments separately from geometry', () => {
    const { g } = lifetime('webgpu');
    g.style('fill', { color: [1, 0, 0, 1] });
    g.msaaTexture = { width: 800, height: 600, samples: 4 };
    g.pointDepthTexture = { width: 800, height: 600, samples: 4 };
    expect(g.memoryStats.styleUniformBytes).toBe(240);
    expect(g.memoryStats.attachmentNominalBytes).toBe(800 * 600 * 4 * 4 * 2);
    expect(g.memoryStats.geometryBufferBytes).toBe(0);
  });
});

it('destroys remaining GPU resources and the device even if ending a pass or a buffer destroy fails', () => {
  const bad = {
    destroy: vi.fn(() => {
      throw new Error('buffer destroy failed');
    }),
  };
  const good = { destroy: vi.fn() };
  const mesh: any = { kind: 'fill', buffer: bad, indices: good, bytes: 60, count: 3 };
  const device: any = { type: 'webgl', destroy: vi.fn(), gl: { getExtension: () => null } };
  const g: any = Object.assign(Object.create(GpuRenderer.prototype), {
    device,
    canvas: { removeEventListener: vi.fn() },
    pass: {
      end: vi.fn(() => {
        throw new Error('pass end failed');
      }),
    },
    circleQueue: [],
    meshes: new Set([mesh]),
    images: new Map(),
    dashes: new Map(),
    pipelines: new Map(),
    styles: new Map(),
    stats: { liveBufferBytes: 60 },
    quad: { destroy: vi.fn() },
  });
  expect(() => g.dispose()).toThrow();
  expect(bad.destroy).toHaveBeenCalledOnce();
  expect(good.destroy).toHaveBeenCalledOnce();
  expect(g.quad.destroy).toHaveBeenCalledOnce();
  expect(device.destroy).toHaveBeenCalledOnce();
  expect(g.meshes.size).toBe(0);
  expect(g.disposed).toBe(true);
  expect(() => g.dispose()).not.toThrow();
});

for (const backend of ['webgl', 'webgpu'] as const)
  it(`${backend}: repeated images reuse bindings and sampler changes remain explicit`, async () => {
    const { AffineTransform } = await import('../../domain/geo/transform');
    const pass = {
      setParameters: vi.fn(),
      setPipeline: vi.fn(),
      setBindings: vi.fn(),
      setVertexArray: vi.fn(),
      draw: vi.fn(() => true),
    };
    const texture = { setSampler: vi.fn() };
    const imageEntry = { texture, smoothing: true };
    const style = { buffer: {}, images: new Map() };
    const g: any = Object.assign(Object.create(GpuRenderer.prototype), {
      device: { type: backend },
      pass,
      canvas: { width: 200, height: 100 },
      width: 200,
      height: 100,
      transform: new AffineTransform(1, -1, 0, 100),
      flushCircles: vi.fn(),
      imageTexture: () => imageEntry,
      style: () => style,
      linear: {},
      nearest: {},
      imageVertexArray: {},
      pipelines: new Map([['image', { pipeline: {} }]]),
      stats: { drawCalls: 0 },
    });
    const image = {};
    for (let i = 0; i < 3; i++) g.drawImage(image, [20, 10, 100, 70]);
    expect(new Set(pass.setBindings.mock.calls.map((call) => call[0])).size).toBe(1);
    g.drawImage(image, [20, 10, 100, 70], 1, false);
    expect(texture.setSampler).toHaveBeenLastCalledWith(g.nearest);
    if (backend === 'webgpu')
      expect(pass.setBindings.mock.lastCall![0].imageSampler).toBe(g.nearest);
    else expect(pass.setBindings.mock.lastCall![0]).toBe(pass.setBindings.mock.calls[0][0]);
  });

it('clearImages releases a shared image uniform once across multiple textures', () => {
  const uniform = { destroy: vi.fn() },
    a = { width: 1, height: 1, destroy: vi.fn() },
    b = { width: 1, height: 1, destroy: vi.fn() };
  const g: any = Object.assign(Object.create(GpuRenderer.prototype), {
    images: new Map([
      [{}, { texture: a }],
      [{}, { texture: b }],
    ]),
    styles: new Map([
      [
        'image:shared',
        {
          buffer: uniform,
          images: new Map([
            [a, {}],
            [b, {}],
          ]),
        },
      ],
    ]),
    stats: { liveTextureBytes: 8, liveTextures: 2 },
  });
  g.clearImages();
  expect(uniform.destroy).toHaveBeenCalledOnce();
  expect(a.destroy).toHaveBeenCalledOnce();
  expect(b.destroy).toHaveBeenCalledOnce();
  expect(g.styles.size).toBe(0);
  expect(g.stats.liveTextures).toBe(0);
});

for (const backend of ['webgl', 'webgpu'] as const)
  it(`${backend}: uploads owned RGBA pixels directly, not through an external canvas`, () => {
    const texture = {
      width: 3,
      height: 2,
      copyExternalImage: vi.fn(),
      writeData: vi.fn(),
      destroy: vi.fn(),
    };
    const g: any = Object.assign(Object.create(GpuRenderer.prototype), {
      device: {
        type: backend,
        createTexture: vi.fn(() => texture),
        limits: { maxTextureDimension2D: 4096 },
      },
      images: new Map(),
      styles: new Map(),
      frame: 1,
      linear: {},
      stats: {
        textureUploads: 0,
        pixelTextureUploads: 0,
        pixelTextureUploadedBytes: 0,
        liveTextureBytes: 0,
        liveTextures: 0,
      },
    });
    const image = { width: 3, height: 2, data: new Uint8ClampedArray(24) };
    image.data.set([255, 0, 0, 128]);
    g.imageTexture(image, true);
    g.frame++;
    g.imageTexture(image, true);
    expect(texture.copyExternalImage).not.toHaveBeenCalled();
    expect(texture.writeData).toHaveBeenCalledExactlyOnceWith(image.data, {
      width: 3,
      height: 2,
      bytesPerRow: 12,
    });
    expect(g.stats.pixelTextureUploads).toBe(1);
    expect(g.stats.pixelTextureUploadedBytes).toBe(24);
    g.frame++;
    g.imageTexture(image, false);
    expect(texture.writeData).toHaveBeenCalledTimes(2);
    expect(() => g.imageTexture({ ...image, data: new Uint8ClampedArray(4) }, true)).toThrow();
    g.forgetImage(image);
    expect(texture.destroy).toHaveBeenCalledOnce();
    expect(g.stats.liveTextures).toBe(0);
  });

it('warms production pipelines but compiles diagnostic reference variants only when explicitly selected', () => {
  const resource = (props: any) => ({
    ...props,
    destroy: vi.fn(),
    getCompilationInfo: async () => [],
  });
  const device: any = {
    type: 'webgpu',
    preferredColorFormat: 'bgra8unorm',
    lost: new Promise(() => {}),
    createBuffer: vi.fn(resource),
    createSampler: vi.fn(resource),
    createShader: vi.fn(resource),
    createRenderPipeline: vi.fn(resource),
    destroy: vi.fn(),
  };
  const canvas: any = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const g: any = new GpuRenderer(canvas, vi.fn(), vi.fn(), device);
  expect(g.pipelines.size).toBe(13);
  expect([...g.pipelines.keys()].some((k: any) => k.endsWith('-reference'))).toBe(false);
  const a = g.pipelineEntry('path-msaa-compact-xy-reference');
  expect(g.pipelines.size).toBe(14);
  expect(g.pipelineEntry('path-msaa-compact-xy-reference')).toBe(a);
  expect(device.createRenderPipeline).toHaveBeenCalledTimes(14);
  g.dispose();
});

it('rebuilds a lost WebGPU device once, invalidates meshes, and discards a replacement after disposal', async () => {
  const makeDevice = () => {
    let lose!: (info: { message: string }) => void;
    const resource = (props: any) => ({
      ...props,
      destroy: vi.fn(),
      getCompilationInfo: async () => [],
    });
    const device: any = {
      type: 'webgpu',
      preferredColorFormat: 'bgra8unorm',
      isLost: false,
      lost: new Promise((resolve) => {
        lose = resolve;
      }),
      submit: vi.fn(),
      createBuffer: vi.fn(resource),
      createSampler: vi.fn(resource),
      createShader: vi.fn(resource),
      createRenderPipeline: vi.fn(resource),
      destroy: vi.fn(),
    };
    return {
      device,
      lose: () => {
        device.isLost = true;
        lose({ message: 'test loss' });
      },
    };
  };
  const a = makeDevice(),
    b = makeDevice(),
    c = makeDevice();
  const canvas: any = { dataset: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const report = vi.fn(),
    invalidate = vi.fn();
  let release!: (device: any) => void;
  const request = vi
    .spyOn(GpuRenderer as any, 'requestWebgpuDevice')
    .mockResolvedValueOnce(a.device)
    .mockResolvedValueOnce(b.device)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
  const resize = vi.spyOn(GpuRenderer.prototype, 'resize').mockImplementation(() => {});
  let renderer: GpuRenderer | undefined;
  try {
    renderer = await GpuRenderer.create(canvas, invalidate, report, 'webgpu');
    a.lose();
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect((renderer as any).device).toBe(b.device);
    expect((renderer as any).lost).toBe(false);
    expect(a.device.destroy).toHaveBeenCalledOnce();
    expect(
      a.device.createBuffer.mock.results.every((r: any) => r.value.destroy.mock.calls.length === 1),
    ).toBe(true);
    b.lose();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    renderer.dispose();
    release(c.device);
    await vi.waitFor(() => expect(c.device.destroy).toHaveBeenCalledOnce());
    expect(invalidate).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  } finally {
    renderer?.dispose();
    request.mockRestore();
    resize.mockRestore();
  }
});

it('reports a failed replacement once without retrying or presenting partial GPU state', async () => {
  const report = vi.fn(),
    invalidate = vi.fn(),
    release = vi.fn();
  const renderer: any = Object.create(GpuRenderer.prototype);
  Object.assign(renderer, {
    canvas: { dataset: {} },
    disposed: false,
    lost: false,
    report,
    invalidate,
    release,
    device: { destroy: vi.fn() },
  });
  const request = vi
    .spyOn(GpuRenderer as any, 'requestWebgpuDevice')
    .mockRejectedValue(new Error('adapter unavailable'));
  try {
    await renderer.recoverWebgpu();
    expect(renderer.lost).toBe(true);
    expect(renderer.canvas.dataset.gpuStage).toBe('recovery-failed');
    expect(request).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'adapter unavailable' }),
    );
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    request.mockRestore();
  }
});
