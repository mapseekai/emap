import { LassoSelectHandler } from '../../core/handlers/lasso-select';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createSelectionHandlerHost, selectionHandlerServices } from './host';
import { lassoSelectService } from './keys';

export const lassoSelectPlugin: Plugin = {
  id: 'feature.interaction.lasso-select',
  requires: [InteractionService, ...selectionHandlerServices],
  provides: [lassoSelectService],
  setup(ctx) {
    const handler = new LassoSelectHandler(createSelectionHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, { ...builtinInteractionOptions(handler.name) }),
    );
    ctx.provide(lassoSelectService, handler);
  },
};
