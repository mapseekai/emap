import { createEmapWorkerRuntime } from '../../../integrations/tasklane/runtime';
import { EventDispatcher } from '../../core/events';
import type { Plugin } from 'cordis';
import type { EmapOptions } from '../../../runtime/services/options';
import { TopologySource } from '../../../domain/source/topology-source';
import { RenderSignals } from './signals';
export function optionsPlugin(options: EmapOptions): Plugin.Object {
  return {
    name: 'host.options',
    provide: ['options'],
    apply(ctx) {
      ctx.effect(function* () {
        const workerRuntime =
          options.workerRuntime ??
          createEmapWorkerRuntime({
            urls: {
              mapshaper: options.workerUrl ?? 'emap-worker.js',
              geometry: options.geometryWorkerUrl,
              msdf: options.msdfWorkerUrl,
            },
            sizes: { mapshaper: options.workerPoolSize ?? 1 },
          });
        if (!options.workerRuntime) yield () => workerRuntime.dispose();
        yield ctx.provide('options', Object.freeze({ ...options, workerRuntime }));
      });
    },
  };
}
export const eventsPlugin: Plugin.Object = {
  name: 'provider.events',
  provide: ['mapEvents'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.provide('mapEvents', new EventDispatcher());
    });
  },
};
export const renderSignalsPlugin: Plugin.Object = {
  name: 'provider.render-signals',
  inject: ['mapEvents', 'document'],
  provide: ['signals'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.provide('signals', new RenderSignals(ctx.mapEvents, ctx.document));
    });
  },
};
export const topologySourceFactoryPlugin: Plugin.Object = {
  name: 'provider.topology-source',
  inject: ['formats'],
  provide: ['sourceFactory'],
  apply(ctx) {
    ctx.effect(function* () {
      const formats = ctx.formats;
      yield ctx.provide('sourceFactory', {
        create: (id, options) => TopologySource.create(id, options),
        async fromInput(id, input, options) {
          const source = new TopologySource(id, { ...options, formats });
          await source.setData(input);
          return source;
        },
        fromDataset(id, dataset) {
          const source = new TopologySource(id, { formats });
          source.setDataset(dataset, false);
          return source;
        },
      });
    });
  },
};
