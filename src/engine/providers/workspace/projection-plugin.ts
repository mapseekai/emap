import { pluginSignal } from '../../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import { ProjectionServiceImpl } from './projection';
export const projectionPlugin: Plugin.Object = {
  name: 'provider.projection',
  inject: ['cache', 'document', 'mapEvents', 'history', 'signals', 'view'],
  provide: ['projection'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const value = new ProjectionServiceImpl({
        cache: ctx.cache,
        document: ctx.document,
        events: ctx.mapEvents,
        history: ctx.history,
        signal: signal,
        signals: ctx.signals,
        view: ctx.view,
      });
      yield ctx.provide('projection', value);
    });
  },
};
