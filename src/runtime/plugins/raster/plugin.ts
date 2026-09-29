import type { Plugin } from 'cordis';
import {
  RasterRenderService,
  type RasterRenderOptions,
} from '../../../engine/rendering/raster/service';
import type { RasterContract } from '../../services/contracts/raster';

declare module 'cordis' {
  interface Context {
    raster: RasterContract;
  }
}
/** Optional raster rendering provider; no GeoTIFF dependency in the core map bundle. */
export function rasterPlugin(options: RasterRenderOptions = {}): Plugin.Object {
  return {
    name: 'provider.raster',
    inject: ['render', 'view', 'signals', 'mapEvents'],
    provide: ['raster'],
    apply(ctx) {
      ctx.effect(function* () {
        const raster = new RasterRenderService(
          {
            registerLayerPass: (id, pass) => ctx.render.registerPass(pass, { sourceId: id }),
            getCRS: () => ctx.view.getCRS(),
            requestRender: () => ctx.signals.requestRender(),
            reportError: (id, error) => ctx.mapEvents.fire('rastererror', { sourceId: id, error }),
          },
          options,
        );
        yield async () => {
          raster.dispose();
          await raster.closed;
        };
        const events = ctx.mapEvents;
        const listeners: Record<string, () => void> = {
          interactionstart: () => raster.beginNavigation('pointer'),
          interactionend: () => raster.endNavigation('pointer'),
          movestart: () => raster.beginNavigation('camera'),
          moveend: () => raster.endNavigation('camera'),
          move: () => raster.viewChanged(),
          resize: () => raster.viewChanged(),
          crschange: () => raster.viewChanged(),
        };
        for (const [name, listener] of Object.entries(listeners)) events.on(name, listener);
        yield () => {
          for (const [name, listener] of Object.entries(listeners)) events.off(name, listener);
        };
        yield ctx.render.registerPass(raster.render, 'before-layers');
        yield ctx.provide('raster', raster);
      });
    },
  };
}
