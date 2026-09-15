---
id: emap
slug: /concepts/emap
title: Emap map instance
api: ["Emap", "Feature", "FeatureAccessor", "FeatureQuery", "findInvalidFieldName", "HighlightManager", "isValidFieldName", "VisibleLayerLookup", "MapOptions", "TopologySource"]
examples: ["getting-started/geojson-viewer","interaction-handlers","undo-redo"]
stability: stable
verifiedVersion: 0.12.0
---

# Emap map instance

`Emap` is the application's map facade. One instance binds to one browser container and manages the Canvas, camera, registered sources, render layers, selection, edit history, interaction handlers, and map events. Applications change map state through this instance rather than operating on the Canvas or dataset directly.

## Create a map

```ts
import { Emap } from '@mapseekai/emap';

const map = await Emap.create({
  container: 'map',
  interactive: true,
});
```

`container` is an element ID or `HTMLElement`; the element must already exist and have a non-zero size. Data processing can route through a Worker with `useWorker: true` or `useWorker: 'auto'`; `workerUrl` sets the Worker script URL and `workerThreshold` is the vertex-count threshold for `'auto'`.

`expressionPolicy` accepts `'disabled'` or `'trusted'`. Use `'trusted'` only for expressions supplied by the application; user input and remote content should remain `'disabled'`.

## Add data and presentation

```ts
import { TopologySource } from '@mapseekai/emap';

const source = await TopologySource.fromUrl('main', '/data/districts.geojson');
await map.addSource('main', source);

map.addLayer({
  id: 'districts',
  type: 'fill',
  source: 'main',
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.7 },
});

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 });
```

`addSource` registers a source under a map source ID; `addLayer` uses that ID to reference data. When the source contains multiple source layers, add `source-layer` to the layer specification. Layers draw in insertion order, with later layers above earlier ones.

## Read and react to map state

```ts
map.on('moveend', (event) => {
  console.log(event.center, event.zoom);
});

map.on('feature:click', { layers: ['districts'] }, (event) => {
  console.log(event.ref);
});
```

`on` keeps listening, `once` receives one event, and `off` removes the same listener. `queryFeatures` queries features at Canvas-local pixels or within an extent; selection changes through `select()`, `deselect()`, and `clearSelection()`, and reads back with `getSelection()`.

## Edit and process data

Selection and highlighting change interaction state only. Edit features with edit commands, edit sessions, or built-in handlers; process datasets in bulk with `map.ops`. These entry points update rendering, spatial indexes, selection, and history.

```ts
const result = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.25,
});

if (!result.ok) console.error(result.error);
```

Use `jumpTo`, `easeTo`, `flyTo`, `fitBounds`, `panTo`, and `zoomTo` to change the camera. Use `project` and `unproject` to convert between map coordinates and Canvas pixels; neither method reprojects CRS coordinates.

## Lifecycle

When the application unmounts the map container, use `await map.dispose()`. `remove()` only requests native Cordis teardown; `dispose()` waits until interaction, Canvas, controls, and other Fiber/effect-owned resources have been released. Await it before reusing the same container.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
