import type { Plugin } from '../../kernel/plugin';
import {
  EventService,
  InteractionService,
  QueryService,
  RoutingService,
  ViewService,
} from '../../services/keys';
import { EventRoutingService } from './routing';

export const routingPlugin: Plugin = {
  id: 'provider.routing',
  requires: [EventService, InteractionService, QueryService, ViewService],
  provides: [RoutingService],
  setup(ctx) {
    const value = new EventRoutingService({
      events: ctx.get(EventService),
      interaction: ctx.get(InteractionService),
      query: ctx.get(QueryService),
      view: ctx.get(ViewService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(RoutingService, value);
  },
};
