import { pluginSignal } from '../../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import { ValidationServiceImpl } from './validation';
export const validationPlugin: Plugin.Object = {
  name: 'provider.validation',
  inject: ['document', 'mapEvents', 'host'],
  provide: ['validation'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const value = new ValidationServiceImpl({
        document: ctx.document,
        events: ctx.mapEvents,
        host: ctx.host,
        signal: signal,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('validation', value);
      const events = ctx.mapEvents;
      const onHistory = () => value._runAfterCommitValidators();
      events.on('historychange', onHistory);
      yield ctx.effect(() => () => {
        events.off('historychange', onHistory);
      });
    });
  },
};
