import type { Plugin } from '../../kernel/plugin';
import type { ControlContext } from '../../services/controls';
import {
  ControlContextService,
  EventService,
  HistoryService,
  InteractionService,
  LayerService,
  MapLibreService,
  MapshaperProcessingService,
  RoutingService,
  ScaleService,
  ViewService,
} from '../../services/keys';

export const controlContextPlugin: Plugin = {
  id: 'provider.control-context',
  requires: [
    RoutingService,
    ViewService,
    ScaleService,
    HistoryService,
    LayerService,
    InteractionService,
    MapshaperProcessingService,
    EventService,
  ],
  optional: [MapLibreService],
  provides: [ControlContextService],
  setup(ctx) {
    const routing = ctx.get(RoutingService);
    const view = ctx.get(ViewService);
    const scale = ctx.get(ScaleService);
    const history = ctx.get(HistoryService);
    const layers = ctx.get(LayerService);
    const interaction = ctx.get(InteractionService);
    const ops = ctx.get(MapshaperProcessingService);
    const events = ctx.get(EventService);
    const context: ControlContext = {
      get autoCompletePolygon() {
        return interaction.require('autoCompletePolygon') as ControlContext['autoCompletePolygon'];
      },
      get boxSelect() {
        return interaction.require('boxSelect') as ControlContext['boxSelect'];
      },
      canRedo: (...args) => history.canRedo(...args),
      canUndo: (...args) => history.canUndo(...args),
      get drawFeature() {
        return interaction.require('drawFeature') as ControlContext['drawFeature'];
      },
      fire(type, data) {
        events.fire(type, data);
        return context;
      },
      getCRS: (...args) => view.getCRS(...args),
      getRenderedLayers: (...args) => layers.getRenderedLayers(...args),
      getScaleMetrics: (...args) => scale.getScaleMetrics(...args),
      get lassoSelect() {
        return interaction.require('lassoSelect') as ControlContext['lassoSelect'];
      },
      get mapLibreServices() {
        const provider = ctx.optional(MapLibreService);
        if (!provider)
          throw new Error(
            'MapLibre provider is not installed; add mapLibrePlugin from @mapseekai/emap/maplibre',
          );
        return provider;
      },
      get measure() {
        return interaction.require('measure') as ControlContext['measure'];
      },
      off: ((...args: unknown[]) => {
        Reflect.apply(routing.off, routing, args);
        return context;
      }) as ControlContext['off'],
      on: ((...args: unknown[]) => {
        Reflect.apply(routing.on, routing, args);
        return context;
      }) as ControlContext['on'],
      ops,
      get partEdit() {
        return interaction.require('partEdit') as ControlContext['partEdit'];
      },
      redo: (...args) => history.redo(...args),
      get reshapeFeature() {
        return interaction.require('reshapeFeature') as ControlContext['reshapeFeature'];
      },
      get ringEdit() {
        return interaction.require('ringEdit') as ControlContext['ringEdit'];
      },
      setLayerVisibility: (...args) => layers.setLayerVisibility(...args),
      undo: (...args) => history.undo(...args),
      get vertexEdit() {
        return interaction.require('vertexEdit') as ControlContext['vertexEdit'];
      },
      zoomIn: (...args) => view.zoomIn(...args),
      zoomOut: (...args) => view.zoomOut(...args),
    };
    ctx.provide(ControlContextService, context);
  },
};
