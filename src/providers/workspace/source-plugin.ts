import { FormatService } from '../../services/formats';
import type { Plugin } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  EventService,
  HistoryService,
  LayerService,
  RenderSignalService,
  SelectionService,
  SourceFactoryService,
  SourceService,
  ViewService,
} from '../../services/keys';
import { SourceServiceImpl } from './source';

export const sourcePlugin: Plugin = {
  id: 'provider.source',
  requires: [
    FormatService,
    CacheService,
    DocumentService,
    EventService,
    HistoryService,
    LayerService,
    SelectionService,
    RenderSignalService,
    SourceFactoryService,
    ViewService,
  ],
  provides: [SourceService],
  setup(ctx) {
    const value = new SourceServiceImpl({
      formats: ctx.get(FormatService),
      cache: ctx.get(CacheService),
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      history: ctx.get(HistoryService),
      layers: ctx.get(LayerService),
      selection: ctx.get(SelectionService),
      signal: ctx.signal,
      signals: ctx.get(RenderSignalService),
      sourceFactory: ctx.get(SourceFactoryService),
      view: ctx.get(ViewService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(SourceService, value);
  },
};
