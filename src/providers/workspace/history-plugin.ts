import type { Plugin } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  EventService,
  HistoryService,
  OperationHostService,
  RenderSignalService,
} from '../../services/keys';
import { HistoryServiceImpl } from './history';

export const historyPlugin: Plugin = {
  id: 'provider.history',
  requires: [
    CacheService,
    DocumentService,
    EventService,
    OperationHostService,
    RenderSignalService,
  ],
  provides: [HistoryService],
  setup(ctx) {
    const value = new HistoryServiceImpl({
      cache: ctx.get(CacheService),
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      host: ctx.get(OperationHostService),
      signal: ctx.signal,
      signals: ctx.get(RenderSignalService),
    });
    ctx.provide(HistoryService, value);
  },
};
