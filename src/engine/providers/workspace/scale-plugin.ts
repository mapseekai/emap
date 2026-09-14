import type { Plugin } from 'cordis';
import { ScaleServiceImpl } from './scale';
export const scalePlugin: Plugin.Object = {
  name: 'provider.scale',
  inject: ['view'],
  provide: ['scale'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new ScaleServiceImpl({ view: ctx.view });
      yield ctx.provide('scale', value);
    });
  },
};
