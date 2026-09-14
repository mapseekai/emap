import { DrawFeatureHandler } from '../../core/handlers/draw-feature';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { drawFeatureService } from './keys';

export const drawFeaturePlugin: Plugin = {
  id: 'feature.interaction.draw-feature',
  requires: [InteractionService, ...editHandlerServices],
  provides: [drawFeatureService],
  setup(ctx) {
    const handler = new DrawFeatureHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'draw',
        blocks: ['pan'],
      }),
    );
    ctx.provide(drawFeatureService, handler);
  },
};
