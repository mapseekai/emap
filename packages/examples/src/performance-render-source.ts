import type { Emap } from '@mapseekai/emap';
import type { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import type { LumaPainter } from '../../../src/integrations/luma/painter';
import { registerPerformanceSource, type ExampleRenderMetrics } from './performance-monitor';

/** Read existing counters at UI sampling frequency, without timing or wrapping GPU calls. */
export function gpuMetrics(gpu: GpuRenderer): ExampleRenderMetrics {
  const stats = gpu.stats,
    text = gpu.textStats;
  return {
    backend: gpu.backend === 'webgpu' ? 'WebGPU' : 'WebGL2',
    frames: stats.frames,
    drawCalls: stats.drawCalls,
    uploadedBytes:
      stats.uploadedBytes +
      stats.pixelTextureUploadedBytes +
      ('bufferUploadedBytes' in text && typeof text.bufferUploadedBytes === 'number'
        ? text.bufferUploadedBytes
        : 0) +
      ('textureUploadedBytes' in text && typeof text.textureUploadedBytes === 'number'
        ? text.textureUploadedBytes
        : 0),
    gpuBytes: gpu.memoryStats.nominalKnownGpuBytes,
  };
}

/** Internal diagnostics stay in examples; no published renderer contract is widened. */
export function monitorExampleMap(map: Emap, root: Document): void {
  const unregister = registerPerformanceSource(() => {
    const backend = map.getRenderer();
    if (!backend) return null;
    const render = map.ctx.get('render') as unknown as
      | {
          _painter?: LumaPainter;
          _scheduler?: { lastFrameMs: number };
          _labels?: { stats: { placed: number } };
        }
      | undefined;
    const painter = render?._painter;
    const result: ExampleRenderMetrics = painter?.gpu
      ? { ...gpuMetrics(painter.gpu), pending: painter.stats.geometryChunks.pending }
      : { backend: 'Canvas2D' };
    result.cpuMs = render?._scheduler?.lastFrameMs;
    result.labels = render?._labels?.stats.placed;
    return result;
  }, root);
  map.ctx.effect?.(() => unregister, 'Example performance monitor');
}
