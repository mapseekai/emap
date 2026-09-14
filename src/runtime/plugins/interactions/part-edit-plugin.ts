import { PartEditHandler } from '../../../engine/core/handlers/part-edit';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const partEditPlugin: Plugin.Object = {
  name: 'feature.interaction.part-edit',
  inject: ['interaction', ...editHandlerServices],
  provide: ['partEdit'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new PartEditHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'part',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('partEdit', handler);
    });
  },
};
