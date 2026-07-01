import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRetainedWebGLModel } from './models';

const modelMock = vi.hoisted(() =>
  // Use a regular function (not an arrow) so `new Model(...)` in models.ts can
  // construct it — vitest 4 constructs the mock's implementation directly, and
  // arrow functions are not constructable.
  vi.fn().mockImplementation(function () {
    return {
      destroy: vi.fn(),
      draw: vi.fn(),
      props: {},
      setAttributes: vi.fn(),
      setIndexBuffer: vi.fn(),
      setInstanceCount: vi.fn(),
      setVertexCount: vi.fn(),
    };
  }),
);

vi.mock('@luma.gl/engine', () => ({
  Model: modelMock,
}));

function makeDevice() {
  return {
    createBuffer: vi.fn(({ data }: { data: ArrayBufferView }) => ({
      byteLength: data.byteLength,
      destroy: vi.fn(),
      write: vi.fn(),
    })),
  };
}

describe('RetainedWebGLModel', () => {
  beforeEach(() => {
    modelMock.mockClear();
  });

  it('creates line segment models as instanced even without point instancePositions', () => {
    const device = makeDevice();

    createRetainedWebGLModel(device as any, {
      shaderKind: 'line',
      topology: 'triangle-list',
      positions: new Float32Array([
        0, -1,
        1, -1,
        1, 1,
        0, -1,
        1, 1,
        0, 1,
      ]),
      instanceCount: 2,
      isInstanced: true,
      attributes: {
        instanceStartPositions: {
          data: new Float32Array([0, 0, 1, 1]),
          format: 'float32x2',
          stepMode: 'instance',
        },
      },
      uniforms: {},
    });

    expect(modelMock).toHaveBeenCalledWith(device, expect.objectContaining({
      isInstanced: true,
      instanceCount: 2,
      bufferLayout: expect.arrayContaining([
        { name: 'positions', stepMode: 'vertex', format: 'float32x2' },
        { name: 'instanceStartPositions', stepMode: 'instance', format: 'float32x2' },
      ]),
    }));
  });

  it('updates line instance count from explicit instanceCount', () => {
    const device = makeDevice();
    const model = createRetainedWebGLModel(device as any, {
      shaderKind: 'line',
      topology: 'triangle-list',
      positions: new Float32Array([0, 0, 1, 0, 1, 1]),
      instanceCount: 2,
      isInstanced: true,
      uniforms: {},
    });
    const lumaModel = modelMock.mock.results[0].value;

    model.update({
      shaderKind: 'line',
      topology: 'triangle-list',
      positions: new Float32Array([0, 0, 1, 0, 1, 1]),
      instanceCount: 7,
      isInstanced: true,
      uniforms: {},
    });

    expect(lumaModel.setInstanceCount).toHaveBeenCalledWith(7);
  });

  it('creates indexed polygon models with an index buffer', () => {
    const device = makeDevice();

    createRetainedWebGLModel(device as any, {
      shaderKind: 'solid',
      topology: 'triangle-list',
      positions: new Float32Array([
        0, 0,
        0, 10,
        10, 10,
        10, 0,
        0, 0,
      ]),
      indices: new Uint32Array([1, 2, 3, 3, 4, 1]),
      vertexCount: 6,
      uniforms: {},
    });

    expect(device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({
      data: new Uint32Array([1, 2, 3, 3, 4, 1]),
    }));
    expect(modelMock).toHaveBeenCalledWith(device, expect.objectContaining({
      indexBuffer: expect.objectContaining({ byteLength: 24 }),
      vertexCount: 6,
    }));
  });

  it('updates uniforms without rewriting unchanged retained buffers', () => {
    const device = makeDevice();
    const positions = new Float32Array([0, 0, 1, 0, 1, 1]);
    const indices = new Uint32Array([0, 1, 2]);
    const instanceStartPositions = new Float32Array([0, 0, 1, 1]);
    const model = createRetainedWebGLModel(device as any, {
      shaderKind: 'line',
      topology: 'triangle-list',
      positions,
      indices,
      instanceCount: 1,
      isInstanced: true,
      attributes: {
        instanceStartPositions: {
          data: instanceStartPositions,
          format: 'float32x2',
          stepMode: 'instance',
        },
      },
      uniforms: { u_matrix: new Float32Array([1]) },
    });
    const buffers = device.createBuffer.mock.results.map((r) => r.value);

    model.update({
      shaderKind: 'line',
      topology: 'triangle-list',
      positions,
      indices,
      instanceCount: 1,
      isInstanced: true,
      attributes: {
        instanceStartPositions: {
          data: instanceStartPositions,
          format: 'float32x2',
          stepMode: 'instance',
        },
      },
      uniforms: { u_matrix: new Float32Array([2]) },
    });

    for (const buffer of buffers) {
      expect(buffer.write).not.toHaveBeenCalled();
    }
  });
});
