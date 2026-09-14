import { ReshapeFeatureHandler } from '../../core/handlers/reshape-feature';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { reshapeFeatureService } from './keys';

export const reshapeFeaturePlugin: Plugin = {
  id: 'feature.interaction.reshape-feature',
  requires: [InteractionService, ...editHandlerServices],
  provides: [reshapeFeatureService],
  setup(ctx) {
    const handler = new ReshapeFeatureHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'reshape',
        blocks: ['pan'],
      }),
    );
    ctx.provide(reshapeFeatureService, handler);
  },
};
