---
id: controls
slug: /guides/controls
title: Controls
api: ["BasemapControl", "BasemapOptions", "BasemapStyle", "BoxSelectControl", "BoxSelectControlOptions", "Control", "ControlPosition", "DrawFeatureControl", "DrawFeatureControlOptions", "EditToolbar", "EditToolbarOptions", "Emap", "GetScaleMetricsOptions", "HistoryControl", "HistoryControlOptions", "LassoSelectControl", "LassoSelectControlOptions", "LayerChangeEvent", "LayerChangeReason", "LayerControl", "MapLibreBasemapService", "MapLibreIntegrationOptions", "MapLibreOverlayService", "MapLibreOverlayServiceBase", "MapLibreOverlayResourceService", "MapLibreOverlayStyleService", "MapLibreServiceChangeEvent", "MapLibreServiceChangeReason", "MapLibreServiceErrorEvent", "MapLibreServiceEventMap", "MapLibreServiceManager", "MapLibreServiceState", "MapOptions", "MeasureControl", "MeasureControlOptions", "MeasureHandler", "MeasurementMode", "MeasureOptions", "MeasureResult", "NavigationControl", "NavigationOptions", "ScaleCalculationMethod", "ScaleControl", "ScaleControlOptions", "ScaleControlStyle", "ScaleMetrics", "ScaleViewMetrics", "SimplifyControl", "SimplifyControlOptions", "StatusControl", "StatusOptions", "VertexEditControl", "VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","measurement","online-map-services","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.14.0
---

# Controls

Emap provides navigation, scale, layer, selection, editing, measurement, and history controls. Mount these optional DOM interfaces in map corners and manage their state and lifetime through `Emap`.

```ts
import '@mapseekai/emap/style.css'; // load control styles
import { HistoryControl, NavigationControl, ScaleControl } from '@mapseekai/emap'; // import built-in controls

const navigation = new NavigationControl({ showHome: true }); // create a navigation control
await map.addControl(navigation, 'top-left'); // mount it in the top-left corner
await map.addControl(new HistoryControl(), 'top-right'); // mount undo/redo controls
await map.addControl(new ScaleControl(), 'bottom-left'); // mount a scale control

await map.removeControl(navigation); // remove the control when it is no longer needed
```

## Core methods

`addControl(control, position?)` mounts a control at `'top-left'` by default; `removeControl(control)` removes a mounted control. A control implements `onAdd(map)` and `onRemove(map?)`.

## More controls and parameters

| Control | Purpose |
| --- | --- |
| `NavigationControl` | Zoom and reset the view |
| `StatusControl` | Display status text |
| `ScaleControl` | Display a scale derived from CRS and view |
| `HistoryControl` | Undo and redo buttons |
| `LayerControl` | Toggle Emap layer visibility |
| `BasemapControl` | Select a registered MapLibre basemap |
| `DrawFeatureControl`, `VertexEditControl`, `EditToolbar` | Activate editing tools |
| `MeasureControl` | Activate length or area measurement |
| `BoxSelectControl`, `LassoSelectControl` | Activate selection drag tools |
| `SimplifyControl` | Run a simplify operation |

Drawing and measurement controls need their own options:

```ts
await map.addControl(
  new DrawFeatureControl({ source: 'parcels', sourceLayer: 'lots', type: 'polygon' }),
  'top-left',
);
await map.addControl(new MeasureControl({ mode: 'area' }), 'top-left');
```

## Constructor options

### `NavigationControl`

`new NavigationControl(options?)` provides zoom and reset controls.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `showZoom` | `boolean` | `true` | Shows zoom buttons. |
| `showHome` | `boolean` | `true` | Shows reset-view button and fires `reset`. |
| `className` | `string` | `undefined` | Container CSS class. |

### `StatusControl`

`new StatusControl(options?)` shows pointer coordinates and CRS.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `showMousePos` | `boolean` | `true` | Shows pointer coordinates (four decimals). |
| `showEPSG` | `boolean` | `true` | Shows and updates current EPSG. |
| `alignment` | `'left' \| 'right' \| 'center'` | `'left'` | Content alignment. |
| `className` | `string` | `undefined` | Container CSS class. |

### `ScaleControl`

`new ScaleControl(options?)` shows scale updated from view and CRS.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `units` | `'metric' \| 'imperial' \| 'dual'` | `'metric'` | Scale units; `'dual'` shows both. |
| `calculationMethod` | `'top' \| 'center' \| 'bottom' \| 'average' \| 'equator'` | `'center'` | View location or aggregation for meters per pixel. |
| `maxWidth` | `number` | `140` | Maximum distance-bar CSS-pixel width. |
| `dpi` | `number` | `96` | Display DPI for scale denominator. |
| `showScale` | `boolean` | `true` | Shows scale denominator and distance bar. |
| `showZoom` | `boolean` | `true` | Shows zoom level. |
| `style` | `'checker' \| 'line' \| 'ruler' \| 'steps' \| 'solid' \| 'minimal'` | `'checker'` | Distance-bar style. |
| `className` | `string` | `undefined` | Container CSS class. |

### `HistoryControl`

`new HistoryControl(options?)` provides undo and redo.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `undoTitle` | `string` | `'Undo (Ctrl+Z)'` | Undo-button tooltip. |
| `redoTitle` | `string` | `'Redo (Ctrl+Shift+Z)'` | Redo-button tooltip. |
| `className` | `string` | `undefined` | Container CSS class. |

### `LayerControl`

`new LayerControl()` lists layers and MapLibre overlays with visibility toggles; it has no constructor options and follows layer and service-registry updates.

### `BasemapControl`

`new BasemapControl(options?)` shows a MapLibre basemap radio panel: `styles` (`BasemapStyle[]`, defaulting to OSM, CartoDB Light, and CartoDB Dark) lists legacy basemap styles, and `defaultStyle` (`string`, default `undefined`) names the initially active legacy style.

`BasemapStyle` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | Required | Panel display name. |
| `url` | `string` | Required | MapLibre style or tile URL. |
| `type` | `'vector' \| 'raster'` | Inferred | Style type; `{z}` URLs are raster tiles. |

### `DrawFeatureControl`

`new DrawFeatureControl(options)` provides a drawing button for one geometry type.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Target source ID for new features. |
| `sourceLayer` | `string` | First matching geometry layer | Target layer name. |
| `type` | `'polygon' \| 'polyline' \| 'point'` | Required | Geometry type to create. |
| `snapThreshold` | `number` | `10` | Vertex or edge snap threshold in pixels. |
| `snapSources` | `string[]` | `[source]` | Source IDs providing snap targets. |
| `snapToVertex` | `boolean` | `true` | Enables vertex snapping. |
| `snapToEdge` | `boolean` | `true` | Enables edge snapping. |
| `drawColor` | `string` | `EMAP_THEME_COLORS.primary` | Drawing-feedback CSS color. |
| `icon` | `string \| Node` | Built-in SVG selected by `type` | Button icon. |

### `VertexEditControl`

`new VertexEditControl(options?)` provides a vertex-editing toggle: `polygonFillColor` (`string`, defaulting to the current VertexEdit handler value) is the hover-fill CSS color.

### `EditToolbar`

`new EditToolbar(options?)` combines editing and drawing buttons.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `controls` | `Control[]` | `undefined` | Explicit controls. |
| `drawSource` | `string` | `undefined` | Adds drawing buttons for this source. |
| `drawSourceLayer` | `string` | First matching geometry layer | Source layer for automatic drawing. |
| `advancedTools` | `boolean` | `false` | Adds advanced editing buttons. |

### `MeasureControl`

`new MeasureControl(options)` provides one measurement-mode button.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `'length' \| 'area'` | Required | Measurement mode. |
| `drawColor` | `string` | `EMAP_THEME_COLORS.primary` | Sketch and result CSS color. |
| `icon` | `string \| Node` | Built-in SVG selected by `mode` | Button icon. |

### `BoxSelectControl`

`new BoxSelectControl(options?)` enables rectangle selection when mounted: left drag replaces, `Shift` adds, and `Shift+Alt` toggles.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `layers` | `string[]` | All visible layers | Layer IDs participating in box selection. |
| `style` | `BoxSelectStyle` | See below | Rectangle appearance. |
| `dragThreshold` | `number` | `4` | Minimum drag diagonal in pixels. |
| `dragActivator` | `ModifierCombo` | `'none'` | Modifier combination that starts a drag. |

`BoxSelectStyle` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | `string` | Current theme primary color | Dashed-border CSS color. |
| `strokeWidth` | `number` | `1.5` | Border CSS-pixel width. |
| `fill` | `string` | `'transparent'` | Fill CSS color. |

### `LassoSelectControl`

`new LassoSelectControl(options?)` enables lasso selection when mounted: `Shift`+left drag starts, `Shift+Ctrl` or `Shift+Meta` adds, and `Shift+Alt` toggles.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `layers` | `string[]` | All visible layers | Layer IDs participating in lasso selection. |
| `style` | `LassoSelectStyle` | See below | SVG lasso appearance. |
| `dragThreshold` | `number` | `4` | Minimum drag diagonal in pixels. |
| `includeIntersecting` | `boolean` | `true` | Selects lasso-intersecting features. |

`LassoSelectStyle` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | `string` | Current theme primary color | Lasso-line CSS color. |
| `strokeWidth` | `number` | `1.5` | Lasso-line CSS-pixel width. |
| `fill` | `string` | `'none'` | Closed-lasso fill. |
| `strokeDasharray` | `string` | `'4 3'` | SVG dash rhythm. |

### `SimplifyControl`

`new SimplifyControl(options)` opens a simplify panel and records history.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Source ID to simplify. |
| `target` | `string` | Entire source dataset | Layer name to simplify. |
| `initialPercentage` | `number` | `10` | Initial retained-vertex percentage (`0`–`100`, `0.1` step). |
| `initialMethod` | `'dp' \| 'visvalingam' \| 'weighted'` | `'weighted'` | Initial algorithm; `'dp'` is Douglas–Peucker. |
| `title` | `string` | `'Simplify geometry'` | Button tooltip. |

## Runnable examples

- [China editing](/mapseekai/emap/examples/china-editing/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Measurement](/mapseekai/emap/examples/measurement/)
