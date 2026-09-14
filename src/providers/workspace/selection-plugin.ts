import type { Plugin } from '../../kernel/plugin';
import {
  DocumentService,
  EventService,
  RenderSignalService,
  SelectionService,
} from '../../services/keys';
import { SelectionServiceImpl } from './selection';

export const selectionPlugin: Plugin = {
  id: 'provider.selection',
  requires: [DocumentService, EventService, RenderSignalService],
  provides: [SelectionService],
  setup(ctx) {
    const value = new SelectionServiceImpl({
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      signals: ctx.get(RenderSignalService),
    });
    ctx.provide(SelectionService, value);
  },
};
