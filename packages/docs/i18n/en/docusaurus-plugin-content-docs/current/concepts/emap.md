---
id: emap
slug: /concepts/emap
title: Emap map instance
api: ["Emap", "Feature", "FeatureAccessor", "FeatureQuery", "findInvalidFieldName", "HighlightManager", "isValidFieldName", "VisibleLayerLookup", "MapOptions", "TopologySource"]
examples: ["getting-started/geojson-viewer","interaction-handlers","undo-redo"]
stability: stable
verifiedVersion: 0.14.0
---

# Emap map instance

`Emap` is the application's map facade, managing the Canvas, camera, sources, render layers, selection, edit history, handlers, and map events.

Use one instance to combine data loading, layer styling, feature queries, camera animation, and undoable operations.

```ts
import { Emap, TopologySource } from '@mapseekai/emap';

const map = await Emap.create({ container: 'map', interactive: true }); // create the map instance
const source = await TopologySource.fromUrl('main', '/data/districts.geojson'); // import data from a URL
await map.addSource('main', source); // register it under a source ID

map.addLayer({
  // declare a render layer for the data
  id: 'districts', // unique render layer ID
  type: 'fill', // polygon renderer
  source: 'main', // reference the registered source ID
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.7 }, // set the fill style
});

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 }); // fit the data extent
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `Emap.create(options)` | `EmapOptions` | Create a map instance; options cover `MapOptions`, preset, and plugin settings. |
| `addSource(id, source, answers?)` | `string`, `TopologySource` | Register a source asynchronously, normalizing to the project CRS when needed; `answers.sourceCrs` sets an explicit CRS for data without metadata. |
| `addLayer(layer, before?)` | `LayerSpecification`, `string` | Register a render layer synchronously; later layers draw above, and `before` names the style-layer ID to insert before. |

### `MapOptions` core parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | Required for browser presets | Canvas container; strings are element IDs; `headless` may omit it. |
| `interactive` | `boolean` | `true` | Enables browser interactions such as drag and wheel zoom. |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | Capability set: editing, browsing/selection, DOM-free processing, or custom plugins. |

### `LayerSpecification`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Unique style-layer ID. |
| `type` | `'fill' \| 'line' \| 'circle'` | Required | Polygon, line, or point renderer. |
| `source` | `string` | Required | `addSource()` source ID. |
| `source-layer` | `string` | First data layer | Source data-layer ID or name. |
| `paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | Type rendering defaults | Style properties for `type`. |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | Rendering and picking switch. |
| `filter` | `StyleExpression` | Unset | Per-feature boolean MapLibre-subset expression. |
| `styleSource` | `'mapshaper'` | Unset | Uses mapshaper-compatible baked color fields. |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` (`circle`) | Point density thinning; `cellSize` is CSS pixels. |

For scale conditions, listen for camera events and update with `setLayerVisibility()`.

`paint` properties:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `fill-color` | `string \| StyleExpression` | Theme muted color | Polygon fill color or per-feature expression. |
| `fill-opacity` | `number` | Preserves color alpha | Polygon fill opacity. |
| `line-color` | `string \| StyleExpression` | Theme primary color | Line or polygon-outline color. |
| `line-width` | `number` | `0.8` | Line or polygon-outline width. |
| `line-dasharray` | `readonly number[]` | Solid | CSS-pixel dash and gap lengths. |
| `line-dashstyle` | `LineDashStyle \| StyleExpression` | Derived from `line-dasharray` or `'solid'` | Named line style; `'arrow-dot'` uses arrows. |
| `line-arrow-spacing` | `number` | `32` | `'arrow-dot'` spacing in CSS pixels. |
| `line-arrow-size` | `number` | `6` | `'arrow-dot'` wing length in CSS pixels. |
| `circle-color` | `string \| StyleExpression` | Theme primary color | Point-marker color or expression. |
| `circle-radius` | `number` | `4` | Point-marker radius in CSS pixels. |
| `circle-fill` | `boolean` | `true` | Point-marker fill mode. |
| `circle-shape` | `PointMarkerShape \| StyleExpression` | `'circle'` | Point-marker shape or expression. |

## More creation options

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `plugins` | `readonly Plugin[]` | `[]` | Adds Cordis plugins; matching names replace preset plugins. |
| `excludePlugins` | `readonly string[]` | `[]` | Excludes preset plugins by name. |
| `authorizeCapability` | `CapabilityAuthorizer` | Host default policy | Host authorization policy for capability calls. |
| `expressionPolicy` | `'disabled' \| 'trusted'` | `'disabled'` | mapshaper JavaScript expression policy. |
| `useWorker` | `boolean \| 'auto'` | `false` | dataset-replace execution location. |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL, relative to `document.baseURI`. |
| `workerThreshold` | `number` | `50000` | `'auto'` arc-vertex threshold. |
| `workerPoolSize` | `number` | `1` | Lazily created Worker count. |
| `workerPool` | `MapshaperWorkerPool` | Unset | Dedicated pool; takes priority over URL and size; destroyed on release. |
| `workerRouting` | `WorkerRoutingFn` | Engine decision | Per-call `'auto'` Worker-routing override. |
| `mapLibre` | `MapLibreIntegrationOptions` | Unset | Native basemap and overlay configuration. |

`mapLibre` subparameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `services` | `readonly MapLibreService[]` | `[]` | Registered basemap or overlay services. |
| `defaultBasemap` | `string` | Unset | Startup basemap service ID. |
| `mapOptions` | `Omit<maplibregl.MapOptions, 'container' \| 'style' \| 'center' \| 'zoom' \| 'interactive'>` | MapLibre defaults | Remaining native MapLibre options. |

## CRS

The map starts with `EPSG:4326`; the first confirmed source establishes its CRS.

| Method | Parameters | Description |
| --- | --- | --- |
| `setCRS(crs)` | `string` | Set the project CRS before source registration. |
| `getCRS()` | None | Current project CRS. |
| `reproject(targetCrs)` | `string` | Project sources and the view to the target CRS. |

## Events and queries

```ts
map.on('moveend', (event) => {
  console.log(event.center, event.zoom);
});

