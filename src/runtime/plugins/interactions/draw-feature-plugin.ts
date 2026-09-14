import { DrawFeatureHandler } from '../../../engine/core/handlers/draw-feature';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const drawFeaturePlugin: Plugin.Object = {
  name: 'feature.interaction.draw-feature',
  inject: ['interaction', ...editHandlerServices],
  provide: ['drawFeature'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new DrawFeatureHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'draw',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('drawFeature', handler);
    });
  },
};
