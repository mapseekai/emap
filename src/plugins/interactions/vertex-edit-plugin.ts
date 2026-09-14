import { VertexEditHandler } from '../../core/handlers/vertex-edit';
import type { Plugin } from '../../kernel/plugin';
import { InteractionService } from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
import { vertexEditService } from './keys';

export const vertexEditPlugin: Plugin = {
  id: 'feature.interaction.vertex-edit',
  requires: [InteractionService, ...editHandlerServices],
  provides: [vertexEditService],
  setup(ctx) {
    const handler = new VertexEditHandler(createEditHandlerHost(ctx));
    ctx.defer(
      ctx.get(InteractionService).register(handler, {
        ...builtinInteractionOptions(handler.name),
        mode: 'vertex',
        blocks: ['pan'],
      }),
    );
    ctx.provide(vertexEditService, handler);
  },
};
