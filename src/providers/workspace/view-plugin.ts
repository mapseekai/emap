import type { Plugin } from '../../kernel/plugin';
import {
  DocumentService,
  EventService,
  RenderSignalService,
  ViewService,
} from '../../services/keys';
import { ViewServiceImpl } from './view';

export const viewPlugin: Plugin = {
  id: 'provider.view',
  requires: [DocumentService, EventService, RenderSignalService],
  provides: [ViewService],
  setup(ctx) {
    const value = new ViewServiceImpl({
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      signals: ctx.get(RenderSignalService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(ViewService, value);
    const events = ctx.get(EventService);
    const onReset = () => value.reset();
    events.on('reset', onReset);
    ctx.defer(() => {
      events.off('reset', onReset);
    });
  },
};
