import type { Plugin } from '../../kernel/plugin';
import { CacheService, DocumentService, EventService, ViewService } from '../../services/keys';
import { WorkspaceCache } from './cache';

export const cachePlugin: Plugin = {
  id: 'provider.cache',
  requires: [DocumentService, EventService, ViewService],
  provides: [CacheService],
  setup(ctx) {
    const value = new WorkspaceCache({
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      view: ctx.get(ViewService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(CacheService, value);
  },
};
