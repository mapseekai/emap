import type { Plugin } from '../../kernel/plugin';
import type { Control } from '../../ui/control';
import { controlPlugin } from './factory';
import {
  HistoryService,
  LayerService,
  MapLibreService,
  MapshaperProcessingService,
  RoutingService,
  ScaleService,
  ViewService,
} from '../../services/keys';
import {
  autoCompletePolygonService,
  boxSelectService,
  drawFeatureService,
  lassoSelectService,
  measureService,
  partEditService,
  reshapeFeatureService,
  ringEditService,
  vertexEditService,
} from '../interactions/keys';
import { NavigationControl } from '../../ui/navigation-control';
import { ScaleControl } from '../../ui/scale-control';
import { StatusControl } from '../../ui/status-control';
import { LayerControl } from '../../ui/layer-control';
import { HistoryControl } from '../../ui/history-control';
import { SimplifyControl } from '../../ui/simplify-control';
import { BoxSelectControl } from '../../ui/box-select-control';
import { LassoSelectControl } from '../../ui/lasso-select-control';
import { VertexEditControl } from '../../ui/vertex-edit-control';
import { DrawFeatureControl } from '../../ui/draw-feature-control';
import { MeasureControl } from '../../ui/measure-control';
import { EditToolbar } from '../../ui/edit-toolbar';
import { BasemapControl } from '../../ui/basemap-control';
export const navigationControlPlugin = controlPlugin(
  'navigation',
  (options) =>
    Reflect.construct(NavigationControl, options === undefined ? [] : [options]) as Control,
  [ViewService],
);
export const scaleControlPlugin = controlPlugin(
  'scale',
  (options) => Reflect.construct(ScaleControl, options === undefined ? [] : [options]) as Control,
  [ScaleService],
);
export const statusControlPlugin = controlPlugin(
  'status',
  (options) => Reflect.construct(StatusControl, options === undefined ? [] : [options]) as Control,
  [RoutingService, ViewService],
);
export const layersControlPlugin = controlPlugin(
  'layers',
  (options) => Reflect.construct(LayerControl, options === undefined ? [] : [options]) as Control,
  [LayerService],
);
export const historyControlPlugin = controlPlugin(
  'history',
  (options) => Reflect.construct(HistoryControl, options === undefined ? [] : [options]) as Control,
  [HistoryService],
);
export const simplifyControlPlugin = controlPlugin(
  'simplify',
  (options) =>
    Reflect.construct(SimplifyControl, options === undefined ? [] : [options]) as Control,
  [MapshaperProcessingService],
);
export const boxSelectControlPlugin = controlPlugin(
  'box-select',
  (options) =>
    Reflect.construct(BoxSelectControl, options === undefined ? [] : [options]) as Control,
  [boxSelectService],
);
export const lassoSelectControlPlugin = controlPlugin(
  'lasso-select',
  (options) =>
    Reflect.construct(LassoSelectControl, options === undefined ? [] : [options]) as Control,
  [lassoSelectService],
);
export const vertexEditControlPlugin = controlPlugin(
  'vertex-edit',
  (options) =>
    Reflect.construct(VertexEditControl, options === undefined ? [] : [options]) as Control,
  [vertexEditService],
);
export const drawControlPlugin = controlPlugin(
  'draw',
  (options) =>
    Reflect.construct(DrawFeatureControl, options === undefined ? [] : [options]) as Control,
  [drawFeatureService],
);
export const measureControlPlugin = controlPlugin(
  'measure',
  (options) => Reflect.construct(MeasureControl, options === undefined ? [] : [options]) as Control,
  [measureService],
);
export const editToolbarControlPlugin = controlPlugin(
  'edit-toolbar',
  (options) => Reflect.construct(EditToolbar, options === undefined ? [] : [options]) as Control,
  [
    vertexEditService,
    drawFeatureService,
    reshapeFeatureService,
    ringEditService,
    partEditService,
    autoCompletePolygonService,
  ],
);
export const basemapControlPlugin = controlPlugin(
  'basemap',
  (options) => Reflect.construct(BasemapControl, options === undefined ? [] : [options]) as Control,
  [MapLibreService],
);
export const viewerControlPlugins: readonly Plugin[] = [
  navigationControlPlugin,
  scaleControlPlugin,
  statusControlPlugin,
  layersControlPlugin,
  historyControlPlugin,
  simplifyControlPlugin,
  boxSelectControlPlugin,
  lassoSelectControlPlugin,
];
export const editorControlPlugins: readonly Plugin[] = [
  vertexEditControlPlugin,
  drawControlPlugin,
  measureControlPlugin,
  editToolbarControlPlugin,
];
