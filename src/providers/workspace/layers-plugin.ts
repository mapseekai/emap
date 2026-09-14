import type { Plugin } from '../../kernel/plugin';
import {
  DocumentService,
  EventService,
  LayerService,
  RenderSignalService,
} from '../../services/keys';
import { LayerServiceImpl } from './layers';

export const layersPlugin: Plugin = {
  id: 'provider.layers',
  requires: [DocumentService, EventService, RenderSignalService],
  provides: [LayerService],
  setup(ctx) {
    const value = new LayerServiceImpl({
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      signals: ctx.get(RenderSignalService),
    });
    ctx.provide(LayerService, value);
  },
};
