import type { Plugin } from 'cordis';
import { LayerServiceImpl } from './layers';
export const layersPlugin: Plugin.Object = {
  name: 'provider.layers',
  inject: ['document', 'mapEvents', 'signals'],
  provide: ['layers'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new LayerServiceImpl({
        document: ctx.document,
        events: ctx.mapEvents,
        signals: ctx.signals,
      });
      yield ctx.provide('layers', value);
    });
  },
};
