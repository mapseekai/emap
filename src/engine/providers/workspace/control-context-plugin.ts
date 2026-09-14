import type { Plugin } from 'cordis';
import type { ControlContext } from '../../../runtime/services/controls';
export const controlContextPlugin: Plugin.Object = {
  name: 'provider.control-context',
  inject: ['routing', 'view', 'scale', 'history', 'layers', 'interaction', 'ops', 'mapEvents'],
  provide: ['controlContext'],
  apply(ctx) {
    ctx.effect(function* () {
      const routing = ctx.routing;
      const view = ctx.view;
      const scale = ctx.scale;
      const history = ctx.history;
      const layers = ctx.layers;
      const interaction = ctx.interaction;
      const ops = ctx.ops;
      const events = ctx.mapEvents;
      const context: ControlContext = {
        get autoCompletePolygon() {
          return interaction.require(
            'autoCompletePolygon',
          ) as ControlContext['autoCompletePolygon'];
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
          const provider = ctx.get('mapLibre');
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
      yield ctx.provide('controlContext', context);
    });
  },
};
