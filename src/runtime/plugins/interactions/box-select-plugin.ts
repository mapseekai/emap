import { BoxSelectHandler } from '../../../engine/core/handlers/box-select';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createSelectionHandlerHost, selectionHandlerServices } from './host';
export const boxSelectPlugin: Plugin.Object = {
  name: 'feature.interaction.box-select',
  inject: ['interaction', ...selectionHandlerServices],
  provide: ['boxSelect'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new BoxSelectHandler(createSelectionHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, { ...builtinInteractionOptions(handler.name) }),
      );
      yield ctx.provide('boxSelect', handler);
    });
  },
};
