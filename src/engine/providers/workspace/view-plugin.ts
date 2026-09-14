import type { Plugin } from 'cordis';
import { ViewServiceImpl } from './view';
export const viewPlugin: Plugin.Object = {
  name: 'provider.view',
  inject: ['document', 'mapEvents', 'signals'],
  provide: ['view'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new ViewServiceImpl({
        document: ctx.document,
        events: ctx.mapEvents,
        signals: ctx.signals,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('view', value);
      const events = ctx.mapEvents;
      const onReset = () => value.reset();
      events.on('reset', onReset);
      yield ctx.effect(() => () => {
        events.off('reset', onReset);
      });
    });
  },
};
