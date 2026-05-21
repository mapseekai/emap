# emap

`emap` is a browser-only TypeScript map rendering and editing engine built on
Mapshaper topology data structures and HTML5 Canvas 2D. It is designed for
framework-agnostic GIS applications that need client-side loading, rendering,
selection, topology-aware editing, data operations, undo/redo, and custom UI
integration without a backend service.

## Project Status

`emap` is an AI-driven development project and is still evolving quickly. The
API, behavior, and implementation details may change without the compatibility
guarantees expected from a mature GIS engine. It is not recommended for
production environments yet; evaluate it in prototypes, demos, research tools,
or controlled internal workflows first.

## Highlights

- Topology-first rendering for Mapshaper datasets, with shared-arc reuse and LOD.
- GeoJSON, TopoJSON, ZIP Shapefile, and Mapshaper snapshot loading.
- MapLibre-style layer specs: `fill`, `line`, and `circle`.
- Named interaction handlers: `dragPan`, `scrollZoom`, `clickSelect`,
  `boxSelect`, `lassoSelect`, `vertexEdit`, `drawFeature`, and
  `transformFeature`.
- Handler-driven customization: use built-in interactions without the bundled UI
  controls, or build your own toolbar around the same handlers.
- Delegated feature events: `feature:click`, `feature:hover`, `feature:enter`,
  and `feature:leave`.
- MapLibre-parity camera methods: `jumpTo`, `easeTo`, `flyTo`, `fitBounds`,
  `panBy`, `panTo`, `zoomTo`, and `stop`.
- 30+ `map.ops.*` data operations backed by Mapshaper commands.
- Undo/redo, transactions, validators, feature accessors, highlighting, and
  full-session snapshots.
- Optional Web Worker offloading for expensive dataset-replace operations.
- CSS design tokens for theming built-in UI surfaces.

For the full capability matrix, see [FEATURES.md](FEATURES.md).

## Install

```bash
npm install @zwishing/emap
# or
pnpm add @zwishing/emap
```

## Quick Start

### Bundlers

```ts
import {
  Emap,
  TopologySource,
  NavigationControl,
  HistoryControl,
} from '@zwishing/emap';
import '@zwishing/emap/style.css';

const map = new Emap({ container: 'map' });
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');

const source = await TopologySource.fromUrl(
  'china',
  'https://geojson.cn/api/china/1.6.3/china.topo.json',
);

map.addSource('china', source);
map.setExtent(source.getExtent());
```

The ESM build is browser-ready. Mapshaper is shipped as a sibling ES module
resolved from `node_modules/@zwishing/emap/dist/`, so Vite, webpack, esbuild,
and Bun consumers should not need a `Buffer` polyfill or a custom alias.

### Static Assets

Some runtime files are loaded by URL instead of being inlined into your
application bundle:

| Asset | When it is needed |
|---|---|
| `dist/emap.css` | Built-in controls, context menus, and default UI styling |
| `dist/mapshaper-vendor.js` | IIFE script usage and worker bootstrapping |
| `dist/emap-worker.js` | `useWorker: true` or `useWorker: 'auto'` |

For bundlers, prefer:

```ts
import '@zwishing/emap/style.css';
```

For script-tag or static-host deployments, copy the files from
`node_modules/@zwishing/emap/dist/` into your public assets directory. When
using the worker, keep `emap-worker.js` and `mapshaper-vendor.js` in the same
directory unless you build your own worker bundle; the worker imports the vendor
file with a relative `importScripts('mapshaper-vendor.js')` call.

### IIFE Script

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="node_modules/@zwishing/emap/dist/emap.css" />
    <style>
      html, body, #map { width: 100%; height: 100%; margin: 0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="node_modules/@zwishing/emap/dist/mapshaper-vendor.js"></script>
    <script src="node_modules/@zwishing/emap/dist/emap.js"></script>
    <script>
      const { Emap, TopologySource, NavigationControl } = emap;
      const map = new Emap({ container: 'map' });
      map.addControl(new NavigationControl(), 'top-left');

      (async () => {
        const source = await TopologySource.fromUrl(
          'china',
          'https://geojson.cn/api/china/1.6.3/china.topo.json',
        );
        map.addSource('china', source);
        map.setExtent(source.getExtent());
      })();
    </script>
  </body>
