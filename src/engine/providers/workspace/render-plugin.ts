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
  async apply(ctx) {
    const controller = new AbortController();
    // Root disposal must cancel an unfinished device request before Cordis waits for
    // this provider to finish loading. Both registrations remain native owned effects.
    ctx.effect(() =>
      ctx.root.effect(() => () => controller.abort(new DOMException('Map disposed', 'AbortError'))),
    );
    const signal = controller.signal;
    // Await the effect: fire-and-forget async effects do not keep the provider LOADING.
    await ctx.effect(async function* () {
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
      yield ctx.effect(() => async () => {
        value.dispose();
        await value.closed;
      });
      await value.initialize();
      signal.throwIfAborted();
      yield ctx.provide('render', value);
      const events = ctx.mapEvents;
      const onRender = (event: {
        action?: import('../../map/types').RenderAction;
        navDelta?: import('../../map/types').AffineDelta;
        settle?: boolean;
      }) => {
        if (event.action === 'nav' && !event.navDelta) value.updateNavigation();
        else value._scheduleRender(event.action, event.navDelta, event.settle);
      };
      const onMoveStart = () => value.beginNavigation();
      const onMoveEnd = () => value.endNavigation();
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
      events.on('movestart', onMoveStart);
      events.on('moveend', onMoveEnd);
      events.on('resize', onResize);
      events.on('rendercacheclear', onClear);
      yield ctx.effect(() => () => {
        events.off('renderrequest', onRender);
        events.off('overlayrequest', onOverlay);
        events.off('move', onMove);
        events.off('movestart', onMoveStart);
        events.off('moveend', onMoveEnd);
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
