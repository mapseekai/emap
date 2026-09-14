import type { Plugin } from 'cordis';
import { QueryServiceImpl } from './query';
export const queryPlugin: Plugin.Object = {
  name: 'provider.query',
  inject: ['cache', 'document', 'layers', 'selection'],
  provide: ['query'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new QueryServiceImpl({
        cache: ctx.cache,
        document: ctx.document,
        layers: ctx.layers,
        selection: ctx.selection,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('query', value);
    });
  },
};
