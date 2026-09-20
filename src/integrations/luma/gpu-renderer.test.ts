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
