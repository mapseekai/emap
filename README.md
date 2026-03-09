# emap

A modern, decoupled rendering engine for geographic data, designed to seamlessly integrate with [Mapshaper](https://github.com/mbloch/mapshaper).

## Overview

`emap` is a high-performance interactive geographic map rendering engine supporting scalable topologies. It provides map rendering, geometric editing, and feature querying capabilities using standard HTML5 Canvas 2D or CanvasKit (Skia WASM) acceleration.

### Key Features

- **Topology-based Rendering**: Uses mapshaper datasets to draw and edit geographic boundaries efficiently.
- **Multiple Source Formats**: Built-in support for online/local GeoJSON, TopoJSON, and ZIP Shapefiles with automatic feature extraction.
- **Interactive Editing**: Support for dragging and hovering features, zooming with mouse-wheel, panning, and vertex topology editing directly on the map.
- **Rendering Backends**:
  - `CanvasPainter`: Standard HTML5 Canvas 2D API (Fast, default).
  - `CanvasKitPainter`: CanvasKit / Skia WASM based rendering (Experimental).
- **Projections**: Geographic coordinate projections and automatic coordinate transformations.

## Installation

```bash
npm install emap
# or
pnpm install emap
```

## Basic Usage

Include the generated bundle from `dist/emap.js` (or `dist/emap-dev.js` for development).

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      #map {
        width: 100vw;
        height: 100vh;
        margin: 0;
      }
    </style>
    <link rel="stylesheet" href="node_modules/emap/src/ui/controls.css" />
  </head>
  <body>
    <div id="map"></div>
    <script src="node_modules/emap/dist/emap.js"></script>
    <script>
      const { Emap, TopologySource, NavigationControl, EditToolbar } = emap;

      const map = new Emap({ container: "map" });

      // Add built-in UI controls
      map.addControl(new NavigationControl(), "top-left");
      map.addControl(new EditToolbar(), "top-left");

      async function loadData() {
        // Load GeoJSON, TopoJSON, or ZIP Shapefile from a URL
        const url = "https://geojson.cn/api/china/1.6.3/china.topo.json";
        const source = await TopologySource.fromUrl("china", url);

        map.addSource("china", source);
        map.setExtent(source.getExtent());
      }

      loadData();
    </script>
  </body>
</html>
```

## Architecture

- **`Emap` (`src/map/map.ts`)**: The core map instance orchestrating the viewport, user interactions, controls, and rendering pipelines.
- **`TopologySource` (`src/source/topology-source.ts`)**: Handles downloading, parsing, flattening, and simplifying Mapsaper datasets for optimized rendering.
- **`Painter` (`src/renderer/painter.ts`)**: Base renderer interface implemented by `CanvasPainter` and `CanvasKitPainter`.
- **`Viewport` & `Projection`**: Handles spatial logic, map transformation properties, zooming, and projection mapping.

## Development

```bash
# Install dependencies
pnpm install

# Start development build (watch mode)
npm run dev

# Build for production
npm run build
```

## License

MPL-2.0
