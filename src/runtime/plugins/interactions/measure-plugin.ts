import { MeasureHandler } from '../../../engine/core/handlers/measure';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const measurePlugin: Plugin.Object = {
  name: 'feature.interaction.measure',
  inject: ['interaction', ...editHandlerServices],
  provide: ['measure'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new MeasureHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'measure',
        }),
      );
      yield ctx.provide('measure', handler);
    });
  },
};
