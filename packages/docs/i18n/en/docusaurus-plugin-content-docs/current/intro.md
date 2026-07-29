---
id: intro
slug: /
title: Emap Introduction
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# Emap

Emap is a browser-only TypeScript map rendering and editing engine. It keeps
topology in mapshaper data structures, renders through HTML5 Canvas 2D, and
connects data loading, layer styling, interaction, edit history, and spatial
processing behind one frontend API.

Emap does not require a backend map service. Data may come from a URL, a file
selected by the user, or in-memory bytes; import, inspection, editing, and
export can all happen in the browser.

## When to use Emap

- Build a GIS data viewer for GeoJSON, TopoJSON, or Shapefile ZIP files.
- Build a browser editor with feature selection, attribute changes, transforms,
  vertex editing, undo, and redo.
- Run simplify, buffer, clip, dissolve, projection, and topology repair
  workflows on the client.
- Use the engine and handlers under an application-specific toolbar, property
  panel, and status UI.
- Prototype a complete data workflow without deploying a backend GIS service.

Emap is not a replacement for tiled basemaps, 3D scenes, or server-side queries
over datasets that cannot fit in a browser. Its focus is topology data that can
be loaded and edited as a complete client-side dataset.

## Core building blocks

| Building block | Responsibility |
|---|---|
| `Emap` | Owns the canvas, camera, sources, render layers, interactions, controls, and history |
| `TopologySource` | Imports files or bytes and stores a mapshaper topology dataset |
| `LayerSpecification` | Selects a source layer and describes `fill`, `line`, or `circle` rendering |
| `map.ops` | Runs typed data operations with error results and history integration |
| Handler | Implements navigation, selection, drawing, vertex editing, and feature transforms |
| Control | Provides an optional DOM surface for a built-in capability |

A typical application follows this sequence:

1. Create a map container with an explicit size.
2. Construct `Emap`.
3. Load data through `TopologySource`.
4. Register the source and add render layers when custom styling is needed.
5. Set the initial camera from the data extent.
6. Listen for events and synchronize selection, properties, status, and errors
   with application UI.
7. Modify data through edit commands or `map.ops`, not by mutating the dataset
   directly.

## Main capabilities

### Data input and output

- The core package supports GeoJSON, TopoJSON, Shapefile ZIP, and mapshaper
  snapshots.
- `@mapseekai/emap/arrow` adds GeoParquet and GeoArrow.
- `@mapseekai/emap/duckdb` adds optional DuckDB-Wasm queries and spatial
  processing.

### Rendering and camera

- Render polygon, line, and point data through `fill`, `line`, and `circle`
  layers.
- Use `jumpTo`, `easeTo`, `flyTo`, `fitBounds`, `panTo`, and `zoomTo`.
- Reuse shared arcs and source-managed simplification levels while rendering
  topology.

### Interaction and editing

- Click, box, and lasso selection.
- Feature translation, rotation, scaling, drawing, and vertex editing.
- One history for editing commands and transactions.
- Public feature, camera, history, validation, and worker events.

## Package entries and static assets

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

// Optional entries do not affect applications that only import the core package
import '@mapseekai/emap/arrow';
const duckdb = await import('@mapseekai/emap/duckdb');
```

Worker deployments must also serve `emap-worker.js` and
`mapshaper-vendor.js`. See the [Web Worker guide](./guides/worker.md) for the
deployment layout.

## Recommended reading order

1. [Installation](./getting-started/installation.md): build the first runnable
   map.
2. [Concepts overview](./concepts/overview.md): understand maps, sources, and
   layers.
3. [Styling](./guides/styling.md): control how points, lines, and polygons are
   drawn.
4. [Selection](./guides/selection.md) and [Editing](./guides/editing.md): add
   interactions.
5. [Data operations](./data/operations.md): process topology and attributes.
6. [Error handling](./recipes/error-handling.md): present failures safely.

## Project status

These docs describe `@mapseekai/emap` 0.5.0. The project is still evolving
quickly and is best suited to prototypes, demos, research tools, and controlled
internal applications. Review the migration notes and API reference when
upgrading.
