import { SplitFeatureHandler } from '../../core/handlers/split-feature';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { splitFeatureService } from './keys';

export const splitFeaturePlugin: Plugin = {
  id: 'feature.interaction.split-feature',
  requires: [InteractionService, ...editHandlerServices],
  provides: [splitFeatureService],
  setup(ctx) {
    const handler = new SplitFeatureHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'split',
        blocks: ['pan'],
      }),
    );
    ctx.provide(splitFeatureService, handler);
  },
};
