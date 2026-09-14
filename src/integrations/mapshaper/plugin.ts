import { pluginSignal } from '../../runtime/context/cancellation';
import { scopedOperationHost } from '../../engine/map/operation-scope';
import type { Plugin } from 'cordis';
import { MapshaperOps } from '../../engine/map/mapshaper-ops';
export const mapshaperProcessingPlugin: Plugin.Object = {
  name: 'feature.mapshaper-processing',
  inject: ['host'],
  provide: ['ops'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      yield ctx.provide('ops', new MapshaperOps(scopedOperationHost(ctx.host, signal)));
    });
  },
};
