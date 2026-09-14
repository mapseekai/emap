import type { Plugin } from '../../kernel/plugin';
import {
  DocumentService,
  EventService,
  SelectionService,
  SnapshotService,
  SourceFactoryService,
  SourceService,
} from '../../services/keys';
import { SnapshotServiceImpl } from './snapshot';

export const snapshotPlugin: Plugin = {
  id: 'provider.snapshot',
  requires: [SourceFactoryService, DocumentService, EventService, SelectionService, SourceService],
  provides: [SnapshotService],
  setup(ctx) {
    const value = new SnapshotServiceImpl({
      sourceFactory: ctx.get(SourceFactoryService),
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      selection: ctx.get(SelectionService),
      source: ctx.get(SourceService),
    });
    ctx.provide(SnapshotService, value);
  },
};
