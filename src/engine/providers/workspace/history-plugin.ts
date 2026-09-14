import { pluginSignal } from '../../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import { HistoryServiceImpl } from './history';
export const historyPlugin: Plugin.Object = {
  name: 'provider.history',
  inject: ['cache', 'document', 'mapEvents', 'host', 'signals'],
  provide: ['history'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const value = new HistoryServiceImpl({
        cache: ctx.cache,
        document: ctx.document,
        events: ctx.mapEvents,
        host: ctx.host,
        signal: signal,
        signals: ctx.signals,
      });
      yield ctx.provide('history', value);
    });
  },
};
