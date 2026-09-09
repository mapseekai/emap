---
id: intro
slug: /
title: Emap Introduction
api: ["Emap","LayerSpecification","TopologySource"]
examples: ["china-editing","export-formats","getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.9.1
---

# Emap

Emap is a browser-focused TypeScript library for map rendering, editing, and spatial data processing. It renders with Canvas 2D and manages data sources as mapshaper topology datasets. An application can load data, draw layers, edit features, run analysis operations, and export results in the frontend.

Emap serves applications that combine viewing, interaction, and processing for data that fits in the browser, including GIS data viewers, business editors, and data-processing tools. The application owns its toolbar, property panel, and status UI; Emap supplies the map, data, and interaction capabilities.

## Supported capabilities

### Data input and output

The core package imports and exports GeoJSON, TopoJSON, Shapefile ZIP, and mapshaper snapshots, and imports KML. `TopologySource` loads data from a URL, file bytes, or application memory and exports results as a `Blob`.

Import `@mapseekai/emap/arrow` to read and write GeoArrow and GeoParquet. FlatGeobuf input and output are available after the application installs `flatgeobuf` and registers a local format plugin.

### Layers, interaction, and editing

`Emap` manages the canvas, camera, sources, render layers, events, and history. Use `LayerSpecification` to add `fill`, `line`, and `circle` layers for polygon, line, and point data.

The library provides pan, zoom, click, box, and lasso selection; drawing; vertex, split, reshape, ring, and part editing. Edit commands and data operations enter the history, which an application can expose through undo and redo UI.

### Analysis and data processing

`map.ops` provides simplify, buffer, clip, erase, dissolve, union, projection, topology repair, attribute processing, and layer-management operations. Import `@mapseekai/emap/duckdb` and install DuckDB-Wasm to use DuckDB query and spatial-processing capabilities.

## Start here

1. Read [Installation](./getting-started/installation.md) to install the package, import its stylesheet, and configure optional modules.
2. Read [Concepts overview](./concepts/overview.md) to understand the relationship between maps, sources, and render layers.
3. Read [Data formats](./data/formats.md) and [Styling](./guides/styling.md) to load data and define its presentation.
4. Read [Selection](./guides/selection.md), [Editing](./guides/editing.md), and [Data operations](./data/operations.md) to add interaction and processing workflows.
5. Open the [runnable examples](/mapseekai/emap/examples/) for complete implementations.