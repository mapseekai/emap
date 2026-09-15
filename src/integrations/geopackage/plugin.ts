import type { Plugin } from 'cordis';
import type { DatasetFormatPlugin } from '../../runtime/services/formats';
import { importGeoPackage } from './import';
import { importGeoPackageInWorker } from './worker';
import type { GeoPackagePluginOptions } from './types';

/** Explicit vector format registration, owned by a native Cordis Fiber. */
export function geoPackagePlugin(options: GeoPackagePluginOptions = {}): Plugin.Object {
  return {
    name: 'feature.format.geopackage',
    inject: ['formats'],
    apply(ctx) {
      const controller = new AbortController();
      ctx.effect(function* () {
        yield () => controller.abort(new DOMException('GeoPackage plugin unloaded', 'AbortError'));
        const externalAbort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) externalAbort();
        else if (options.signal) {
          options.signal.addEventListener('abort', externalAbort, { once: true });
          yield () => options.signal!.removeEventListener('abort', externalAbort);
        }
        const codec: DatasetFormatPlugin = {
          name: 'geopackage',
          extensions: ['gpkg'],
          exportFormats: {},
          async importBinary(content, filename) {
            const config = { ...options, signal: controller.signal };
            const dataset = options.workerUrl
              ? await importGeoPackageInWorker(content, { ...config, workerUrl: options.workerUrl })
              : await importGeoPackage(content, config);
            dataset.info.input_files = [filename];
            return dataset;
          },
        };
        yield ctx.effect(() => ctx.formats.register(codec));
      });
    },
  };
}
