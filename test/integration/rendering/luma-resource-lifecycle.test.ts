// @vitest-environment node
import { createRequire } from 'node:module';
import type { Buffer, ShaderLayout, TextureView } from '@luma.gl/core';
import type { WebGLDevice } from '@luma.gl/webgl';
import type { WebGPUDevice } from '@luma.gl/webgpu';
import { describe, expect, it } from 'vitest';

const { StatsManager } = await import(
  new URL('./utils/stats-manager.js', import.meta.resolve('@luma.gl/core')).href
);
const require = createRequire(import.meta.url);
const layout: ShaderLayout = { attributes: [], bindings: [] };

// Test the two entrypoints in separate runs: luma registers a process-global singleton.
const format = process.env.LUMA_TEST_FORMAT === 'require' ? 'require' : 'import';
const webgl: typeof import('@luma.gl/webgl') =
  format === 'import' ? await import('@luma.gl/webgl') : require('@luma.gl/webgl');
const webgpu: typeof import('@luma.gl/webgpu') =
  format === 'import' ? await import('@luma.gl/webgpu') : require('@luma.gl/webgpu');

describe(`installed luma resource lifecycle (${format})`, () => {
  function glDevice() {
    const deletedSamplers: unknown[] = [];
    const deletedFramebuffers: unknown[] = [];
    const copies: number[] = [];
    const device = {
      type: 'webgl',
      userData: {},
      props: {},
      statsManager: new StatsManager(),
      _setWebGLDebugMetadata() {},
      gl: {
        createSampler: () => ({}),
        deleteSampler: (handle: unknown) => deletedSamplers.push(handle),
        createFramebuffer: () => ({}),
        deleteFramebuffer: (handle: unknown) => deletedFramebuffers.push(handle),
        bindFramebuffer: () => null,
        bindTexture() {},
        framebufferTexture2D() {},
        bindBuffer() {},
        copyBufferSubData: (
          _read: number,
          _write: number,
          _from: number,
          _to: number,
          size: number,
        ) => copies.push(size),
      },
    } as unknown as WebGLDevice;
    return { device, deletedSamplers, deletedFramebuffers, copies };
  }

  function gpuDevice() {
    const device = {
      type: 'webgpu',
      userData: {},
      props: { debugShaders: 'never' },
      limits: { maxVertexAttributes: 16 },
      statsManager: new StatsManager(),
      handle: {
        createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
        createPipelineLayout: () => ({}),
        createBindGroupLayout: () => ({}),
        createRenderPipeline: () => ({}),
        createRenderPipelineAsync: async () => {
          throw new Error('compile failed');
        },
      },
      pushErrorScope() {},
      popErrorScope: async () => {},
      createPipelineLayout: webgpu.WebGPUDevice.prototype.createPipelineLayout,
    } as unknown as WebGPUDevice;
    return device;
  }

  function count(device: WebGLDevice | WebGPUDevice, name: string) {
    return device.statsManager.getStats('GPU Resource Counts').get(name).count;
  }

  function expectReleased(device: WebGLDevice | WebGPUDevice) {
    for (const bucket of ['GPU Resource Counts', 'Resource Counts']) {
      const stats = device.statsManager.getStats(bucket);
      for (const [name, stat] of Object.entries(stats.stats)) {
        if (name.endsWith(' Active')) expect(stat.count, `${bucket}: ${name}`).toBe(0);
      }
      expect(stats.get('Resources Created').count).toBeGreaterThan(0);
    }
  }

  it('destroys owned samplers once and balances their lifecycle counts', () => {
    const { device, deletedSamplers } = glDevice();
    const sampler = new webgl.WEBGLSampler(device, {});
    const handle = sampler.handle;
    sampler.destroy();
    sampler.destroy();
    expect(deletedSamplers).toEqual([handle]);
    expect(sampler.destroyed).toBe(true);
    expectReleased(device);
  });

  it('releases a borrowed sampler wrapper without deleting its native handle', () => {
    const { device, deletedSamplers } = glDevice();
    const sampler = new webgl.WEBGLSampler(device, { handle: {}, _isHandleBorrowed: true });
    sampler.destroy();
    sampler.destroy();
    expect(deletedSamplers).toEqual([]);
    expectReleased(device);
  });

  it('deletes owned framebuffers once while preserving default and supplied handles', () => {
    const { device, deletedFramebuffers } = glDevice();
    const view = {
      texture: { handle: {}, glTarget: 3553 },
      props: { baseMipLevel: 0, baseArrayLayer: 0 },
    } as unknown as TextureView;
    const owned = new webgl.WEBGLFramebuffer(device, { colorAttachments: [view] });
    const handle = owned.handle;
    const borrowed = new webgl.WEBGLFramebuffer(device, { handle: {}, _isHandleBorrowed: true });
    const defaultFramebuffer = new webgl.WEBGLFramebuffer(device, { handle: null });
    for (const framebuffer of [owned, borrowed, defaultFramebuffer]) {
      framebuffer.destroy();
      framebuffer.destroy();
    }
    expect(deletedFramebuffers).toEqual([handle]);
    expectReleased(device);
  });

  it('destroys the cached default framebuffer with its canvas context', () => {
    const { device, deletedFramebuffers } = glDevice();
    const context = new webgl.WebGLCanvasContext(device, { width: 1, height: 1 });
    const framebuffer = context._getCurrentFramebuffer();
    expect(context._getCurrentFramebuffer()).toBe(framebuffer);
    context.destroy();
    context.destroy();
    expect(framebuffer.destroyed).toBe(true);
    expect(deletedFramebuffers).toEqual([]);
    expectReleased(device);
  });

  it('destroys an abandoned command buffer with its encoder', () => {
    const { device } = glDevice();
    const encoder = new webgl.WEBGLCommandEncoder(device, {});
    encoder.destroy();
    encoder.destroy();
    expect(encoder.commandBuffer.destroyed).toBe(true);
    expectReleased(device);
  });

  it('keeps finished commands alive until the transferred buffer is submitted', () => {
    const { device, copies } = glDevice();
    const encoder = new webgl.WEBGLCommandEncoder(device, {});
    encoder.copyBufferToBuffer({
      sourceBuffer: { handle: {} } as Buffer,
      destinationBuffer: { handle: {} } as Buffer,
      size: 16,
    });
    const buffer = encoder.finish();
    encoder.destroy();
    expect(buffer.destroyed).toBe(false);
    webgl.WebGLDevice.prototype.submit.call(device, buffer);
    expect(copies).toEqual([16]);
    expect(buffer.destroyed).toBe(true);
    expectReleased(device);
  });

  it('balances repeated WebGPU scene disposal without destroying shared shaders', async () => {
    const device = gpuDevice();
    for (let cycle = 0; cycle < 3; cycle++) {
      const shader = new webgpu.WebGPUShader(device, {
        language: 'wgsl',
        stage: 'vertex',
        source: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(0); }',
      });
      await shader.asyncCompilationStatus;
      const pipeline = webgpu.WebGPUDevice.prototype.createRenderPipeline.call(device, {
        vs: shader,
        shaderLayout: layout,
      });
      const vertexArray = webgpu.WebGPUDevice.prototype.createVertexArray.call(device, {
        shaderLayout: layout,
        bufferLayout: [],
      });
      pipeline.destroy();
      pipeline.destroy();
      expect(shader.destroyed).toBe(false);
      expect(count(device, 'PipelineLayouts Active')).toBe(0);
      vertexArray.destroy();
      vertexArray.destroy();
      shader.destroy();
      shader.destroy();
      expectReleased(device);
    }
    expect(count(device, 'Resources Created')).toBe(12);
  });

  it('releases the auto-created pipeline layout after asynchronous compilation fails', async () => {
    const device = gpuDevice();
    const shader = new webgpu.WebGPUShader(device, {
      language: 'wgsl',
      stage: 'vertex',
      source: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(0); }',
    });
    await shader.asyncCompilationStatus;
    await expect(
      webgpu.WebGPUDevice.prototype.createRenderPipelineAsync.call(device, {
        vs: shader,
        shaderLayout: layout,
      }),
    ).rejects.toThrow('compile failed');
    expect(count(device, 'RenderPipelines Active')).toBe(0);
    expect(count(device, 'PipelineLayouts Active')).toBe(0);
    expect(shader.destroyed).toBe(false);
    shader.destroy();
    expectReleased(device);
  });
});
