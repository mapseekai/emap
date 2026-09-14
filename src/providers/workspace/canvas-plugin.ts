import type { Plugin } from '../../kernel/plugin';
import { CanvasPainter } from '../../renderer/canvas-painter';
import { PainterFactoryService } from '../../services/keys';

export const canvasPainterPlugin: Plugin = {
  id: 'provider.canvas2d',
  provides: [PainterFactoryService],
  setup(ctx) {
    ctx.provide(PainterFactoryService, { create: (canvas) => new CanvasPainter(canvas) });
  },
};
