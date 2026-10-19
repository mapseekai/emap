/// <reference types="@webgpu/types" />
import {
  Buffer,
  RenderBundle,
  RenderPass,
  type Device,
  type RenderPipeline,
  type VertexArray,
  type Bindings,
  type BindingsByGroup,
  type RenderPassDrawOptions,
} from '@luma.gl/core';
import type { WebGPUDevice } from '@luma.gl/webgpu';

class MeshBundle extends RenderBundle {
  readonly device: Device;
  handle: GPURenderBundle | null;
  constructor(device: Device, handle: GPURenderBundle) {
    super(device, {});
    this.device = device;
    this.handle = handle;
  }
  override destroy(): void {
    this.handle = null;
    this.destroyResource();
  }
}
/** Narrow uniform-only WebGPU recording bridge. luma v10-alpha's public bundle
 * encoder rejects MSAA>1; use standard native recording, keep luma-owned resources
 * and execute via RenderPass.executeBundles so adapter draw state is reset correctly.
 * No dependency patches, framebuffer copies or mutable native-pass handle swaps. */
export class WebgpuMeshRecorder extends RenderPass {
  readonly device: WebGPUDevice;
  readonly handle: GPURenderBundleEncoder;
  private pipeline: RenderPipeline | null = null;
  private boundPipeline: RenderPipeline | null = null;
  private vertexArray: VertexArray | null = null;
  private bindings = new Map<RenderPipeline, Map<Buffer, GPUBindGroup>>();
  private scopeOpen = true;
  static supported(device: Device): boolean {
    return (
      device.type === 'webgpu' &&
      typeof (device as WebGPUDevice).handle?.createRenderBundleEncoder === 'function'
    );
  }
  constructor(
    device: Device,
    sampleCount: number,
    private readonly report: (error: Error) => void,
  ) {
    super(device, {});
    this.device = device as WebGPUDevice;
    this.device.handle.pushErrorScope('validation');
    try {
      this.handle = this.device.handle.createRenderBundleEncoder({
        colorFormats: [this.device.preferredColorFormat as GPUTextureFormat],
        depthStencilFormat: 'depth24plus',
        sampleCount,
      });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  override setPipeline(pipeline: RenderPipeline): void {
    const bindings = pipeline.shaderLayout.bindings;
    if (
      bindings.length !== 1 ||
      bindings[0].name !== 'emapUniforms' ||
      bindings[0].type !== 'uniform'
    )
      throw new Error('Mesh bundles require a single explicit uniform binding');
    this.pipeline = pipeline;
    this.handle.setPipeline(pipeline.handle as GPURenderPipeline);
  }
  override setBindings(bindings: Bindings | BindingsByGroup): void {
    if (!this.pipeline) throw new Error('Mesh bundle pipeline must precede bindings');
    const uniform = (bindings as Bindings).emapUniforms;
    if (!(uniform instanceof Buffer) || Object.keys(bindings).length !== 1)
      throw new Error('Only mesh uniform buffers may be recorded');
    let byBuffer = this.bindings.get(this.pipeline);
    if (!byBuffer) this.bindings.set(this.pipeline, (byBuffer = new Map<Buffer, GPUBindGroup>()));
    let group = byBuffer.get(uniform);
    if (!group) {
      group = this.device.handle.createBindGroup({
        layout: (this.pipeline.handle as GPURenderPipeline).getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform.handle as GPUBuffer, offset: 0, size: 240 } },
        ],
      });
      byBuffer.set(uniform, group);
    }
    this.handle.setBindGroup(0, group);
    this.boundPipeline = this.pipeline;
  }
  override setVertexArray(array: VertexArray): void {
    this.vertexArray = array;
  }
  override draw(options: RenderPassDrawOptions): boolean {
    if (!this.pipeline || this.boundPipeline !== this.pipeline || !this.vertexArray)
      throw new Error('Mesh bundle draw requires pipeline, bindings and vertices');
    // Existing luma VertexArray resolves expanded physical slots and index format.
    this.vertexArray.bindBeforeRender(this);
    if (options.indexCount !== undefined)
      this.handle.drawIndexed(
        options.indexCount,
        options.instanceCount ?? 1,
        options.firstIndex ?? 0,
        options.baseVertex ?? 0,
        options.firstInstance ?? 0,
      );
    else
      this.handle.draw(
        options.vertexCount ?? 0,
        options.instanceCount ?? 1,
        options.firstVertex ?? 0,
        options.firstInstance ?? 0,
      );
    this.vertexArray.unbindAfterRender(this);
    return true;
  }
  finish(): RenderBundle {
    try {
      return new MeshBundle(this.device, this.handle.finish());
    } finally {
      this.destroy();
    }
  }
  override destroy(): void {
    if (this.scopeOpen) {
      this.scopeOpen = false;
      void this.device.handle
        .popErrorScope()
        .then((error) => {
          if (error) this.report(new Error(`WebGPU mesh bundle validation: ${error.message}`));
        })
        .catch((error) => this.report(error instanceof Error ? error : new Error(String(error))));
    }
    this.bindings.clear();
    this.pipeline = this.boundPipeline = null;
    this.vertexArray = null;
    this.destroyResource();
  }
  override end(): void {
    throw new Error('Finish a mesh bundle instead of ending a pass');
  }
  override setParameters(): void {
    throw new Error('Dynamic state is set outside mesh bundles');
  }
  override drawIndirect(): void {
    throw new Error('Indirect mesh commands are unsupported');
  }
  override drawIndexedIndirect(): void {
    throw new Error('Indirect mesh commands are unsupported');
  }
  override executeBundles(): void {
    throw new Error('Mesh bundles cannot nest');
  }
  override beginOcclusionQuery(): void {
    throw new Error('Queries are outside mesh bundles');
  }
  override endOcclusionQuery(): void {
    throw new Error('Queries are outside mesh bundles');
  }
  override pushDebugGroup(label: string): void {
    this.handle.pushDebugGroup(label);
  }
  override popDebugGroup(): void {
    this.handle.popDebugGroup();
  }
  override insertDebugMarker(label: string): void {
    this.handle.insertDebugMarker(label);
  }
}
