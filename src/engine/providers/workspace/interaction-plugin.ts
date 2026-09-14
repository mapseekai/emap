import type { Plugin } from 'cordis';
import { InteractionServiceImpl } from './interaction';
export const interactionPlugin: Plugin.Object = {
  name: 'provider.interaction',
  inject: ['editState', 'mapEvents', 'surface'],
  provide: ['interaction'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new InteractionServiceImpl({ surface: ctx.surface });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('interaction', value);
      value.initialize();
      const events = ctx.mapEvents;
      const editState = ctx.editState;
      const onMode = () => value.syncMode(editState.getEditMode());
      const onSelection = () => value._handlers.refreshCursor();
      events.on('editmodechange', onMode);
      events.on('selectionchange', onSelection);
      yield ctx.effect(() => () => {
        events.off('editmodechange', onMode);
        events.off('selectionchange', onSelection);
      });
    });
  },
};
