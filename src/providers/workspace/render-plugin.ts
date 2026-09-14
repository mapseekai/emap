import type { Plugin } from '../../kernel/plugin';
import {
  CacheService,
  DocumentService,
  EditStateService,
  EventService,
  LayerService,
  PainterFactoryService,
  QueryService,
  RenderService,
  SurfaceService,
  ViewService,
} from '../../services/keys';
import { CanvasRenderService } from './render';

export const renderPlugin: Plugin = {
  id: 'provider.render',
  requires: [
    CacheService,
    DocumentService,
    EditStateService,
    EventService,
    LayerService,
    PainterFactoryService,
    QueryService,
    SurfaceService,
    ViewService,
  ],
  provides: [RenderService],
  setup(ctx) {
    const value = new CanvasRenderService({
      cache: ctx.get(CacheService),
      document: ctx.get(DocumentService),
      editState: ctx.get(EditStateService),
      events: ctx.get(EventService),
      layers: ctx.get(LayerService),
      painterFactory: ctx.get(PainterFactoryService),
      signal: ctx.signal,
      surface: ctx.get(SurfaceService),
      view: ctx.get(ViewService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(RenderService, value);
    value.initialize();
    const events = ctx.get(EventService);
    const onRender = (event: {
      action?: import('../../map/types').RenderAction;
      navDelta?: import('../../map/types').AffineDelta;
      settle?: boolean;
    }) => value._scheduleRender(event.action, event.navDelta, event.settle);
    const onOverlay = () => value._scheduleOverlayRender();
    const onMove = () => {
      if (!value._navSnapshotTransform) value._scheduleRender();
    };
    const onResize = () => value._scheduleRender();
    const onClear = (event: { sourceId?: string; layerId?: string }) => value.clearLodCache(event);
    events.on('renderrequest', onRender);
    events.on('overlayrequest', onOverlay);
    events.on('move', onMove);
    events.on('resize', onResize);
    events.on('rendercacheclear', onClear);
    ctx.defer(() => {
      events.off('renderrequest', onRender);
      events.off('overlayrequest', onOverlay);
      events.off('move', onMove);
      events.off('resize', onResize);
      events.off('rendercacheclear', onClear);
    });
    ctx.defer(
      ctx
        .get(QueryService)
        .setPointLodProvider((source, layer, bounds) =>
          value.getPointLodPick(source, layer, bounds),
        ),
    );
  },
};
