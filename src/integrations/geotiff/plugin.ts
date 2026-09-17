import type { Plugin } from 'cordis';
import '../../runtime/plugins/raster/plugin';
import { pluginSignal } from '../../runtime/context/cancellation';
import { RasterError } from '../../domain/raster/policy';
import type { RasterMetadata, RasterStyle, RasterReference } from '../../domain/raster/types';
import { openGeoTIFF, openGeoTIFFHandle, type OpenGeoTIFFOptions } from './source';

export interface GeoTIFFPluginOptions {
  readonly workerUrl?: string | URL;
  readonly workerCount?: number;
}
export interface GeoTIFFAddOptions extends OpenGeoTIFFOptions {
  readonly style?: RasterStyle;
  readonly expected?: RasterReference;
}
export interface GeoTIFFContract {
  addFile(id: string, file: File, options?: GeoTIFFAddOptions): Promise<RasterMetadata>;
  addHandle(
    id: string,
    handle: FileSystemFileHandle,
    options?: GeoTIFFAddOptions,
  ): Promise<RasterMetadata>;
}
declare module 'cordis' {
  interface Context {
    geoTIFF: GeoTIFFContract;
  }
}

/** Local-file loading, not DatasetFormatPlugin.importBinary: input bytes never enter vector storage. */
export function geoTIFFPlugin(options: GeoTIFFPluginOptions = {}): Plugin.Object {
  return {
    name: 'provider.geotiff',
    inject: ['raster'],
    provide: ['geoTIFF'],
    apply(ctx) {
      const lifetime = pluginSignal(ctx),
        loading = new Set<string>(),
        owned = new WeakSet<RasterMetadata>();
      // Only currently registered layers own strong references; removed metadata
      // must remain collectible even while this loader plugin stays mounted.
      const raster = ctx.raster;
      const add = async (
        id: string,
        input: File | FileSystemFileHandle,
        config: GeoTIFFAddOptions = {},
      ) => {
        lifetime.throwIfAborted();
        config.signal?.throwIfAborted();
        if (loading.has(id) || raster.getLayers().some((layer) => layer.id === id))
          throw new RasterError(
            'INVALID_RASTER_LAYER_ID',
            'Raster id is already loaded or loading.',
          );
        if (loading.size >= 4)
          throw new RasterError(
            'RASTER_OPEN_BUDGET',
            'At most four raster metadata reads may be pending.',
          );
        loading.add(id);
        const controller = new AbortController();
        const abort = () => controller.abort(config.signal?.reason ?? lifetime.reason);
        lifetime.addEventListener('abort', abort, { once: true });
        config.signal?.addEventListener('abort', abort, { once: true });
        try {
          const openOptions = { ...options, ...config, signal: controller.signal };
          const source =
            'getFile' in input
              ? await openGeoTIFFHandle(input, openOptions)
              : await openGeoTIFF(input, openOptions);
          try {
            controller.signal.throwIfAborted();
            raster.addSource(id, source, config.style);
          } catch (error) {
            source.dispose();
            throw error;
          }
          owned.add(source.metadata);
          return source.metadata;
        } finally {
          loading.delete(id);
          lifetime.removeEventListener('abort', abort);
          config.signal?.removeEventListener('abort', abort);
        }
      };
      ctx.effect(function* () {
        yield () => {
          const failures: unknown[] = [];
          for (const { id, metadata } of raster.getLayers()) {
            if (!owned.has(metadata)) continue;
            try {
              raster.remove(id);
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length)
            throw new AggregateError(failures, 'Unable to close some GeoTIFF sources');
        };
        yield ctx.provide('geoTIFF', { addFile: add, addHandle: add } satisfies GeoTIFFContract);
      });
    },
  };
}
