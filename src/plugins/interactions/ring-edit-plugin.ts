import { RingEditHandler } from '../../core/handlers/ring-edit';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { ringEditService } from './keys';

export const ringEditPlugin: Plugin = {
  id: 'feature.interaction.ring-edit',
  requires: [InteractionService, ...editHandlerServices],
  provides: [ringEditService],
  setup(ctx) {
    const handler = new RingEditHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'ring',
        blocks: ['pan'],
      }),
    );
    ctx.provide(ringEditService, handler);
  },
};
