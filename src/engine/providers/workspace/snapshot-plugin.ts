import type { Plugin } from 'cordis';
import { SnapshotServiceImpl } from './snapshot';
export const snapshotPlugin: Plugin.Object = {
  name: 'provider.snapshot',
  inject: ['sourceFactory', 'document', 'mapEvents', 'selection', 'source'],
  provide: ['snapshot'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new SnapshotServiceImpl({
        sourceFactory: ctx.sourceFactory,
        document: ctx.document,
        events: ctx.mapEvents,
        selection: ctx.selection,
        source: ctx.source,
      });
      yield ctx.provide('snapshot', value);
    });
  },
};
