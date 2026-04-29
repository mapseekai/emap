# emap

A modern, topology-oriented geographic map rendering and editing engine built around [Mapshaper](https://github.com/mbloch/mapshaper) data structures and HTML5 Canvas.

## Features

- **Topology-based Rendering** — draws and edits geographic boundaries directly from Mapshaper datasets with high efficiency
- **Multi-format Data Loading** — GeoJSON, TopoJSON, and ZIP Shapefiles loaded from URLs or local files
- **Interactive Editing** — mouse-wheel zoom, drag-to-pan, hover highlighting, and topology-aware vertex dragging
- **Dual Rendering Backends**
  - `CanvasPainter` — HTML5 Canvas 2D, fast and default
  - `CanvasKitPainter` — Skia WASM (experimental, better anti-aliasing)
- **Geographic Projections** — CRS support (EPSG:4326, EPSG:3857) with automatic coordinate transformations
- **Feature Querying** — spatial hit-testing and attribute inspection
- **Built-in UI Controls** — navigation buttons, vertex edit toolbar, status bar, basemap toggle

## Installation

```bash
pnpm install emap
# or
npm install emap
```

## Basic Usage

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      #map { width: 100vw; height: 100vh; margin: 0; }
    </style>
    <link rel="stylesheet" href="node_modules/emap/src/ui/controls.css" />
  </head>
  <body>
    <div id="map"></div>
    <script src="node_modules/emap/dist/mapshaper-vendor.js"></script>
    <script src="node_modules/emap/dist/emap.js"></script>
    <script>
      const { Emap, TopologySource, NavigationControl, EditToolbar } = emap;

      const map = new Emap({ container: "map" });

      map.addControl(new NavigationControl(), "top-left");
      map.addControl(new EditToolbar(), "top-left");

      async function loadData() {
        const source = await TopologySource.fromUrl(
          "china",
          "https://geojson.cn/api/china/1.6.3/china.topo.json"
        );
        map.addSource("china", source);
        map.setExtent(source.getExtent());
      }

      loadData();
    </script>
  </body>
</html>
```

## API Overview

### `Emap`

The core map instance.

```js
const map = new Emap({ container: "map" });

map.addSource(id, source);          // Register a TopologySource
map.setExtent(bounds);              // Fit viewport to bounds
map.addControl(control, position);  // Add a UI control
map.queryRenderedFeatures(point);   // Hit-test at a pixel coordinate
map.on("click", (e) => { ... });    // Listen to map events
```

### `TopologySource`

Loads and manages geographic data.

```js
// From a URL (GeoJSON, TopoJSON, or ZIP Shapefile)
const source = await TopologySource.fromUrl("id", url);

source.getExtent();   // Returns bounding box
source.getLayers();   // Returns available layers
```

### UI Controls

| Control | Description |
|---|---|
| `NavigationControl` | Zoom in/out and reset buttons |
| `EditToolbar` | Activates vertex editing mode |
| `StatusControl` | Shows cursor coordinates and CRS |
| `BasemapControl` | Toggles a MapLibre raster basemap |

All controls implement `onAdd(map)` / `onRemove()` and can be positioned at `"top-left"`, `"top-right"`, `"bottom-left"`, or `"bottom-right"`.

## Architecture

```
src/
├── map/map.ts              # Emap — orchestrates everything
├── source/topology-source.ts  # Data loading and LOD management
├── renderer/               # CanvasPainter, CanvasKitPainter
├── geo/                    # Viewport, Projection, Transform, Bounds
├── core/                   # EventDispatcher, drag/wheel interactions, tweening
└── ui/                     # Control implementations
```

Key design choices:
- All internal communication uses `EventDispatcher` (`on` / `fire`) — not raw DOM events
- Coordinate math uses 2D affine transforms: `(x * mx + bx, y * my + by)`
- Large datasets use Level of Detail (LOD) simplification via `display-arcs.ts`
- `CanvasPainter` batches 25 paths per `stroke()` call for performance

## Development

```bash
# Install dependencies
pnpm install

# Watch mode (sourcemaps)
npm run dev

# Single development build
npm run dev-build

# Production build (minified)
npm run build

# Run tests
npm test
```

Build outputs in `dist/`:
- `emap-dev.js` — development bundle with sourcemaps
- `emap.js` — production minified bundle
- `emap.mjs` — ES module
- `index.d.ts` — TypeScript declarations
- `mapshaper-vendor.js` — Mapshaper vendor bundle required before the IIFE build

Manual testing: open any `test/examples/*.html` in a browser after building.

## License

[MPL-2.0](LICENSE)
