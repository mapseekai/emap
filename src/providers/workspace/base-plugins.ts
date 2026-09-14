import { FormatService } from '../../services/formats';
import { EventDispatcher } from '../../core/events';
import type { Plugin } from '../../kernel/plugin';
import {
  DocumentService,
  EventService,
  OptionsService,
  RenderSignalService,
  SourceFactoryService,
} from '../../services/keys';
import type { EmapOptions } from '../../services/options';
import { TopologySource } from '../../source/topology-source';
import { RenderSignals } from './signals';

export function optionsPlugin(options: EmapOptions): Plugin {
  return {
    id: 'host.options',
    provides: [OptionsService],
    setup: (ctx) => ctx.provide(OptionsService, options),
  };
}
export const eventsPlugin: Plugin = {
  id: 'provider.events',
  provides: [EventService],
  setup(ctx) {
    ctx.provide(EventService, new EventDispatcher());
  },
};
export const renderSignalsPlugin: Plugin = {
  id: 'provider.render-signals',
  requires: [EventService, DocumentService],
  provides: [RenderSignalService],
  setup(ctx) {
    ctx.provide(
      RenderSignalService,
      new RenderSignals(ctx.get(EventService), ctx.get(DocumentService)),
    );
  },
};
export const topologySourceFactoryPlugin: Plugin = {
  id: 'provider.topology-source',
  requires: [FormatService],
  provides: [SourceFactoryService],
  setup(ctx) {
    const formats = ctx.get(FormatService);
    ctx.provide(SourceFactoryService, {
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
  },
};
