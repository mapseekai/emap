import type { Plugin } from 'cordis';
import { SelectionServiceImpl } from './selection';
export const selectionPlugin: Plugin.Object = {
  name: 'provider.selection',
  inject: ['document', 'mapEvents', 'signals'],
  provide: ['selection'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new SelectionServiceImpl({
        document: ctx.document,
        events: ctx.mapEvents,
        signals: ctx.signals,
      });
      yield ctx.provide('selection', value);
    });
  },
};
