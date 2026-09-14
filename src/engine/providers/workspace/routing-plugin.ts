import type { Plugin } from 'cordis';
import { EventRoutingService } from './routing';
export const routingPlugin: Plugin.Object = {
  name: 'provider.routing',
  inject: ['mapEvents', 'interaction', 'query', 'view'],
  provide: ['routing'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new EventRoutingService({
        events: ctx.mapEvents,
        interaction: ctx.interaction,
        query: ctx.query,
        view: ctx.view,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('routing', value);
    });
  },
};
