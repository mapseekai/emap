import type { Plugin } from '../../kernel/plugin';
import { createMapLibreServiceManager } from '../../map/maplibre-service-manager';
import {
  EventService,
  MapLibreService,
  OptionsService,
  ProjectionService,
  SurfaceService,
  ViewService,
} from '../../services/keys';

/** MapLibre is an online-layer provider, not the owner of editable topology. */
export const mapLibrePlugin: Plugin = {
  id: 'provider.maplibre',
  requires: [SurfaceService, ViewService, ProjectionService, OptionsService, EventService],
  provides: [MapLibreService],
  setup(ctx) {
    const surface = ctx.get(SurfaceService);
    const view = ctx.get(ViewService);
    const projection = ctx.get(ProjectionService);
    const events = ctx.get(EventService);
    const options = ctx.get(OptionsService).mapLibre;
    const manager = createMapLibreServiceManager(
      {
        getCanvasContainer: () => surface.getCanvasContainer(),
        getCRS: () => view.getCRS(),
        reproject: (crs) => projection.reproject(crs),
        getCenter: () => view.getCenter(),
        getZoom: () => view.getZoom(),
        on: (type, listener) => events.on(type, listener),
        off: (type, listener) => events.off(type, listener),
      },
      options,
    );
    ctx.defer(() => manager.destroy());
    ctx.provide(MapLibreService, manager);
    if (options) void manager.initialize().catch(() => undefined);
  },
};
