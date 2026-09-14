import { PartEditHandler } from '../../core/handlers/part-edit';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { partEditService } from './keys';

export const partEditPlugin: Plugin = {
  id: 'feature.interaction.part-edit',
  requires: [InteractionService, ...editHandlerServices],
  provides: [partEditService],
  setup(ctx) {
    const handler = new PartEditHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'part',
        blocks: ['pan'],
      }),
    );
    ctx.provide(partEditService, handler);
  },
};
