---
id: intro
slug: /
title: Introduction
api: ["Emap", "LayerSpecification", "TopologySource"]
examples: ["china-editing","export-formats","getting-started/geojson-viewer"]
stability: stable
verifiedVersion: unreleased
---

# Emap

`@mapseekai/emap` is a browser-side TypeScript map engine: load vector data, render layers with Canvas 2D, edit features, and run spatial analysis — no backend map service required. Data lives in mapshaper topology datasets, and every change is an undoable command.

It is built for applications that embed GIS viewing, editing, and processing into their own interface: data viewers, business editors, batch-processing tools. The application owns its toolbars, property panels, and status UI; Emap provides the map, the data, the interaction, and the plugin runtime.

## Capabilities

**Data formats**: the core package reads and writes GeoJSON, TopoJSON, Shapefile ZIP, and mapshaper snapshots, and imports KML. The `/arrow` entry adds GeoArrow and GeoParquet; the `/geopackage` entry decodes GeoPackage vector tables directly into a typed-buffer dataset, on the main thread or in a Worker. FlatGeobuf works after the application registers a format plugin.

**Layers and styling**: `fill`, `line`, and `circle` render layers with viewport culling, zoom-aware display-arc simplification, and attribute-driven fill buckets. Paint properties such as `fill-color` accept a restricted expression subset — no `eval`.

**Editing and history**: draw, edit vertices, split, merge, reshape, edit rings/holes/parts, auto-complete polygons, and translate/rotate/scale selected features. Edit commands and data operations all go through history, with undo, redo, transactions, and selection restoration.

**Data operations**: `map.ops` exposes 45 mapshaper operations — clip, erase, dissolve, buffer, simplify, project, join, classify, and more. Operations can route to a Web Worker, and data versions are checked before committing so stale results never overwrite newer state. The `/duckdb` entry adds DuckDB-Wasm SQL queries and spatial analysis.

**Runtime and extension**: `Emap` is the public facade; `map.ctx` is the native Cordis `Context`. The `editor`, `viewer`, `headless`, and `empty` presets are plugin compositions, not separate map classes. The `/ai` entry exposes existing operations as capabilities callable from UI, workflows, and agents. The `/maplibre` entry wires in MapLibre online basemaps and overlays.

## Start here

1. [Install](./getting-started/installation.md) and configure the optional entries you need.
2. Follow [Your first map](./getting-started/quick-start.md) to a working page.
3. Read [Concepts overview](./concepts/overview.md) for the relationship between sources, source layers, and render layers.
4. Look up [Styling](./guides/styling.md), [Selection](./guides/selection.md), [Editing](./guides/editing.md), and [Data operations](./data/operations.md) as tasks come up.
5. Browse the [runnable examples](/mapseekai/emap/examples/) for complete implementations; runtime layering and source organization are in [Architecture](./concepts/architecture.md).

A site index for AI coding assistants lives at [llms.txt](pathname:///llms.txt).
