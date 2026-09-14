import { pluginSignal } from '../../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import { CanvasRenderService } from './render';
export const renderPlugin: Plugin.Object = {
  name: 'provider.render',
  inject: [
    'cache',
    'document',
    'editState',
    'mapEvents',
    'layers',
    'painterFactory',
    'query',
    'surface',
    'view',
  ],
  provide: ['render'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const value = new CanvasRenderService({
        cache: ctx.cache,
        document: ctx.document,
        editState: ctx.editState,
        events: ctx.mapEvents,
        layers: ctx.layers,
        painterFactory: ctx.painterFactory,
        signal: signal,
        surface: ctx.surface,
        view: ctx.view,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('render', value);
      value.initialize();
      const events = ctx.mapEvents;
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
      const onClear = (event: { sourceId?: string; layerId?: string }) =>
        value.clearLodCache(event);
      events.on('renderrequest', onRender);
      events.on('overlayrequest', onOverlay);
      events.on('move', onMove);
      events.on('resize', onResize);
      events.on('rendercacheclear', onClear);
      yield ctx.effect(() => () => {
        events.off('renderrequest', onRender);
        events.off('overlayrequest', onOverlay);
        events.off('move', onMove);
        events.off('resize', onResize);
        events.off('rendercacheclear', onClear);
      });
      yield ctx.effect(() =>
        ctx.query.setPointLodProvider((source, layer, bounds) =>
          value.getPointLodPick(source, layer, bounds),
        ),
      );
    });
  },
};
