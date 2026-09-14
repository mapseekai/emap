import type { Plugin } from '../../kernel/plugin';
import {
  EditStateService,
  EventService,
  InteractionService,
  SurfaceService,
} from '../../services/keys';
import { InteractionServiceImpl } from './interaction';

export const interactionPlugin: Plugin = {
  id: 'provider.interaction',
  requires: [EditStateService, EventService, SurfaceService],
  provides: [InteractionService],
  setup(ctx) {
    const value = new InteractionServiceImpl({ surface: ctx.get(SurfaceService) });
    ctx.defer(() => value.dispose());
    ctx.provide(InteractionService, value);
    value.initialize();
    const events = ctx.get(EventService);
    const editState = ctx.get(EditStateService);
    const onMode = () => value.syncMode(editState.getEditMode());
    const onSelection = () => value._handlers.refreshCursor();
    events.on('editmodechange', onMode);
    events.on('selectionchange', onSelection);
    ctx.defer(() => {
      events.off('editmodechange', onMode);
      events.off('selectionchange', onSelection);
    });
  },
};
