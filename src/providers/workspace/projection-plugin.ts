import type { Plugin } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  EventService,
  HistoryService,
  ProjectionService,
  RenderSignalService,
  ViewService,
} from '../../services/keys';
import { ProjectionServiceImpl } from './projection';

export const projectionPlugin: Plugin = {
  id: 'provider.projection',
  requires: [
    CacheService,
    DocumentService,
    EventService,
    HistoryService,
    RenderSignalService,
    ViewService,
  ],
  provides: [ProjectionService],
  setup(ctx) {
    const value = new ProjectionServiceImpl({
      cache: ctx.get(CacheService),
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      history: ctx.get(HistoryService),
      signal: ctx.signal,
      signals: ctx.get(RenderSignalService),
      view: ctx.get(ViewService),
    });
    ctx.provide(ProjectionService, value);
  },
};
