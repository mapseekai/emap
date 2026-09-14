import { TransformFeatureHandler } from '../../../engine/core/handlers/transform-feature';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const transformFeaturePlugin: Plugin.Object = {
  name: 'feature.interaction.transform-feature',
  inject: ['interaction', ...editHandlerServices],
  provide: ['transformFeature'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new TransformFeatureHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'transform',
        }),
      );
      yield ctx.provide('transformFeature', handler);
    });
  },
};
