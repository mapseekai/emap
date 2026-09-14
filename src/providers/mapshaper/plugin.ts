import { scopedOperationHost } from '../../map/operation-scope';
import type { Plugin } from '../../kernel/plugin';
import { MapshaperOps } from '../../map/mapshaper-ops';
import { MapshaperProcessingService, OperationHostService } from '../../services/keys';

export const mapshaperProcessingPlugin: Plugin = {
  id: 'feature.mapshaper-processing',
  requires: [OperationHostService],
  provides: [MapshaperProcessingService],
  setup(ctx) {
    ctx.provide(
      MapshaperProcessingService,
      new MapshaperOps(scopedOperationHost(ctx.get(OperationHostService), ctx.signal)),
    );
  },
};