</html>
```

## Loading Data

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson');
map.addSource('roads', source);
map.setExtent(source.getExtent());

const local = new TopologySource('local');
await local.setData({ filename: 'upload.zip', content: bytes });
map.addSource('local', local);
```

`TopologySource.setData()` is awaitable. It resolves after the dataset is
populated and the `data` event has fired. `map.addSource()` is order-independent:
you can add a loaded source or add the source first and load it later.

Supported inputs:

- GeoJSON and TopoJSON.
- ZIP Shapefile archives containing `.shp`, `.dbf`, `.shx`, and optional `.prj`.
- Mapshaper `.msx` snapshots via `map.loadSnapshot()`.

## Layers and Rendering

```ts
map.addLayer({
  id: 'roads-line',
  source: 'roads',
  type: 'line',
  paint: {
    'line-color': '#4a5568',
    'line-width': 1,
  },
});

map.addLayer({
  id: 'district-fill',
  source: 'districts',
  type: 'fill',
  paint: {
    'fill-color': 'rgba(66, 153, 225, 0.25)',
    'line-width': 0,
  },
});
```

When no user layers are added, `emap` creates default display layers from the
source geometry type. Polygon defaults are outline-only for large-data browsing;
add an explicit `fill` layer when you want area fills.

## Interactions Without Built-In Controls

Most editing and selection tools are exposed as named handlers. You can use
them directly from your own UI instead of adding `BoxSelectControl`,
`DrawFeatureControl`, `VertexEditControl`, or `EditToolbar`.

```ts
map.boxSelect.setOptions({
  layers: ['district-fill'],
  dragActivator: 'shift',
  dragThreshold: 4,
});
map.boxSelect.enable();

map.lassoSelect.setOptions({ layers: ['district-fill'] });
map.lassoSelect.enable();

map.drawFeature.setOptions({
  source: 'editing',
  sourceLayer: 'areas',
  type: 'polygon',
  snapSources: ['editing', 'reference'],
});
map.drawFeature.enable();

map.vertexEdit.enable();

map.clickSelect.enable();
map.transformFeature.setOptions({ mode: 'translate' });
map.transformFeature.enable();
```

All handlers expose the same basic surface:

```ts
handler.enable();
handler.disable();
handler.isEnabled();
handler.setOptions({...});
handler.getOptions();
```

Available named handlers:

| Handler | Purpose |
|---|---|
| `map.dragPan` | Pointer drag map panning |
| `map.scrollZoom` | Wheel zoom |
| `map.clickSelect` | Click selection |
| `map.boxSelect` | Shift-drag rectangular selection |
| `map.lassoSelect` | Free-form lasso selection |
| `map.vertexEdit` | Topology-aware vertex editing |
| `map.drawFeature` | Point, polyline, and polygon drawing |
| `map.transformFeature` | Translate, rotate, or scale selected features |

## Building Your Own UI

Built-in controls are optional. A custom toolbar can call the public map API and
handlers directly:

```ts
toolbar.querySelector('[data-tool="box"]').onclick = () => {
  map.lassoSelect.disable();
  map.boxSelect.enable();
};

toolbar.querySelector('[data-tool="undo"]').onclick = () => map.undo();
toolbar.querySelector('[data-tool="redo"]').onclick = () => map.redo();

map.on('historychange', (e) => {
  undoButton.disabled = !e.canUndo;
  redoButton.disabled = !e.canRedo;
});
```

For a custom control that still plugs into the corner layout, implement:

```ts
const control = {
  onAdd(map) {
    const el = document.createElement('div');
    el.textContent = 'My tool';
    return el;
  },
  onRemove() {},
};

map.addControl(control, 'top-right');
```

### Custom Box Selection

If you want your own rectangular selection UI instead of `BoxSelectControl`, use
the built-in handler as the gesture engine and keep your buttons outside
`emap`:

