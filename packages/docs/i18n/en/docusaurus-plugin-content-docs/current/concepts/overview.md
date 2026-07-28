---
id: overview
slug: /concepts/overview
title: Concepts Overview
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# Concepts overview

emap is organized around `Emap`, `TopologySource`, source layers, and render
layers. Understanding their ownership boundaries prevents common failures such
as loaded data that is not visible, mixed-up layer IDs, or direct dataset
mutations that bypass history and caches.

## Object relationship

```text
Browser container
└─ Emap
   ├─ Camera / Viewport
   ├─ Controls and Handlers
   ├─ History and Selection
   ├─ TopologySource "main"
   │  └─ mapshaper dataset
   │     ├─ source layer "districts"
   │     └─ source layer "roads"
   └─ render layers
      ├─ "district-fill" → main / districts
      ├─ "district-outline" → main / districts
      └─ "road-line" → main / roads
```

## Map instance

`Emap` binds to a browser container and:

- Creates and updates the canvas.
- Stores camera and viewport state.
- Registers sources and maintains render-layer order.
- Coordinates selection, editing, dragging, and zoom handlers.
- Owns controls, history, validation, and worker routing.
- Dispatches engine events through `on`, `off`, `once`, and `fire`.

One container has one map instance. Application UI should synchronize through
public APIs and events instead of changing canvas or viewport internals.

## Source

`TopologySource` is the boundary between imported data and the map. It accepts
URLs, files, or in-memory bytes, converts them into a mapshaper dataset, and
provides:

- Data bounds.
- Source layers inside the dataset.
- Topology arcs and simplification levels used for rendering.
- Export and format-plugin entry points.

A source ID such as `main`, `roads`, or `upload` is a map-level reference.
After `map.addSource('main', source)`, render layers and operations use that ID
to locate the data.

## Source layer and render layer

These two kinds of “layer” have different responsibilities:

| Kind | Origin | Contains | Example |
|---|---|---|---|
| source layer | Imported dataset | Geometry and attribute records | `districts` |
| render layer | Application configuration | Draw type, order, and paint | `district-fill` |

One source layer can feed multiple render layers. A district polygon layer may
be drawn once as a fill and again as an outline. A multi-layer dataset uses
`source-layer` to select the source layer.

## Extent and camera

Data coordinates do not automatically determine what the user currently sees.
After loading, applications usually run:

```ts
const extent = source.getExtent();
if (extent.hasBounds()) {
  map.fitBounds(extent, { padding: 32, duration: 0 });
}
```

`setExtent` directly sets an initial extent. `fitBounds` also supports padding
and animation. Check the bounds before moving the camera when the input may be
empty.

## Query, selection, and editing

- A **query** answers which features are under a screen position without
  necessarily changing map state.
- A **selection** stores source, source-layer, and feature ID references and
  fires `selectionchange`.
- An **edit** modifies data through a command or edit session and synchronizes
  history, caches, and rendering invalidation.
- A **data operation** updates or replaces a dataset through `map.ops` and
  returns an `OpResult`.

Do not mutate the object returned by `source.getDataset()`. A direct mutation
does not create an undo snapshot and may leave spatial indexes, simplified
display data, and selection state inconsistent.

## Complete data flow

```ts
const source = await TopologySource.fromUrl('main', '/data/roads.geojson');

map.addSource('main', source);
map.addLayer({
  id: 'roads',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': '#334155',
    'line-width': 2,
  },
});

map.setExtent(source.getExtent());

map.on(
  'feature:click',
  { layers: ['roads'] },
  (event) => {
    console.log(event.ref);
  },
);
```

The sequence is input data → topology dataset → registered source → render
layer configuration → camera → event-driven interaction.

## Where state changes belong

| Requirement | API surface |
|---|---|
| Change the view | Camera APIs such as `jumpTo`, `fitBounds`, `flyTo`, and `panBy` |
| Change appearance | Add, remove, or update render layers |
| Change selection | Map selection APIs or selection handlers |
| Change one feature | Edit commands, edit sessions, or built-in edit handlers |
| Process a dataset | `map.ops.*` |
| Group user actions | Transaction |
| React to internal changes | `map.on(...)` |

Continue with [Emap map instance](./emap.md),
[Sources and layers](./source-layer.md), [Topology model](./topology.md), and
[Coordinates and CRS](./coordinates-crs.md).
