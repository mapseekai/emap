---
id: overview
slug: /concepts/overview
title: Concepts overview
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: unreleased
---

# Concepts overview

> For repository/runtime layering, start with the [current architecture and source layout](/concepts/architecture).


`@mapseekai/emap` is a browser Canvas map and geospatial-data editing library. An application creates an `Emap`, imports a `TopologySource`, and declares how data is drawn with render layers. Separate objects own data, presentation, and interaction.

## Object relationship

```text
Browser container
└─ Emap
   ├─ camera, Canvas, events, selection, and edit history
   ├─ source "main" → TopologySource
   │  └─ mapshaper dataset
   │     ├─ source layer "districts"
   │     └─ source layer "roads"
   └─ render layers
      ├─ "district-fill" → main / districts
      ├─ "district-outline" → main / districts
      └─ "road-line" → main / roads
```

## Four levels

| Level | Owns | Common entry point |
| --- | --- | --- |
| `Emap` | Container, camera, layer order, interaction, and map state | `await Emap.create(...)` |
| source | Imported dataset plus its CRS, extent, and topology | `TopologySource` |
| source layer | One set of geometry and attributes in a dataset | `source-layer` |
| render layer | Draw type, style, and display order | `map.addLayer(...)` |

One source layer can supply several render layers. For example, a `fill` layer draws district interiors and a `line` layer draws the same districts' boundaries; both read the same geometry.

## From data to an interactive map

```ts
import { Emap, TopologySource } from '@mapseekai/emap';

const map = await Emap.create({ container: 'map' });
const source = await TopologySource.fromUrl('main', '/data/roads.geojson');

await map.addSource('main', source);
map.addLayer({
  id: 'roads',
  type: 'line',
  source: 'main',
  paint: { 'line-color': '#334155', 'line-width': 2 },
});

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 });
```

`main` is the map source ID. A render layer's `source` and data operations' `source` both use it. A multi-layer dataset also uses `source-layer` to select its source layer.

## Where state changes belong

| Goal | API |
| --- | --- |
| Change the view | `jumpTo`, `fitBounds`, `flyTo`, `panTo` |
| Change presentation | `addLayer`, `removeLayer`, `setLayerVisibility` |
| Read features at a screen position | `queryFeatures` |
| Change selection | `map.selection` or a selection handler |
| Edit features | Edit commands, edit sessions, or edit handlers |
| Process a dataset | `map.ops` |
| React to map changes | `on`, `once`, `off` |

Do not mutate the data returned by `source.getDataset()`. It is a zero-copy, read-only TypeScript view of the live dataset. Change data through the map's editing and operation entry points so rendering, selection, spatial indexes, and history stay synchronized.

Continue with [Emap map instance](./emap.md), [Sources and layers](./source-layer.md), [Topology model](./topology.md), and [Coordinates and CRS](./coordinates-crs.md).
