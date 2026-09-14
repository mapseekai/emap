import type { Plugin } from 'cordis';
import { ControlServiceImpl } from './controls';
export const controlsPlugin: Plugin.Object = {
  name: 'provider.controls',
  inject: ['controlContext', 'mapEvents', 'surface'],
  provide: ['controls'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new ControlServiceImpl({
        ctx,
        controlContext: ctx.controlContext,
        events: ctx.mapEvents,
        surface: ctx.surface,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('controls', value);
    });
  },
};
