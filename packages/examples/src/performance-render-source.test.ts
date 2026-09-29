// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Emap } from '@mapseekai/emap';
import type { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import { installPerformanceMonitor } from './performance-monitor';
import { gpuMetrics, monitorExampleMap } from './performance-render-source';

afterEach(() => {
  installPerformanceMonitor().dispose();
  vi.restoreAllMocks();
});

it('uses existing GPU counters without counting text draw calls twice', () => {
  const gpu = {
    backend: 'webgpu',
    stats: { frames: 12, drawCalls: 40, uploadedBytes: 100, pixelTextureUploadedBytes: 200 },
    textStats: { drawCalls: 10, bufferUploadedBytes: 30, textureUploadedBytes: 40 },
    memoryStats: { nominalKnownGpuBytes: 1000 },
  } as unknown as GpuRenderer;
  expect(gpuMetrics(gpu)).toEqual({
    backend: 'WebGPU',
    frames: 12,
    drawCalls: 40,
    uploadedBytes: 370,
    gpuBytes: 1000,
  });
});

it('registers map diagnostics with native Cordis cleanup and never requests a draw', () => {
  document.body.innerHTML = '';
  const monitor = installPerformanceMonitor();
  const remove = vi.fn();
  const add = vi.spyOn(monitor, 'addSource').mockReturnValue(remove);
  const effect = vi.fn();
  const render = vi.fn();
  const map = {
    ctx: { get: () => ({ _scheduler: { lastFrameMs: 2.5 } }), effect },
    getRenderer: () => 'canvas2d',
    render,
  } as unknown as Emap;
  monitorExampleMap(map, document);
  const read = add.mock.calls[0][0];
  expect(read()).toMatchObject({ backend: 'Canvas2D', cpuMs: 2.5 });
  expect(render).not.toHaveBeenCalled();
  const cleanup = effect.mock.calls[0][0]();
  cleanup();
  expect(remove).toHaveBeenCalledOnce();
});
