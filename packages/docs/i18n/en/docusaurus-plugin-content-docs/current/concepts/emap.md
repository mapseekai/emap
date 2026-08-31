---
id: emap
slug: /concepts/emap
title: Emap map instance
api: ["Emap","Feature","FeatureAccessor","FeatureQuery","findInvalidFieldName","HighlightManager","isValidFieldName","isValidLayerName","quoteCliArg","VisibleLayerLookup"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.8.1
---

# Emap map instance

`Emap` coordinates one map container. It owns the canvas, camera, registered
sources, render-layer order, controls, interaction handlers, selection,
history, and worker routing. Applications normally create one instance and
interact with it through public methods and events.

## Construct a map

```ts
import { Emap } from '@mapseekai/emap';

const map = new Emap({
  container: 'map',
});
```

`container` may be a container ID. The element must already exist and have a
non-zero size.

Common options:

| Option | Default | Purpose |
|---|---|---|
| `interactive` | `true` | Enables default browser interaction |
| `useWorker` | `false` | `true` forces routing; `'auto'` chooses by workload |
| `workerThreshold` | `50000` | Data-size threshold considered by `'auto'` |
| `workerUrl` | `emap-worker.js` | Public URL of the worker script |
| `expressionPolicy` | `'disabled'` | Controls mapshaper expression execution |

Only use `expressionPolicy: 'trusted'` for expressions provided by trusted
application code. Do not execute user or remote input as a trusted expression.

## Register a source

```ts
const source = await TopologySource.fromUrl('main', '/data/districts.geojson');

await map.addSource('main', source);
map.setExtent(source.getExtent());
```

A `TopologySource` must have initial data before `map.addSource`: complete its
initial `setData(...)` or load first. Alternatively, use `preflightSource` /
`confirmSource` to validate and initialize the source before registration. A
registered, populated source still supports later `setData(...)` calls; the map
normalizes the new data to the map CRS.

The map-level source ID must match the `source` used by render layers and
`map.ops`.

## Add render layers

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.7,
  },
});

map.addLayer({
  id: 'district-line',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1,
  },
});
```

A render-layer ID must be unique and stable. Selection filters, feature events,
and application state commonly retain that ID.

## Controls and interaction handlers

Controls provide DOM UI; handlers implement the interaction. When using a
built-in control, give its lifecycle to the map through `addControl`:

```ts
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-right');
```

An application with its own toolbar can enable or disable map handlers directly
instead of duplicating pointer interaction logic.

## Listen for map state

`Emap` provides event dispatch. Known event names infer their payload:

```ts
map.on('moveend', (event) => {
  console.log(event.center, event.zoom);
});

map.on(
  'feature:click',
  { layers: ['district-fill'] },
  (event) => {
    console.log(event.ref);
  },
);

map.on('historychange', (event) => {
  console.log(event);
});
```

Use `on` for a persistent listener, `once` for one delivery, and `off` with the
same listener when it is no longer needed.

## Modify data

Choose an entry point according to the scope of the change:

- Selection and highlighting only change interaction state.
- Feature transforms, vertex edits, and attribute edits use edit commands.
- Buffer, dissolve, projection, and simplify use `map.ops`.
- Use a transaction when several commands must become one undo step.

```ts
const result = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.25,
});

if (!result.ok) {
  console.error(result.error);
}
```

Do not bypass these entry points by mutating `source.getDataset()`. The map uses
command effect classification to update selection, spatial indexes, history,
and render caches.

## Camera and screen coordinates

Use `jumpTo`, `easeTo`, `flyTo`, `fitBounds`, `panTo`, and `zoomTo` to change
the view. Use `project` and `unproject` to convert between map coordinates and
canvas pixels. Do not mutate the viewport or maintain a second matrix in
application code.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)