```ts
const boxButton = document.querySelector<HTMLButtonElement>('[data-tool="box"]')!;
const clearButton = document.querySelector<HTMLButtonElement>('[data-tool="clear"]')!;

map.boxSelect.setOptions({
  layers: ['district-fill'],
  dragActivator: 'shift',
  dragThreshold: 4,
  mode: 'replace',
});

function activateBoxSelect() {
  map.lassoSelect.disable();
  map.vertexEdit.disable();
  map.drawFeature.disable();
  map.transformFeature.disable();
  map.boxSelect.enable();
  boxButton.dataset.active = 'true';
}

function deactivateBoxSelect() {
  map.boxSelect.disable();
  delete boxButton.dataset.active;
}

boxButton.onclick = () => {
  if (map.boxSelect.isEnabled()) deactivateBoxSelect();
  else activateBoxSelect();
};

clearButton.onclick = () => map.clearSelection();

map.on('selectionchange', (e) => {
  selectionCount.textContent = String(e.selected.length);
});
```

The handler owns pointer capture, hit testing, selection mode resolution, and
its overlay drawing. Your application owns toolbar state, mode switching, and
whether selection is allowed for the current workflow.

## Feature Events and Highlighting

```ts
map.on('feature:click', { layers: ['district-fill'] }, (e) => {
  console.log(e.ref, e.feature.properties);
  map.select([e.ref]);
});

map.on('feature:enter', { layers: ['district-fill'] }, (e) => {
  map.setHighlightedFeatures([e.ref], { color: '#1677ff', width: 2, fill: true });
});

map.on('feature:leave', () => {
  map.clearHighlightedFeatures();
});

map.on('mousemove', (e) => {
  status.textContent = `${e.mapCoord[0].toFixed(4)}, ${e.mapCoord[1].toFixed(4)}`;
});
```

Feature and pointer events are delegated through the same pointer arbiter as the
handlers. The pointer sink is installed lazily, so there is no hit-test overhead
when no listener is registered.

## Data Operations

All operations return `Promise<OpResult<T>>`:

```ts
const result = await map.ops.bufferLayer({
  source: 'roads',
  target: 'roads',
  radius: 50,
});

if (!result.ok) {
  console.error(result.error.kind, result.error.message);
}
```

Common operation groups:

- Geometry operations: `clipLayer`, `eraseLayer`, `dissolveLayer`,
  `bufferLayer`, `simplifyLayer`, `projectLayer`, `cleanLayer`, `snapLayer`.
- Conversion operations: `pointsLayer`, `linesLayer`, `polygonsLayer`,
  `innerlinesLayer`, `explodeLayer`.
- Layer operations: `renameLayer`, `mergeLayers`, `splitLayer`, `dropLayer`.
- Attribute operations: `applyExpression`, `filterFeatures`, `joinTable`,
  `sortFeatures`, `uniqueFeatures`, `filterFields`, `renameFields`,
  `dataFill`.
- Inspection and repair: `checkGeometry`, `rebuildTopology`,
  `intersectionPointsLayer`.
- Selection-driven operation: `mergeSelected`.

Expression-bearing APIs are disabled by default for safety:

```ts
const map = new Emap({ container: 'map', expressionPolicy: 'trusted' });
```

Use `'trusted'` only for application-owned expressions and trusted data.

## Transactions, Undo, and Validation

```ts
const tx = map.beginTransaction();

const clipped = await map.ops.clipLayer({ source: 's', target: 'parcels', mask: 'clip' });
if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('Clip parcels');
}

map.undo();
map.redo();

map.on('selectionchange', (e) => {
  console.log(e.selected, e.added, e.removed);
});
```

Register validators for post-commit checks:

```ts
import { topologyValidator } from '@zwishing/emap';

const unregister = map.validators.register(topologyValidator({
  sources: ['editing'],
}));

map.on('validationfailed', (e) => {
  console.warn(e.results);
});
```

The engine reports validation failures; it does not auto-undo. The application
decides whether to warn, block save, or call `map.undo()`.

## Camera

```ts
map.jumpTo({ center: [120, 30], zoom: 6 });
map.easeTo({ center: [120, 30], zoom: 8, duration: 600 });
map.flyTo({ center: [120, 30], zoom: 10, duration: 1500 });
map.fitBounds(source.getExtent(), { padding: 40, duration: 600 });
map.panBy([120, 0]);
map.stop();
```

Camera methods are chainable and fire `movestart`, `move`, `moveend`,
`zoomstart`, `zoom`, and `zoomend` events.

