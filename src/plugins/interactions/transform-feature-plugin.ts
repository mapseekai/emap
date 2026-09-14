import { TransformFeatureHandler } from '../../core/handlers/transform-feature';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { transformFeatureService } from './keys';

export const transformFeaturePlugin: Plugin = {
  id: 'feature.interaction.transform-feature',
  requires: [InteractionService, ...editHandlerServices],
  provides: [transformFeatureService],
  setup(ctx) {
    const handler = new TransformFeatureHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx
        .get(InteractionService)
        .register(handler, { ...builtinInteractionOptions(handler.name), mode: 'transform' }),
    );
    ctx.provide(transformFeatureService, handler);
  },
};
