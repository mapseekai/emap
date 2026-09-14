import { MeasureHandler } from '../../core/handlers/measure';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { measureService } from './keys';

export const measurePlugin: Plugin = {
  id: 'feature.interaction.measure',
  requires: [InteractionService, ...editHandlerServices],
  provides: [measureService],
  setup(ctx) {
    const handler = new MeasureHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx
        .get(InteractionService)
        .register(handler, { ...builtinInteractionOptions(handler.name), mode: 'measure' }),
    );
    ctx.provide(measureService, handler);
  },
};
