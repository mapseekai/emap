import type { Plugin } from 'cordis';
import { SurfaceServiceImpl } from './surface';
export const surfacePlugin: Plugin.Object = {
  name: 'provider.surface',
  inject: ['options'],
  provide: ['surface'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new SurfaceServiceImpl();
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('surface', value);
      value.initialize(ctx.options);
    });
  },
};
