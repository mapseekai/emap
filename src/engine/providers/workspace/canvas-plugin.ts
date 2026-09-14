import type { Plugin } from 'cordis';
import { CanvasPainter } from '../../rendering/canvas-painter';
export const canvasPainterPlugin: Plugin.Object = {
  name: 'provider.canvas2d',
  provide: ['painterFactory'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.provide('painterFactory', { create: (canvas) => new CanvasPainter(canvas) });
    });
  },
};
