import { ClickSelectHandler } from '../../../engine/core/handlers/click-select';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createSelectionHandlerHost, selectionHandlerServices } from './host';
export const clickSelectPlugin: Plugin.Object = {
  name: 'feature.interaction.click-select',
  inject: ['interaction', ...selectionHandlerServices],
  provide: ['clickSelect'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new ClickSelectHandler(createSelectionHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, { ...builtinInteractionOptions(handler.name) }),
      );
      yield ctx.provide('clickSelect', handler);
    });
  },
};
