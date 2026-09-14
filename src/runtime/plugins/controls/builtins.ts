import type { Plugin } from 'cordis';
import type { Control } from '../../../ui/control';
import { controlPlugin } from './factory';
import { NavigationControl } from '../../../ui/navigation-control';
import { ScaleControl } from '../../../ui/scale-control';
import { StatusControl } from '../../../ui/status-control';
import { LayerControl } from '../../../ui/layer-control';
import { HistoryControl } from '../../../ui/history-control';
import { SimplifyControl } from '../../../ui/simplify-control';
import { BoxSelectControl } from '../../../ui/box-select-control';
import { LassoSelectControl } from '../../../ui/lasso-select-control';
import { VertexEditControl } from '../../../ui/vertex-edit-control';
import { DrawFeatureControl } from '../../../ui/draw-feature-control';
import { MeasureControl } from '../../../ui/measure-control';
import { EditToolbar } from '../../../ui/edit-toolbar';
import { BasemapControl } from '../../../ui/basemap-control';
export const navigationControlPlugin = controlPlugin(
  'navigation',
  (options) =>
    Reflect.construct(NavigationControl, options === undefined ? [] : [options]) as Control,
  ['view'],
);
export const scaleControlPlugin = controlPlugin(
  'scale',
  (options) => Reflect.construct(ScaleControl, options === undefined ? [] : [options]) as Control,
  ['scale'],
);
export const statusControlPlugin = controlPlugin(
  'status',
  (options) => Reflect.construct(StatusControl, options === undefined ? [] : [options]) as Control,
  ['routing', 'view'],
);
export const layersControlPlugin = controlPlugin(
  'layers',
  (options) => Reflect.construct(LayerControl, options === undefined ? [] : [options]) as Control,
  ['layers'],
);
export const historyControlPlugin = controlPlugin(
  'history',
  (options) => Reflect.construct(HistoryControl, options === undefined ? [] : [options]) as Control,
  ['history'],
);
export const simplifyControlPlugin = controlPlugin(
  'simplify',
  (options) =>
    Reflect.construct(SimplifyControl, options === undefined ? [] : [options]) as Control,
  ['ops'],
);
export const boxSelectControlPlugin = controlPlugin(
  'box-select',
  (options) =>
    Reflect.construct(BoxSelectControl, options === undefined ? [] : [options]) as Control,
  ['boxSelect'],
);
export const lassoSelectControlPlugin = controlPlugin(
  'lasso-select',
  (options) =>
    Reflect.construct(LassoSelectControl, options === undefined ? [] : [options]) as Control,
  ['lassoSelect'],
);
export const vertexEditControlPlugin = controlPlugin(
  'vertex-edit',
  (options) =>
    Reflect.construct(VertexEditControl, options === undefined ? [] : [options]) as Control,
  ['vertexEdit'],
);
export const drawControlPlugin = controlPlugin(
  'draw',
  (options) =>
    Reflect.construct(DrawFeatureControl, options === undefined ? [] : [options]) as Control,
  ['drawFeature'],
);
export const measureControlPlugin = controlPlugin(
  'measure',
  (options) => Reflect.construct(MeasureControl, options === undefined ? [] : [options]) as Control,
  ['measure'],
);
export const editToolbarControlPlugin = controlPlugin(
  'edit-toolbar',
  (options) => Reflect.construct(EditToolbar, options === undefined ? [] : [options]) as Control,
  ['vertexEdit', 'drawFeature', 'reshapeFeature', 'ringEdit', 'partEdit', 'autoCompletePolygon'],
);
export const basemapControlPlugin = controlPlugin(
  'basemap',
  (options) => Reflect.construct(BasemapControl, options === undefined ? [] : [options]) as Control,
  ['mapLibre'],
);
export const viewerControlPlugins: readonly Plugin.Object[] = [
  navigationControlPlugin,
  scaleControlPlugin,
  statusControlPlugin,
  layersControlPlugin,
  historyControlPlugin,
  simplifyControlPlugin,
  boxSelectControlPlugin,
  lassoSelectControlPlugin,
];
export const editorControlPlugins: readonly Plugin.Object[] = [
  vertexEditControlPlugin,
  drawControlPlugin,
  measureControlPlugin,
  editToolbarControlPlugin,
];
