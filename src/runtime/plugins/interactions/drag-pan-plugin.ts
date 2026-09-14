import { DragPanHandler } from '../../../engine/core/handlers/drag-pan';
import type { Plugin } from 'cordis';
import { builtinInteractionOptions } from './defaults';
export const dragPanPlugin: Plugin.Object = {
  name: 'feature.interaction.drag-pan',
  inject: ['interaction', 'view', 'surface', 'options', 'render', 'query', 'mapEvents'],
  provide: ['dragPan'],
  apply(ctx) {
    ctx.effect(function* () {
      const events = ctx.mapEvents;
      const view = ctx.view;
      const query = ctx.query;
      const renderer = ctx.render;
      const handler = new DragPanHandler(
        undefined,
        () => view.stop(),
        (point) => query._isHoveringSelectedAt(point),
      );
      if (ctx.options.interactive === false) handler.disable();
      yield ctx.effect(() =>
        ctx.interaction.register(handler, {
          ...builtinInteractionOptions(handler.name),
          roles: ['pan'],
        }),
      );
      yield ctx.provide('dragPan', handler);
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
      yield ctx.effect(() => () => {
        handler.off('pan', pan);
        handler.off('panstart', start);
        handler.off('panend', end);
      });
    });
  },
};
