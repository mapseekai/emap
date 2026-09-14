import { ScrollZoomHandler } from '../../../engine/core/handlers/scroll-zoom';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
export const scrollZoomPlugin: Plugin.Object = {
  name: 'feature.interaction.scroll-zoom',
  inject: ['interaction', 'view', 'surface', 'options', 'render', 'query', 'mapEvents'],
  provide: ['scrollZoom'],
  apply(ctx) {
    ctx.effect(function* () {
      const events = ctx.mapEvents;
      const view = ctx.view;
      const surface = ctx.surface;
      const renderer = ctx.render;
      const handler = new ScrollZoomHandler(surface.getCanvasContainer(), () => view.stop());
      yield ctx.effect(() => () => handler.destroy());
      if (ctx.options.interactive === false) handler.disable();
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          roles: ['zoom'],
        }),
      );
      yield ctx.provide('scrollZoom', handler);
      const zoom = (event: { direction: number; multiplier: number; x: number; y: number }) => {
        renderer.beginNavigation();
        view._viewport.applyWheelZoom(event.direction, event.multiplier, event.x, event.y);
        renderer.updateNavigation();
        events.fire('move');
        renderer.settleNavigation(250);
      };
      handler.on('mousewheel', zoom);
      yield ctx.effect(() => () => {
        handler.off('mousewheel', zoom);
        renderer.cancelNavigation();
      });
    });
  },
};
