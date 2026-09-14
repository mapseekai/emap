import { LassoSelectHandler } from '../../../engine/core/handlers/lasso-select';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createSelectionHandlerHost, selectionHandlerServices } from './host';
export const lassoSelectPlugin: Plugin.Object = {
  name: 'feature.interaction.lasso-select',
  inject: ['interaction', ...selectionHandlerServices],
  provide: ['lassoSelect'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new LassoSelectHandler(createSelectionHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, { ...builtinInteractionOptions(handler.name) }),
      );
      yield ctx.provide('lassoSelect', handler);
    });
  },
};
