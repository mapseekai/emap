---
id: controls
slug: /guides/controls
title: Controls
api: ["BasemapControl", "BasemapOptions", "BasemapStyle", "BoxSelectControl", "BoxSelectControlOptions", "Control", "ControlPosition", "DrawFeatureControl", "DrawFeatureControlOptions", "EditToolbar", "EditToolbarOptions", "Emap", "GetScaleMetricsOptions", "HistoryControl", "HistoryControlOptions", "LassoSelectControl", "LassoSelectControlOptions", "LayerChangeEvent", "LayerChangeReason", "LayerControl", "MapLibreBasemapService", "MapLibreIntegrationOptions", "MapLibreOverlayService", "MapLibreOverlayServiceBase", "MapLibreOverlayResourceService", "MapLibreOverlayStyleService", "MapLibreServiceChangeEvent", "MapLibreServiceChangeReason", "MapLibreServiceErrorEvent", "MapLibreServiceEventMap", "MapLibreServiceManager", "MapLibreServiceState", "MapOptions", "MeasureControl", "MeasureControlOptions", "MeasureHandler", "MeasurementMode", "MeasureOptions", "MeasureResult", "NavigationControl", "NavigationOptions", "ScaleCalculationMethod", "ScaleControl", "ScaleControlOptions", "ScaleControlStyle", "ScaleMetrics", "ScaleViewMetrics", "SimplifyControl", "SimplifyControlOptions", "StatusControl", "StatusOptions", "VertexEditControl", "VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","measurement","online-map-services","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: unreleased
---

# Controls

Controls are optional DOM UI mounted in a map corner. They call public map APIs or configure handlers; they do not keep another copy of map state.

## Add and remove controls

Import the control CSS, then add an instance at a position:

```ts
import '@mapseekai/emap/style.css';
import { HistoryControl, NavigationControl, ScaleControl } from '@mapseekai/emap';

const navigation = new NavigationControl({ showHome: true });
await map.addControl(navigation, 'top-left');
await map.addControl(new HistoryControl(), 'top-right');
await map.addControl(new ScaleControl(), 'bottom-left');

await map.removeControl(navigation);
```

Positions are `top-left`, `top-right`, `bottom-left`, and `bottom-right`.

## Choose a built-in control

| Control | Purpose |
|---|---|
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

When removed, a control cleans up its DOM and listeners. A control that enables a handler also disables that handler when it is removed.

## Runnable examples

- [China editing](/mapseekai/emap/examples/china-editing/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Measurement](/mapseekai/emap/examples/measurement/)
