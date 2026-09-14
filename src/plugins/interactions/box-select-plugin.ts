import { BoxSelectHandler } from '../../core/handlers/box-select';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createSelectionHandlerHost, selectionHandlerServices } from './host';
import { boxSelectService } from './keys';

export const boxSelectPlugin: Plugin = {
  id: 'feature.interaction.box-select',
  requires: [InteractionService, ...selectionHandlerServices],
  provides: [boxSelectService],
  setup(ctx) {
    const handler = new BoxSelectHandler(createSelectionHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, { ...builtinInteractionOptions(handler.name) }),
    );
    ctx.provide(boxSelectService, handler);
  },
};
