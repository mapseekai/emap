import { ScrollZoomHandler } from '../../core/handlers/scroll-zoom';
import type { Plugin } from '../../kernel/plugin';
import {
  EventService,
  InteractionService,
  OptionsService,
  QueryService,
  RenderService,
  SurfaceService,
  ViewService,
} from '../../services/keys';
import { builtinInteractionOptions } from './defaults';
import { scrollZoomService } from './keys';

export const scrollZoomPlugin: Plugin = {
  id: 'feature.interaction.scroll-zoom',
  requires: [
    InteractionService,
    ViewService,
    SurfaceService,
    OptionsService,
    RenderService,
    QueryService,
    EventService,
  ],
  provides: [scrollZoomService],
  setup(ctx) {
    const events = ctx.get(EventService);
    const view = ctx.get(ViewService);
    const surface = ctx.get(SurfaceService);
    const renderer = ctx.get(RenderService);
    const handler = new ScrollZoomHandler(surface.getCanvasContainer(), () => view.stop());
    ctx.defer(() => handler.destroy());
    if (ctx.get(OptionsService).interactive === false) handler.disable();
    ctx.defer(
      ctx
        .get(InteractionService)
        .register(handler, { ...builtinInteractionOptions(handler.name), roles: ['zoom'] }),
    );
    ctx.provide(scrollZoomService, handler);
    const zoom = (event: { direction: number; multiplier: number; x: number; y: number }) => {
      renderer.beginNavigation();
      view._viewport.applyWheelZoom(event.direction, event.multiplier, event.x, event.y);
      renderer.updateNavigation();
      events.fire('move');
      renderer.settleNavigation(250);
    };
    handler.on('mousewheel', zoom);
    ctx.defer(() => {
      handler.off('mousewheel', zoom);
      renderer.cancelNavigation();
    });
  },
};
