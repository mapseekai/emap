import type { Plugin } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  HistoryService,
  MutationService,
  RenderSignalService,
  SelectionService,
} from '../../services/keys';
import { FeatureMutationService } from './mutation';

export const mutationPlugin: Plugin = {
  id: 'provider.mutation',
  requires: [CacheService, DocumentService, HistoryService, SelectionService, RenderSignalService],
  provides: [MutationService],
  setup(ctx) {
    const value = new FeatureMutationService({
      cache: ctx.get(CacheService),
      document: ctx.get(DocumentService),
      history: ctx.get(HistoryService),
      selection: ctx.get(SelectionService),
      signals: ctx.get(RenderSignalService),
    });
    ctx.provide(MutationService, value);
  },
};
