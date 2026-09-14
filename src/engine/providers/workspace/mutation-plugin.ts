import type { Plugin } from 'cordis';
import { FeatureMutationService } from './mutation';
export const mutationPlugin: Plugin.Object = {
  name: 'provider.mutation',
  inject: ['cache', 'document', 'history', 'selection', 'signals'],
  provide: ['mutation'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new FeatureMutationService({
        cache: ctx.cache,
        document: ctx.document,
        history: ctx.history,
        selection: ctx.selection,
        signals: ctx.signals,
      });
      yield ctx.provide('mutation', value);
    });
  },
};
