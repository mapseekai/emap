import type { Plugin } from 'cordis';
import { EditStateServiceImpl } from './edit-state';
export const editStatePlugin: Plugin.Object = {
  name: 'provider.edit-state',
  inject: ['mapEvents', 'signals'],
  provide: ['editState'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new EditStateServiceImpl({
        events: ctx.mapEvents,
        signals: ctx.signals,
      });
      yield ctx.provide('editState', value);
    });
  },
};
