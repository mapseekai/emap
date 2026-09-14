import { AutoCompletePolygonHandler } from '../../core/handlers/auto-complete-polygon';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { autoCompletePolygonService } from './keys';

export const autoCompletePolygonPlugin: Plugin = {
  id: 'feature.interaction.auto-complete-polygon',
  requires: [InteractionService, ...editHandlerServices],
  provides: [autoCompletePolygonService],
  setup(ctx) {
    const handler = new AutoCompletePolygonHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'auto-complete',
        blocks: ['pan'],
      }),
    );
    ctx.provide(autoCompletePolygonService, handler);
  },
};
