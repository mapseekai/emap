import type { Plugin } from 'cordis';
import { createMapLibreServiceManager } from './maplibre-service-manager';
/** MapLibre is an online-layer provider, not the owner of editable topology. */
export const mapLibrePlugin: Plugin.Object = {
  name: 'provider.maplibre',
  inject: ['surface', 'view', 'projection', 'options', 'mapEvents'],
  provide: ['mapLibre'],
  apply(ctx) {
    ctx.effect(function* () {
      const surface = ctx.surface;
      const view = ctx.view;
      const projection = ctx.projection;
      const events = ctx.mapEvents;
      const options = ctx.options.mapLibre;
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
      yield ctx.effect(() => () => manager.destroy());
      yield ctx.provide('mapLibre', manager);
      if (options) void manager.initialize().catch(() => undefined);
    });
  },
};
