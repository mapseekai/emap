import { describe, expect, it, vi } from 'vitest';
import { GpuRenderer } from './gpu-renderer';

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
      vertexCount: 6,
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
      vertexCount: 6,
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
