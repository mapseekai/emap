import type { Plugin } from 'cordis';
import { WorkspaceCache } from './cache';
export const cachePlugin: Plugin.Object = {
  name: 'provider.cache',
  inject: ['document', 'mapEvents', 'view'],
  provide: ['cache'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new WorkspaceCache({
        document: ctx.document,
        events: ctx.mapEvents,
        view: ctx.view,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('cache', value);
    });
  },
};
