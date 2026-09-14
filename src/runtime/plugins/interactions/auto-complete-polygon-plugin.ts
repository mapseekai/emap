import { AutoCompletePolygonHandler } from '../../../engine/core/handlers/auto-complete-polygon';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const autoCompletePolygonPlugin: Plugin.Object = {
  name: 'feature.interaction.auto-complete-polygon',
  inject: ['interaction', ...editHandlerServices],
  provide: ['autoCompletePolygon'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new AutoCompletePolygonHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'auto-complete',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('autoCompletePolygon', handler);
    });
  },
};
