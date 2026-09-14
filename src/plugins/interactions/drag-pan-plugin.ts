import { DragPanHandler } from '../../core/handlers/drag-pan';
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
import { dragPanService } from './keys';

export const dragPanPlugin: Plugin = {
  id: 'feature.interaction.drag-pan',
  requires: [
    InteractionService,
    ViewService,
    SurfaceService,
    OptionsService,
    RenderService,
    QueryService,
    EventService,
  ],
  provides: [dragPanService],
  setup(ctx) {
    const events = ctx.get(EventService);
    const view = ctx.get(ViewService);
    const query = ctx.get(QueryService);
    const renderer = ctx.get(RenderService);
    const handler = new DragPanHandler(
      undefined,
      () => view.stop(),
      (point) => query._isHoveringSelectedAt(point),
    );
    if (ctx.get(OptionsService).interactive === false) handler.disable();
    ctx.defer(
      ctx
        .get(InteractionService)
        .register(handler, { ...builtinInteractionOptions(handler.name), roles: ['pan'] }),
    );
    ctx.provide(dragPanService, handler);
    const pan = (event: { dx: number; dy: number }) => {
      renderer.beginNavigation();
      view._viewport.pan(event.dx, event.dy);
      renderer.updateNavigation();
      events.fire('move');
    };
    const start = () => {
      view._viewport.cancelZoomAnimation();
      renderer.beginNavigation();
    };
    const end = () => renderer.endNavigation();
    handler.on('pan', pan);
    handler.on('panstart', start);
    handler.on('panend', end);
    ctx.defer(() => {
      handler.off('pan', pan);
      handler.off('panstart', start);
      handler.off('panend', end);
    });
  },
};
