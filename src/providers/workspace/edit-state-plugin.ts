import type { Plugin } from '../../kernel/plugin';
import { EditStateService, EventService, RenderSignalService } from '../../services/keys';
import { EditStateServiceImpl } from './edit-state';

export const editStatePlugin: Plugin = {
  id: 'provider.edit-state',
  requires: [EventService, RenderSignalService],
  provides: [EditStateService],
  setup(ctx) {
    const value = new EditStateServiceImpl({
      events: ctx.get(EventService),
      signals: ctx.get(RenderSignalService),
    });
    ctx.provide(EditStateService, value);
  },
};
