import { SplitFeatureHandler } from '../../../engine/core/handlers/split-feature';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
import { createEditHandlerHost, editHandlerServices } from './host';
export const splitFeaturePlugin: Plugin.Object = {
  name: 'feature.interaction.split-feature',
  inject: ['interaction', ...editHandlerServices],
  provide: ['splitFeature'],
  apply(ctx) {
    ctx.effect(function* () {
      const handler = new SplitFeatureHandler(createEditHandlerHost(ctx));
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          mode: 'split',
          blocks: ['pan'],
        }),
      );
      yield ctx.provide('splitFeature', handler);
    });
  },
};
