import { VertexEditHandler } from '../../../engine/core/handlers/vertex-edit';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const vertexEditPlugin: Plugin.Object = {
  name: 'feature.interaction.vertex-edit',
  inject: ['interaction', ...editHandlerServices],
  provide: ['vertexEdit'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new VertexEditHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'vertex',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('vertexEdit', handler);
    });
  },
};