## Worker Offloading

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 200_000,
  workerUrl: '/vendor/emap/emap-worker.js',
  workerPoolSize: 2,
});
```

When workers are enabled, serve these files from the same directory:

```text
node_modules/@zwishing/emap/dist/emap-worker.js
node_modules/@zwishing/emap/dist/mapshaper-vendor.js
```

`workerRouting` can override the built-in cheap/expensive operation routing.

Workers only cover dataset-replace style operations such as clip, dissolve,
union, simplify, project, and similar `map.ops.*` commands. Pointer
interactions, selection transforms, vertex edits, and drawing sessions stay on
the main thread because their per-frame state is UI-bound and usually cheaper
than worker round trips.

## Theming

Import the default CSS once:

```ts
import '@zwishing/emap/style.css';
```

Override CSS tokens at `:root` or an app-specific container:

```css
:root {
  --emap-accent: #1677ff;
  --emap-accent-soft: rgba(22, 119, 255, 0.12);
  --emap-surface-bg: #fff;
  --emap-surface-border: #d9d9d9;
  --emap-surface-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  --emap-radius: 4px;
  --emap-hover-bg: #f5f5f5;
  --emap-danger: #d32f2f;
  --emap-font: 13px/1.5 system-ui, sans-serif;
}
```

## Built-In Controls

| Control | Purpose |
|---|---|
| `NavigationControl` | Zoom in, zoom out, reset |
| `StatusControl` | Pointer coordinates and CRS |
| `BasemapControl` | MapLibre raster basemap toggle |
| `HistoryControl` | Undo/redo buttons |
| `EditToolbar` | Combined edit toolbar |
| `VertexEditControl` | Button shell over `map.vertexEdit` |
| `DrawFeatureControl` | Button shell over `map.drawFeature` |
| `BoxSelectControl` | Thin shell over `map.boxSelect` |
| `LassoSelectControl` | Thin shell over `map.lassoSelect` |
| `SimplifyControl` | Simplification UI |

## Known Limitations

- The project is AI-driven and still moving quickly; avoid depending on
  undocumented internals in production applications.
- `fill` rendering is heavier than `line` rendering for large polygon datasets
  because area fills require full polygon path materialization and fill rules.
  For large-data browsing, keep polygon layers outline-first and enable fills
  only at suitable scales or for filtered subsets.
- Rendering is Canvas 2D only. There is no WebGL renderer, symbol placement
  engine, tiled vector source, or server-side tile pipeline.
- CRS support follows the bundled Mapshaper/projection path and common browser
  data workflows. Validate project-specific CRS definitions before building
  user-facing editing workflows around them.
- Expression-bearing operations are disabled by default. Set
  `expressionPolicy: 'trusted'` only for first-party expressions and trusted
  data.
- Worker offloading requires the host app to deploy worker/vendor assets
  correctly and does not make every interaction asynchronous.

## Development

```bash
pnpm install
cmd /c npm run typecheck
cmd /c npm run test:run
cmd /c npm run build
```

Build outputs:

- `dist/emap.js` - IIFE bundle.
- `dist/emap.mjs` - ES module.
- `dist/emap-worker.js` - worker bundle.
- `dist/mapshaper-vendor.js` and `dist/mapshaper-vendor.mjs` - Mapshaper vendor bundles.
- `dist/emap.css` - control styles.
- `dist/index.d.ts` - TypeScript declarations.

Manual examples live in `test/examples/*.html`.

## Release Checklist

Before publishing a version:

```bash
cmd /c npm ci
cmd /c npm run typecheck
cmd /c npm run test:run
cmd /c npm run build
cmd /c npm pack --dry-run
```

Then check:

- `package.json` version matches the release section in `CHANGELOG.md`.
- `README.md`, `FEATURES.md`, `SECURITY.md`, and `CHANGELOG.md` describe the
  same public API.
- The dry-run package contains only current `dist` files, docs, license, and
  package metadata.
- A fresh consumer project can import `@zwishing/emap`, import
  `@zwishing/emap/style.css`, and resolve `dist/emap-worker.js` if worker
  mode is documented for the release.

## License

[MPL-2.0](LICENSE)
