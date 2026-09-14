import type { Plugin } from 'cordis';
import { HistoryShortcutService } from './shortcuts';
export const shortcutsPlugin: Plugin.Object = {
  name: 'provider.shortcuts',
  inject: ['history', 'surface'],
  provide: ['shortcuts'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new HistoryShortcutService({
        history: ctx.history,
        surface: ctx.surface,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('shortcuts', value);
    });
  },
};
