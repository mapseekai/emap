import { pluginSignal } from '../../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import type { EmapHostInternal } from '../../map/emap-host';
/** Trusted mutation bridge for existing command algorithms, independent of the public façade. */
export const operationHostPlugin: Plugin.Object = {
  name: 'provider.operation-host',
  inject: [
    'formats',
    'document',
    'cache',
    'selection',
    'layers',
    'execution',
    'policy',
    'mapEvents',
    'signals',
  ],
  provide: ['host'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const document = ctx.document;
      const cache = ctx.cache;
      const selection = ctx.selection;
      const layers = ctx.layers;
      const execution = ctx.execution;
      const policy = ctx.policy;
      const events = ctx.mapEvents;
      const signals = ctx.signals;
      const host: EmapHostInternal = {
        _formats: ctx.formats,
        get _removed() {
          return document._removed || signal.aborted;
        },
        get _sources() {
          return document._sources;
        },
        get _history() {
          return document._history;
        },
        get _selection() {
          return document._selection;
        },
        get _activeTransaction() {
          return document._activeTransaction;
        },
        set _activeTransaction(value) {
          document._activeTransaction = value;
        },
        get _workerPool() {
          return execution._workerPool;
        },
        get _workerMode() {
          return execution._workerMode;
        },
        get _workerThreshold() {
          return execution._workerThreshold;
        },
        get _workerRouting() {
          return execution._workerRouting;
        },
        layers: document.layers,
        _resolveRenderLayerTarget: (id) => layers._resolveRenderLayerTarget(id),
        _filterMaskForRenderLayer: (id) => layers._filterMaskForRenderLayer(id),
        _scheduleRender: () => signals.requestRender(),
        _fireHistoryChange: () => events.fire('historychange', document._history.snapshot()),
        _fireSelectionChange: (diff) => selection._fireSelectionChange(diff),
        _invalidateShapeCachesForSources: (ids) => cache._invalidateShapeCachesForSources(ids),
        _clearSpatialIndexesForSources: (ids) => cache._clearSpatialIndexesForSources(ids),
        _clearHighlightsForLayer: (source, layerIds) =>
          selection._clearHighlightsForLayer(source, layerIds),
        _allowExpressionEvaluation: (values, operation) =>
          policy._allowExpressionEvaluation(values, operation),
        fire: (type: string, payload: unknown) => {
          events.fire(type, payload);
        },
      };
      yield ctx.provide('host', host);
    });
  },
};
