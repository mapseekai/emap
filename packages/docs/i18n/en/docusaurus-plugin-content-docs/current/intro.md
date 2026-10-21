---
id: intro
slug: /
title: Introduction
api: ["Emap", "LayerSpecification", "TopologySource"]
examples: ["china-editing","export-formats","getting-started/vector-file"]
stability: stable
verifiedVersion: 0.14.0
---

# Emap

`@mapseekai/emap` is a browser topology map engine. It loads, draws, edits, and analyzes vector data stored in an undoable mapshaper topology dataset.

Use it for a data viewer, a topology editor, or a spatial analysis page. Add format, basemap, and background-processing plugins when you need them.

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({ container: 'map' });
const source = await TopologySource.fromUrl('main', '/data/roads.geojson');
await map.addSource('main', source);
map.addLayer({ id: 'roads', type: 'line', source: 'main' });
```

## Find a task

| What you want to do | Start here |
| --- | --- |
| Draw a first map | [Install](./getting-started/installation.md), [Your first map](./getting-started/quick-start.md) |
| Understand map, source, and layer | [Core concepts](./concepts/overview.md) |
| Move the view or handle CRS | [Camera](./guides/camera.md), [Coordinates](./concepts/coordinates-crs.md) |
| Style points, lines, and polygons | [Styling](./guides/styling.md) |
| Click, select, and listen | [Selection](./guides/selection.md), [Events](./guides/events.md) |
| Draw and edit features | [Editing](./guides/editing.md) |
| Import, analyze, or query | [Formats](./data/formats.md), [Operations](./data/operations.md), [DuckDB](./data/duckdb.md) |
| See how the runtime maps to the source tree | [Runtime composition](./concepts/runtime.md) |

Parameter tables stay in the matching guide and the [reference](./reference/events.md). Examples use the same task groups: [Examples](/mapseekai/emap/examples/).

## Runnable examples

- [Open a vector file](/mapseekai/emap/examples/getting-started/vector-file/)
- [Export formats](/mapseekai/emap/examples/export-formats/)
- [China editing](/mapseekai/emap/examples/china-editing/)
