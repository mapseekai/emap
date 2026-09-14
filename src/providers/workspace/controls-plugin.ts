import type { Plugin } from '../../kernel/plugin';
import {
  ControlContextService,
  ControlsService,
  EventService,
  SurfaceService,
} from '../../services/keys';
import { ControlServiceImpl } from './controls';

export const controlsPlugin: Plugin = {
  id: 'provider.controls',
  requires: [ControlContextService, EventService, SurfaceService],
  provides: [ControlsService],
  setup(ctx) {
    const value = new ControlServiceImpl({
      controlContext: ctx.get(ControlContextService),
      events: ctx.get(EventService),
      surface: ctx.get(SurfaceService),
    });
    ctx.defer(() => value.dispose());
    ctx.provide(ControlsService, value);
  },
};
