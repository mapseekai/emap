import type { Plugin } from '../../kernel/plugin';
import { HistoryService, ShortcutsService, SurfaceService } from '../../services/keys';
import { HistoryShortcutService } from './shortcuts';

export const shortcutsPlugin: Plugin = {
  id: 'provider.shortcuts',
  requires: [HistoryService, SurfaceService],
  provides: [ShortcutsService],
  setup(ctx) {
    const value = new HistoryShortcutService({
      history: ctx.get(HistoryService),
      surface: ctx.get(SurfaceService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(ShortcutsService, value);
  },
};
