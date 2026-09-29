import type { Plugin } from 'cordis';
import { resolveRenderer } from '../../map/renderer';
import { CanvasPainter } from '../../rendering/canvas-painter';

/** Select the main-map painter at creation. The editor overlay remains lightweight Canvas2D. */
export const rendererPainterPlugin: Plugin.Object = {
  name: 'provider.renderer',
  inject: ['options'],
  provide: ['painterFactory'],
  apply(ctx) {
    const backend = resolveRenderer(ctx.options.renderer);
    const msdfWorkerUrl = ctx.options.msdfWorkerUrl;
    ctx.effect(function* () {
      yield ctx.provide('painterFactory', {
        async create(canvas, options) {
          if (options?.role === 'overlay' || backend === 'canvas2d')
            return Object.assign(new CanvasPainter(canvas), { backend: 'canvas2d' as const });
          const { LumaPainter } = await import('../../../integrations/luma/painter');
          options?.signal.throwIfAborted();
          return LumaPainter.create(canvas, backend, {
            invalidate: options?.invalidate ?? (() => {}),
            report: options?.report ?? (() => {}),
            signal: options?.signal,
            msdfWorkerUrl,
            workerRuntime: ctx.options.workerRuntime,
            geometryWorkerUrl: ctx.options.geometryWorkerUrl,
            screenPathFiltering: ctx.options.screenPathFiltering,
          });
        },
      });
    });
  },
};
