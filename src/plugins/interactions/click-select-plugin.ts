import { ClickSelectHandler } from '../../core/handlers/click-select';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createSelectionHandlerHost, selectionHandlerServices } from './host';
import { clickSelectService } from './keys';

export const clickSelectPlugin: Plugin = {
  id: 'feature.interaction.click-select',
  requires: [InteractionService, ...selectionHandlerServices],
  provides: [clickSelectService],
  setup(ctx) {
    const handler = new ClickSelectHandler(createSelectionHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, { ...builtinInteractionOptions(handler.name) }),
    );
    ctx.provide(clickSelectService, handler);
  },
};
