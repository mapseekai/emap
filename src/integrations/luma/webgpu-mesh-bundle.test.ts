import { describe, expect, it, vi } from 'vitest';
import { Buffer, type Device, type RenderPipeline, type VertexArray } from '@luma.gl/core';
import { WebgpuMeshRecorder } from './webgpu-mesh-bundle';
vi.mock('@luma.gl/core', () => {
  class Resource {
    destroyResource() {}
  }
  return { Buffer: class {}, RenderPass: Resource, RenderBundle: Resource };
});
function fixture() {
  const handle = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    drawIndexed: vi.fn(),
    finish: vi.fn(() => ({})),
    pushDebugGroup: vi.fn(),
    popDebugGroup: vi.fn(),
    insertDebugMarker: vi.fn(),
  };
  const native = {
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    createBindGroup: vi.fn(() => ({})),
    createRenderBundleEncoder: vi.fn(() => handle),
  };
  const device = {
    type: 'webgpu',
    preferredColorFormat: 'bgra8unorm',
    handle: native,
  } as unknown as Device;
  const report = vi.fn(),
    recorder = new WebgpuMeshRecorder(device, 4, report);
  const pipeline = {
    shaderLayout: { bindings: [{ name: 'emapUniforms', type: 'uniform' }] },
    handle: { getBindGroupLayout: vi.fn(() => ({})) },
  } as unknown as RenderPipeline;
  const buffer: Buffer = Object.assign(Object.create(Buffer.prototype), { handle: {} });
  const vao = { bindBeforeRender: vi.fn(), unbindAfterRender: vi.fn() } as unknown as VertexArray;
  return { handle, native, device, report, recorder, pipeline, buffer, vao };
}
describe('MSAA native command bridge with luma resources', () => {
  it('keeps sampleCount 4 and exact indexed/instance offsets', () => {
    const f = fixture();
    expect(f.native.createRenderBundleEncoder).toHaveBeenCalledWith({
      colorFormats: ['bgra8unorm'],
      depthStencilFormat: 'depth24plus',
      sampleCount: 4,
    });
    f.recorder.setPipeline(f.pipeline);
    f.recorder.setBindings({ emapUniforms: f.buffer });
    f.recorder.setVertexArray(f.vao);
    f.recorder.draw({ indexCount: 9, firstIndex: 12, instanceCount: 3, firstInstance: 7 });
    expect(f.handle.drawIndexed).toHaveBeenCalledWith(9, 3, 12, 0, 7);
    expect(f.vao.bindBeforeRender).toHaveBeenCalledWith(f.recorder);
    f.recorder.setBindings({ emapUniforms: f.buffer });
    expect(f.native.createBindGroup).toHaveBeenCalledOnce();
    const bundle = f.recorder.finish();
    bundle.destroy();
    f.recorder.destroy();
    expect(f.native.popErrorScope).toHaveBeenCalledOnce();
  });
  it('rejects unsupported bindings and dynamic state instead of recording incorrect commands', () => {
    const f = fixture();
    expect(() => f.recorder.draw({ vertexCount: 3 })).toThrow();
    expect(() => f.recorder.setParameters()).toThrow('outside');
    f.recorder.setPipeline(f.pipeline);
    expect(() => f.recorder.setBindings({ emapUniforms: f.buffer, other: f.buffer })).toThrow(
      'Only',
    );
    expect(() =>
      f.recorder.setPipeline({ shaderLayout: { bindings: [] } } as unknown as RenderPipeline),
    ).toThrow('single');
    f.recorder.destroy();
    expect(f.native.popErrorScope).toHaveBeenCalledOnce();
  });
  it('closes recording ownership after failure and reports asynchronous validation errors', async () => {
    const f = fixture();
    f.handle.finish.mockImplementationOnce(() => {
      throw new Error('finish failed');
    });
    expect(() => f.recorder.finish()).toThrow('finish failed');
    expect(f.native.popErrorScope).toHaveBeenCalledOnce();
    const g = fixture();
    g.native.popErrorScope.mockResolvedValueOnce({ message: 'invalid' } as never);
    g.recorder.destroy();
    await Promise.resolve();
    expect(g.report.mock.calls[0][0].message).toContain('invalid');
  });
});
