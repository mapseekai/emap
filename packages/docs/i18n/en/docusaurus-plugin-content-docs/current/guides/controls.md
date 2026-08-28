---
id: controls
slug: /guides/controls
title: Controls
api: ["BasemapControl","BasemapOptions","BasemapStyle","BoxSelectControl","BoxSelectControlOptions","Control","ControlPosition","DrawFeatureControl","DrawFeatureControlOptions","EditToolbar","EditToolbarOptions","Emap","GetScaleMetricsOptions","HistoryControl","HistoryControlOptions","LassoSelectControl","LassoSelectControlOptions","LayerChangeEvent","LayerChangeReason","LayerControl","MapLibreBasemapService","MapLibreIntegrationOptions","MapLibreOverlayService","MapLibreOverlayServiceBase","MapLibreOverlayResourceService","MapLibreOverlayStyleService","MapLibreService","MapLibreServiceChangeEvent","MapLibreServiceChangeReason","MapLibreServiceErrorEvent","MapLibreServiceEventMap","MapLibreServiceManager","MapLibreServiceState","MapOptions","MeasureControl","MeasureControlOptions","MeasureHandler","MeasurementMode","MeasureOptions","MeasureResult","NavigationControl","NavigationOptions","ScaleCalculationMethod","ScaleControl","ScaleControlOptions","ScaleControlStyle","ScaleMetrics","ScaleViewMetrics","SimplifyControl","SimplifyControlOptions","StatusControl","StatusOptions","VertexEditControl","VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","measurement","online-map-services","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.7.0
---

# Controls

Controls are optional DOM surfaces mounted in the map corners. They call public
map APIs or switch handlers and do not own a second copy of map state. Use all
built-in controls, a subset, or only the engine under custom application UI.

## Add and remove

```ts
const navigation = new NavigationControl();

map.addControl(navigation, 'top-left');
map.removeControl(navigation);
```

Positions are `top-left`, `top-right`, `bottom-left`, and `bottom-right`.
The default is `top-left`. Removal requires the same control instance.

## Control styles

Built-in controls require:

```ts
import '@mapseekai/emap/style.css';
```

Controls mount inside the map container, so page-level CSS may affect buttons,
inputs, and fonts. Scope application overrides through an outer application
class.

## Built-in controls

| Control | Purpose |
|---|---|
| `NavigationControl` | Zoom and view navigation |
| `HistoryControl` | Undo and redo |
| `StatusControl` | Pointer coordinates and EPSG display |
| `ScaleControl` | Current-view scale and zoom display |
| `MeasureControl` | Spherical length or area measurement |
| `BasemapControl` | Select one registered MapLibre basemap |
| `LayerControl` | Toggle Emap business layers and MapLibre online overlays |
| `BoxSelectControl` | Box selection |
| `LassoSelectControl` | Lasso selection |
| `VertexEditControl` | Vertex-edit mode |
| `DrawFeatureControl` | Point, line, or polygon drawing |
| `EditToolbar` | Common editing modes |
| `SimplifyControl` | Preview and commit simplification |

## Native MapLibre online services

`mapLibre.services` accepts native MapLibre style and source specifications.
A basemap owns a complete style; an overlay owns named sources and layers that
the manager restores after a basemap style change.

### Raster service templates

The following helper keeps complete overlay definitions compact while leaving
each source as native MapLibre configuration:

```ts
import type {
  MapLibreOverlayResourceService,
} from '@mapseekai/emap';

function rasterOverlay(
  id: string,
  name: string,
  source: MapLibreOverlayResourceService['sources'][string],
): MapLibreOverlayResourceService {
  return {
    id,
    name,
    role: 'overlay',
    sources: { [id]: source },
    layers: [{ id: `${id}-layer`, type: 'raster', source: id }],
  };
}

const overlays: MapLibreOverlayResourceService[] = [
  // XYZ raster tiles
  rasterOverlay('xyz', 'XYZ imagery', {
    type: 'raster',
    tiles: ['https://tiles.example.com/xyz/{z}/{x}/{y}.png'],
    tileSize: 256,
  }),

  // TMS flips the native {y} tile coordinate.
  rasterOverlay('tms', 'TMS imagery', {
    type: 'raster',
    tiles: ['https://tiles.example.com/tms/{z}/{x}/{y}.png'],
    scheme: 'tms',
    tileSize: 256,
  }),

  // WMS GetMap in Web Mercator
  rasterOverlay('wms', 'WMS weather', {
    type: 'raster',
    tiles: [
      'https://maps.example.com/wms?service=WMS&request=GetMap&version=1.1.1&layers=weather&styles=&format=image/png&transparent=true&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256',
    ],
    tileSize: 256,
  }),

  // RESTful WMTS template supplied by the provider
  rasterOverlay('wmts', 'WMTS imagery', {
    type: 'raster',
    tiles: [
      'https://tiles.example.com/wmts/world/default/WebMercatorQuad/{z}/{y}/{x}.png',
    ],
    tileSize: 256,
  }),

  // The URL points to a TileJSON document instead of an individual tile.
  rasterOverlay('tilejson', 'TileJSON imagery', {
    type: 'raster',
    url: 'https://tiles.example.com/imagery/tiles.json',
  }),
];
```

These are URL/source descriptions, not service-discovery requests. Emap does
not fetch WMS/WMTS GetCapabilities or convert an arbitrary service CRS. Use an
endpoint and tile matrix that deliver Web Mercator (`EPSG:3857`) tiles.

### Full-style basemaps and construction

A basemap `style` may be either a full MapLibre style URL or a complete style
JSON object:

```ts
import {
  Emap,
  type MapLibreBasemapService,
} from '@mapseekai/emap';

const basemaps: MapLibreBasemapService[] = [
  {
    id: 'provider-style',
    name: 'Provider style',
    role: 'basemap',
    style: 'https://tiles.example.com/styles/streets/style.json',
  },
  {
    id: 'osm-json',
    name: 'OpenStreetMap raster',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  },
];

const providerToken = 'YOUR_TOKEN';
const map = new Emap({
  container: 'map',
  mapLibre: {
    services: [...basemaps, ...overlays],
    defaultBasemap: 'provider-style',
    mapOptions: {
      transformRequest: (url, resourceType) => {
        if (!url.startsWith('https://tiles.example.com/')) return { url };
        const rewritten = url.replace(
          'https://tiles.example.com/',
          'https://cdn.example.com/',
        );
        const separator = rewritten.includes('?') ? '&' : '?';
        return {
          url: `${rewritten}${separator}access_token=${encodeURIComponent(providerToken)}`,
          headers:
            resourceType === 'Tile'
              ? { 'X-Map-Client': 'emap-documentation' }
              : {},
        };
      },
    },
  },
});
```

`transformRequest` is the native place for provider URL rewrites, query-token
injection, and request headers. Emap owns the MapLibre container, style,
center, zoom, and non-interactive mode, so those keys are intentionally not
available through `mapOptions`.

### Full-style overlays

A complete MapLibre Style v8 URL or JSON object can also be registered with
`role: 'overlay'`. A style overlay must define `style` and cannot also define
`sources` and `layers`; a resource overlay uses the latter two properties.

```ts
await map.mapLibreServices.addService({
  id: 'openfreemap-bright',
  name: 'OpenFreeMap Bright',
  role: 'overlay',
  visible: true,
  style: 'https://tiles.openfreemap.org/styles/bright',
});
```

The manager ignores `background` layers in the style and namespaces every
remaining source, layer, and sprite name by service ID; sprite image references
are rewritten as well. Showing or hiding the service shows or hides its entire
non-background style while preserving each layer's original visibility. Because
one MapLibre style can use only one global glyph URL, the active basemap and all
style overlays must have identical glyph URLs or no glyph URL; identical URLs
are shared, while different URLs are rejected deterministically.

The fixed canvas order, from bottom to top, is the active MapLibre basemap,
managed MapLibre overlay services, then the Emap business-data and editing
canvas above them.

Style URLs, relative source/sprite/glyph URLs, and request headers also pass
through `transformRequest`. Service-scoped asynchronous failures are reported
through the `error` event with the affected service in `serviceId`; a request
superseded by a later add, update, removal, or visibility operation is cancelled
with `AbortError` instead of being published as a final service error.

Activating a basemap or visible overlay requires Web Mercator. If necessary,
the manager reprojects the current Emap data to `webmercator` (`EPSG:3857`)
before displaying the service; account for that data-CRS change when enabling
online services.

### Runtime registry and state

Use the map-owned manager to add, replace, remove, show, or hide services. A
service keeps the same `id` and `role` when updated.

```ts
const services = map.mapLibreServices;
const live = rasterOverlay('live', 'Live overlay', {
  type: 'raster',
  tiles: ['https://tiles.example.com/live/{z}/{x}/{y}.png'],
  tileSize: 256,
});

await services.addService(live);
await services.updateService('live', {
  ...live,
  name: 'Live overlay (updated)',
});
await services.setOverlayVisibility('live', false); // hide
await services.setOverlayVisibility('live', true);  // show
await services.setBasemap('osm-json');
await services.setBasemap(null); // no active basemap

const state = services.getServiceState('live');
if (state?.status === 'error') console.error(state.error);

services.on('error', ({ serviceId, phase, fatal, error }) => {
  console.error({ serviceId, phase, fatal, error });
});

await services.removeService('live');
```

`getServiceState()` reports `idle`, `loading`, `ready`, or `error`, plus the
last error when applicable. Registry `change` and typed `error` events let
application UI follow asynchronous style/source/layer/tile work.

### Raw MapLibre access

`getMapLibreMap()` returns `null` until an active service has created the
underlying map:

```ts
const rawMap = map.mapLibreServices.getMapLibreMap();
rawMap?.addSource('unmanaged-debug-source', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});
```

Resources added through the raw map are unmanaged. A basemap style change can
remove them; register durable online content as a service instead.

### Control roles, canvas order, and CSS

`BasemapControl` is a single-choice selector for registered basemaps; only one
basemap can be active. `LayerControl` exposes visibility checkboxes for Emap
business layers and MapLibre overlays. Neither control provides opacity or
ordering UI.

The MapLibre canvas has a fixed position below every Emap layer. All managed
basemaps and online overlays render in that lower canvas, so MapLibre and Emap
layers cannot be interleaved into one cross-canvas order.

The minimal managed-canvas layout is included in Emap's stylesheet:

```ts
import '@mapseekai/emap/style.css';
```

If application code uses `getMapLibreMap()` to add MapLibre controls, popups,
or markers, import MapLibre's component CSS as well:

```ts
import '@mapseekai/emap/style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
```

## Navigation, history, and status

```ts
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-right');
map.addControl(
  new StatusControl({
    showMousePos: true,
    showEPSG: true,
    alignment: 'right',
  }),
  'bottom-right',
);
```

`StatusControl` defers updates through `requestAnimationFrame` instead of
rewriting the DOM on every pointermove.

## Scale and measurement

`ScaleControl` updates its scale from the current CRS and view extent, and hides itself when no truthful Earth-distance calculation is available. `map.getScaleMetrics()` exposes the same calculation for custom UI. Use two `MeasureControl` instances for length and area modes:

```ts
map.addControl(new ScaleControl({ units: 'metric', style: 'checker' }), 'bottom-left');
map.addControl(new MeasureControl({ mode: 'length' }), 'top-left');
map.addControl(new MeasureControl({ mode: 'area' }), 'top-left');
```

Measurements use spherical distance and area. Each click adds a vertex; finishing one measurement leaves the control ready to start the next.

## Mode controls

Selection and editing controls enable map handlers:

```ts
const boxControl = new BoxSelectControl();
const vertexControl = new VertexEditControl();

map.addControl(boxControl, 'top-left');
map.addControl(vertexControl, 'top-left');
```

Keep only the gesture mode needed by the current tool enabled. Do not duplicate
pointerdown/pointermove logic outside the control; that bypasses HandlerManager
gesture arbitration and cursor ownership.

## Custom controls

A custom control implements `Control`:

```ts
import type { Control, Emap } from '@mapseekai/emap';

class ResetViewControl implements Control {
  private button: HTMLButtonElement | null = null;
  private map: Emap | null = null;

  onAdd(map: Emap): HTMLElement {
    this.map = map;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'Reset';
    this.button.addEventListener('click', this.handleClick);
    return this.button;
  }

  onRemove(): void {
    this.button?.removeEventListener('click', this.handleClick);
    this.button?.remove();
    this.button = null;
    this.map = null;
  }

  private handleClick = (): void => {
    this.map?.reset();
  };
}

map.addControl(new ResetViewControl(), 'top-left');
```

The map inserts the element returned by `onAdd`. `onRemove` must release DOM
listeners and other external resources.

## Application toolbars

Business UI can call the same public APIs:

```ts
undoButton.addEventListener('click', () => map.undo());

boxButton.addEventListener('click', () => {
  map.lassoSelect.disable();
  map.boxSelect.enable();
});
```

Use `historychange`, `selectionchange`, and `editmodechange` to update button
state instead of assuming every click changed the map.

## Troubleshooting

- If a visible control cannot be clicked, check application `pointer-events`
  and overlays. `addControl` sets `pointer-events: auto`.
- A custom control must unregister its DOM and map listeners in `onRemove`.
- Derive active editing buttons from handler `isEnabled()` or
  `editmodechange`, and disable the old mode before enabling a new one.

## API

- [Control](/mapseekai/emap/api/interfaces/emap.Control.html)
- [ControlPosition](/mapseekai/emap/api/types/emap.ControlPosition.html)
- [NavigationControl](/mapseekai/emap/api/classes/emap.NavigationControl.html)
- [HistoryControl](/mapseekai/emap/api/classes/emap.HistoryControl.html)
- [StatusControl](/mapseekai/emap/api/classes/emap.StatusControl.html)
- [ScaleControl](/mapseekai/emap/api/classes/emap.ScaleControl.html)
- [ScaleControlOptions](/mapseekai/emap/api/interfaces/emap.ScaleControlOptions.html)
- [ScaleMetrics](/mapseekai/emap/api/interfaces/emap.ScaleMetrics.html)
- [ScaleViewMetrics](/mapseekai/emap/api/interfaces/emap.ScaleViewMetrics.html)
- [MeasureControl](/mapseekai/emap/api/classes/emap.MeasureControl.html)
- [MeasureControlOptions](/mapseekai/emap/api/interfaces/emap.MeasureControlOptions.html)
- [MeasureHandler](/mapseekai/emap/api/classes/emap.MeasureHandler.html)
- [MeasureOptions](/mapseekai/emap/api/interfaces/emap.MeasureOptions.html)
- [MeasureResult](/mapseekai/emap/api/interfaces/emap.MeasureResult.html)

## Runnable examples

- [Simplify control](/mapseekai/emap/examples/simplify-control/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
- [Spherical measurement](/mapseekai/emap/examples/measurement/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
