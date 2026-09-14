import { RingEditHandler } from '../../../engine/core/handlers/ring-edit';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const ringEditPlugin: Plugin.Object = {
  name: 'feature.interaction.ring-edit',
  inject: ['interaction', ...editHandlerServices],
  provide: ['ringEdit'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new RingEditHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'ring',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('ringEdit', handler);
    });
  },
};
