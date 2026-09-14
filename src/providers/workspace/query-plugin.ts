import type { Plugin } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  LayerService,
  QueryService,
  SelectionService,
} from '../../services/keys';
import { QueryServiceImpl } from './query';

export const queryPlugin: Plugin = {
  id: 'provider.query',
  requires: [CacheService, DocumentService, LayerService, SelectionService],
  provides: [QueryService],
  setup(ctx) {
    const value = new QueryServiceImpl({
      cache: ctx.get(CacheService),
      document: ctx.get(DocumentService),
      layers: ctx.get(LayerService),
      selection: ctx.get(SelectionService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(QueryService, value);
  },
};
