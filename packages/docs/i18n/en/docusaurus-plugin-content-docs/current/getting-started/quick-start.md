---
id: quick-start
slug: /getting-started/quick-start
title: Your first map
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# Your first map

After [installation](./installation.md), get an interactive map on screen with one GeoJSON source and two render layers.

## Set up the container

The map container must already exist on the page with a non-zero size. Emap does not choose a height for you:

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

## Create the map and load data

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({
  container: 'map',
  expressionPolicy: 'disabled',
});

const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');
await map.addSource('districts', source);
```

`Emap.create` is asynchronous: it starts the Cordis runtime and waits for the default preset's plugins. `expressionPolicy: 'disabled'` is the default and is shown here as a reminder — switch to `'trusted'` only when configuration and data are fully controlled by the application.

## Add layers and position the camera

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.45,
  },
});

map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1.5,
  },
});

map.setExtent(source.getExtent());
```

`source` references the source ID registered by `addSource`. When the dataset holds several layers, pick one with `'source-layer'`. Layers draw in insertion order; later layers sit on top.

## Load a local file

A user-picked file loads through `fromBytes`, which detects the format from the filename:

```ts
const file = input.files?.[0];
if (!file) throw new Error('Choose a file first');

const source = await TopologySource.fromBytes('upload', await file.arrayBuffer(), {
  filename: file.name,
});
await map.addSource('upload', source);
```

Tighten `zipLimits` for public uploads; the available limits are documented in [Sources and layers](../concepts/source-layer.md).

## Dispose

Wait for `dispose()` before reusing the container:

```ts
await map.dispose();
```

## Next steps

- [Concepts overview](../concepts/overview.md): sources, source layers, and render layers.
- [Styling](../guides/styling.md): paint properties and attribute-driven styles.
- [Editing](../guides/editing.md): enabling edit handlers and undo/redo.
- [GeoJSON viewer example](/mapseekai/emap/examples/getting-started/geojson-viewer/): a complete runnable version of this page.