map.on('feature:click', { layers: ['districts'] }, (event) => {
  console.log(event.ref);
});
```

| Method | Parameters | Description |
| --- | --- | --- |
| `on(type, listener)` | `string`, `EventListener` | Continuous map-event subscription; returns the map. |
| `on(type, filter, listener)` | `filter.source`, `filter.layers` | Filter `feature:*` events by source and data layer. |
| `once(...)` | Same as `on(...)` | One-time listener. |
| `off(type, listener)` | The `type` and function used at registration | Remove a listener. |

Camera event payloads include `center`, `zoom`, and `originalEvent`. `feature:*` events provide `feature`, `ref`, the Canvas `point`, `lngLat`, modifiers, and the DOM event.

`queryFeatures(geometryOrOptions)` queries visible features: the argument is a pixel point `[number, number]`, a two-corner extent `[[number, number], [number, number]]`, or `QueryFeaturesOptions` (the entire Canvas by default); `options.layers` limits source data-layer IDs, names, or layer IDs. Results contain `id`, `source`, `layer`, `geometryType`, and `properties`, ordered topmost first. Use `select()`, `deselect()`, and `clearSelection()` to modify the selection and `getSelection()` to read it.

## Camera

Every camera method returns the map. `center` uses project coordinates; `scale` is a CRS-independent pixel ratio, while `zoom` is Web Mercator semantics.

| Method | Parameters | Description |
| --- | --- | --- |
| `jumpTo(options)` | `CameraOptions` | Apply center and scale immediately with lifecycle events. |
| `easeTo(options)` | `CameraOptions & AnimationOptions` | Linear center and logarithmic scale interpolation. |
| `flyTo(options)` | `FlyToOptions` | van Wijk flight path. |
| `fitBounds(bounds, options?)` | `Bounds`, `FitBoundsOptions` | Fit a data extent to the viewport. |
| `panTo(center, options?)` | `[number, number]`, `AnimationOptions` | Keep the scale and move the center. |
| `zoomTo(zoom, options?)` | `number`, `AnimationOptions` | Keep the center and set scale from zoom. |
| `stop()` | None | Stop the camera animation and complete terminal events. |

`CameraOptions`, animation, and fit parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `center` | `[number, number]` | Current center | Target project coordinate. |
| `zoom` | `number` | Current scale | Target Web Mercator zoom. |
| `scale` | `number` | Current scale | Positive target pixel ratio; overrides `zoom`. |
| `duration` | `number` | `1000` | Animation duration in milliseconds. |
| `easing` | `(t: number) => number` | `Tween.sineInOut` | Easing function over `[0, 1]`. |
| `animate` | `boolean` | `true` | Animation switch; `false` positions immediately. |
| `curve` | `number` | `1.42` | `flyTo` van Wijk curvature. |
| `speed` | `number` | Unset | `flyTo` velocity in screenfuls per second. |
| `padding` | `number` | `0` | Per-side `fitBounds` pixel inset. |
| `maxScale` | `number` | Unset | Maximum `fitBounds` scale. |

`project(x, y)` converts project coordinates to Canvas pixels `[px, py]`, and `unproject(px, py)` converts back; both apply the current view transform, while `reproject()` handles CRS conversion.

## Editing and data processing

Selection and highlighting manage interaction state while preserving data. Edit with commands, sessions, or handlers; process in bulk with `map.ops`.

```ts
const result = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.25,
});

if (!result.ok) console.error(result.error);
```

## Lifecycle

`remove()` starts native Cordis teardown; `dispose()` tears down and waits for resource release.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
