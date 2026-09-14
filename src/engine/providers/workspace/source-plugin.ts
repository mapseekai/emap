import { pluginSignal } from '../../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import { SourceServiceImpl } from './source';
export const sourcePlugin: Plugin.Object = {
  name: 'provider.source',
  inject: [
    'formats',
    'cache',
    'document',
    'mapEvents',
    'history',
    'layers',
    'selection',
    'signals',
    'sourceFactory',
    'view',
  ],
  provide: ['source'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const value = new SourceServiceImpl({
        formats: ctx.formats,
        cache: ctx.cache,
        document: ctx.document,
        events: ctx.mapEvents,
        history: ctx.history,
        layers: ctx.layers,
        selection: ctx.selection,
        signal: signal,
        signals: ctx.signals,
        sourceFactory: ctx.sourceFactory,
        view: ctx.view,
      });
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('source', value);
    });
  },
};
