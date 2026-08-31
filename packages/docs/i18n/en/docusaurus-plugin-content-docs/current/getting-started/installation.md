---
id: installation
slug: /getting-started/installation
title: Installation
api: []
examples: []
stability: stable
verifiedVersion: 0.8.1
---

# Installation and your first map

This page creates a minimal Vite and TypeScript application, loads remote
TopoJSON, and displays navigation and history controls.

## Requirements

- A browser with ES modules, Canvas 2D, and modern JavaScript support.
- npm, pnpm, or another package manager that supports package exports.

If you already have a frontend application, start at “Install Emap.”

## Create an application

```bash
pnpm create vite emap-demo --template vanilla-ts
cd emap-demo
pnpm install
```

The npm equivalent is:

```bash
npm create vite@latest emap-demo -- --template vanilla-ts
cd emap-demo
npm install
```

## Install Emap

```bash
pnpm add @mapseekai/emap
```

Or:

```bash
npm install @mapseekai/emap
```

## TypeScript resolution for optional modules

`@mapseekai/emap/arrow` and `@mapseekai/emap/duckdb` are `package.json`
export subpaths. For Vite and other browser bundlers, ensure the application
TypeScript config—usually `tsconfig.app.json` in current Vite templates—contains:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Native Node ESM must instead use matching `Node16` or `NodeNext` settings for
both `module` and `moduleResolution`. Legacy `node` or `node10` resolution
cannot resolve these subpaths, even when their declaration files exist.


## Prepare the map container

Replace the body of `index.html` with:

```html
<body>
  <div id="map"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

The map container must have a non-zero width and height. Replace
`src/style.css` with:

```css
html,
body,
#map {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  overflow: hidden;
}
```

A map inside a panel or dialog does not have to fill the page, but its parent
layout must still give `#map` a computed size. A zero-sized container is the
most common reason for a blank map without an exception.

## Create the map and load data

Replace `src/main.ts` with:

```ts
import {
  Emap,
  HistoryControl,
  NavigationControl,
  TopologySource,
} from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
import './style.css';

const map = new Emap({
  container: 'map',
});

map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');

async function loadMap(): Promise<void> {
  try {
    const source = await TopologySource.fromUrl(
      'china',
      'https://geojson.cn/api/china/1.6.3/china.topo.json',
    );

    await map.addSource('china', source);
    map.setExtent(source.getExtent());
  } catch (error) {
    console.error('Failed to load map data', error);
  }
}

void loadMap();
```

Start the development server:

```bash
pnpm dev
```

Open the URL printed by Vite. A successful page shows the map and allows
navigation through the control.

## Execution order

1. `new Emap({ container: 'map' })` creates the canvas and interaction manager.
2. `TopologySource.fromUrl(...)` downloads, imports, and builds the topology
   dataset.
3. `map.addSource(...)` registers source layers for rendering and queries.
4. `source.getExtent()` returns the data bounds.
5. `map.setExtent(...)` moves the initial view to those bounds.

Do not assume layers or bounds exist before `TopologySource.fromUrl(...)`
resolves. Preserve the original error for diagnostics and provide a retry path
in application UI.

## Load application data

### Load from a URL

Any URL that the browser is allowed to fetch can be used:

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson');
await map.addSource('roads', source);
map.setExtent(source.getExtent());
```

Cross-origin URLs must return CORS headers that allow the application origin.

### Load from binary content

A file upload or an existing `ArrayBuffer` can be passed to `setData`:

```ts
const response = await fetch('/data/districts.geojson');
if (!response.ok) {
  throw new Error(`Data request failed: ${response.status}`);
}

const source = new TopologySource('districts');
const content = new Uint8Array(await response.arrayBuffer());

await source.setData({
  filename: 'districts.geojson',
  content,
});

await map.addSource('districts', source);
map.setExtent(source.getExtent());
```

`filename` matters because the importer uses the extension to distinguish
GeoJSON, TopoJSON, KML, ZIP, and GeoParquet inputs. `.fgb` works only after
the application has registered its local FlatGeobuf plugin; see [Data formats](../data/formats.md)
and the [FlatGeobuf viewer](/mapseekai/emap/examples/flatgeobuf-viewer/).
`setData(...)` resolves after the dataset has been populated and the `data`
event has fired.

## Add explicit style layers

After registering a source, add application-specific render layers:

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: {
    'fill-color': '#5b8ff9',
    'fill-opacity': 0.65,
  },
});

map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: {
    'line-color': '#1d39c4',
    'line-width': 1.5,
  },
});
```

One source can feed multiple render layers. Later layers are drawn above
earlier layers.

## Optional worker setup

Enable a worker only when heavier processing should leave the main thread:

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerUrl: '/assets/emap-worker.js',
});
```

Copy `node_modules/@mapseekai/emap/dist/emap-worker.js` and
`mapshaper-vendor.js` into the public asset directory. Keep them together by
default because the worker loads the vendor file through a relative URL.

## Common startup problems

### The page is blank

Check these in order:

1. `#map` and its parents have a computed size.
2. The browser console has no request or CORS error.
3. The ID passed to `map.addSource(...)` matches the layer `source`.
4. The application calls `setExtent` or `fitBounds` after loading.
5. An explicit layer `type` is compatible with the source geometry.

### Controls are unstyled

Confirm the application entry imports:

```ts
import '@mapseekai/emap/style.css';
```

### The worker returns 404

Open `workerUrl` directly in the browser to verify it is public, then confirm
that `mapshaper-vendor.js` is available beside it.

## Next steps

- Read [Sources and layers](../concepts/source-layer.md) to distinguish a
  source layer from a render layer.
- Read [Styling](../guides/styling.md) to configure point, line, and polygon
  paint.
- Read [Events](../guides/events.md) to connect the map to application UI.
- Open the [runnable examples](/mapseekai/emap/examples/) for complete interaction and
  data-processing scenarios.
