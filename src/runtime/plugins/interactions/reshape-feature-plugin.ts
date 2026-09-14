import { ReshapeFeatureHandler } from '../../../engine/core/handlers/reshape-feature';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const reshapeFeaturePlugin: Plugin.Object = {
  name: 'feature.interaction.reshape-feature',
  inject: ['interaction', ...editHandlerServices],
  provide: ['reshapeFeature'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new ReshapeFeatureHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'reshape',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('reshapeFeature', handler);
    });
  },
};
