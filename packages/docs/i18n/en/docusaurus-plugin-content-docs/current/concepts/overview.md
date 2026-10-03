---
id: overview
slug: /concepts/overview
title: Concepts overview
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.14.0
---

# Concepts overview

`@mapseekai/emap` is a browser Canvas map and geodata-editing library: `Emap` owns the map, `TopologySource` owns data, and render layers own presentation.

Together these objects support loading, multiple styles over the same data, spatial queries, and undoable edits. The sections below map application tasks to their entry points.

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // import the map and data source

const map = await Emap.create({ container: 'map' }); // create the map
const source = await TopologySource.fromUrl('main', '/data/roads.geojson'); // load GeoJSON

await map.addSource('main', source); // register the source
map.addLayer({
  id: 'roads',
  type: 'line',
  source: 'main',
  paint: { 'line-color': '#334155', 'line-width': 2 },
}); // render the source

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 }); // fit the data extent
```

`main` is the map source ID; render layers and data operations use it. Multi-layer datasets also use `source-layer` to select a target.

## Core levels

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

| Level | Owns | Common entry point |
| --- | --- | --- |
| `Emap` | Container, camera, layer order, interaction, and map state | `await Emap.create(...)` |
| source | Imported dataset plus its CRS, extent, and topology | `TopologySource` |
| source layer | One set of geometry and attributes in a dataset | `source-layer` |
| render layer | Draw type, style, and display order | `map.addLayer(...)` |

One source layer can supply several render layers, such as `fill` for interiors and `line` for the same geometry's boundaries.

## More state-change entry points

| Goal | API | Scenario |
| --- | --- | --- |
| Change the view | `jumpTo`, `fitBounds`, `flyTo`, `panTo` | Locate, fit, fly, or pan |
| Change presentation | `addLayer`, `removeLayer`, `setLayerVisibility` | Layer declaration, order, and visibility |
| Read features at a screen position | `queryFeatures` | Click, box, and hit testing |
| Change selection | `select()` / `deselect()` / `clearSelection()` or a selection handler | Code or gesture selection |
| Edit features | Edit commands, edit sessions, or edit handlers | Undoable geometry and attribute changes |
| Process a dataset | `map.ops` | mapshaper data operations |
| React to map changes | `on`, `once`, `off` | Map-event subscriptions |

## More view parameters

View coordinates use map projected/data coordinates; CRS-agnostic `scale` takes precedence over WebMercator `zoom`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `jumpTo(options).center` | `[number, number]` | Current center | Immediate-move target center |
| `jumpTo(options).zoom` | `number` | Current zoom | WebMercator target zoom |
| `jumpTo(options).scale` | `number` | Current scale | CRS-agnostic target scale; takes precedence |
| `fitBounds(bounds, options).bounds` | `Bounds` | Required | Coordinate extent to center and fit |
| `fitBounds(bounds, options).padding` | `number` | `0` | Side inset in pixels |
| `fitBounds(bounds, options).maxScale` | `number` | Unbounded | Maximum fitted scale |
| `fitBounds(bounds, options).duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | Fit animation duration, easing, and switch |
| `flyTo(options).center` | `[number, number]` | Current center | Flight end center |
| `flyTo(options).zoom` / `scale` | `number` | Current zoom/scale | End scale; `scale` takes precedence |
| `flyTo(options).duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | Flight animation duration, easing, and switch |
| `flyTo(options).speed` | `number` | Unspecified | Viewport widths per second; distance timing |
| `flyTo(options).curve` | `number` | `1.42` | van Wijk flight curvature |
| `panTo(center, options).center` | `[number, number]` | Required | Pan destination preserving scale |
| `panTo(center, options).duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | Pan animation duration, easing, and switch |

## More layer parameters

Render-layer APIs use layer IDs; `addLayer` requires an added `source`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `addLayer(layer).id` / `.type` / `.source` | `string` / `'fill' \| 'line' \| 'circle'` / `string` | Required | Unique render-layer ID, drawing mode, and linked source ID |
| `addLayer(layer)['source-layer']` | `string` | First source layer | Target source layer in dataset |
| `addLayer(layer).layout.visibility` | `'visible' \| 'none'` | `'visible'` | Initial visibility |
| `addLayer(layer).paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | Unspecified | Layer style |
| `addLayer(layer, before).before` | `string` | End of stack | Render-layer ID to insert before |
| `removeLayer(id).id` / `setLayerVisibility(id, visibility).id` | `string` | Required | Target render-layer ID |
| `setLayerVisibility(id, visibility).visibility` | `'visible' \| 'none'` | Required | Target visibility |

## More query and selection parameters

`queryFeatures` queries a Canvas pixel point, pixel bounds, or the viewport; results are top-to-bottom by visible render layer.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `queryFeatures(geometry).geometry` | `[number, number]` or `[[number, number], [number, number]]` | Current viewport | Canvas pixel point or bounds |
| `queryFeatures(geometry, options).options.layers` | `string[]` | All source layers behind visible render layers | Source-layer scope |

Selection APIs identify features with `FeatureRef` (`source`, `layer`, `id`) and emit `selectionchange`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `select(features, options).features` | `ReadonlyArray<FeatureRef>` | Required | Feature references to select |
| `select(features, options).options.mode` | `'replace' \| 'add' \| 'toggle'` | `'replace'` | Replace, add, or toggle selection |
| `deselect(features).features` | `ReadonlyArray<FeatureRef>` | Required | Feature references to remove |
| `clearSelection()` | `—` | `—` | Clears selection |

## More data-operation parameters

`map.ops` is the `MapshaperOps` entry point; data operations return `Promise<OpResult>`, replace data, and record undo history.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `map.ops` | `Pick<MapshaperOps, keyof MapshaperOps>` | Read-only getter | Data-transformation operation collection |
| `map.ops.withSignal(signal).signal` | `AbortSignal` | Required | Long-operation cancellation scope |
| `map.ops.clipLayer(options).source` | `string` | Required | Source ID holding target and mask |
| `map.ops.clipLayer(options).target` | `string` | Required | Source layer to clip |
| `map.ops.clipLayer(options).mask` / `bbox` | `string` / `[number, number, number, number]` | Exactly one | Polygon mask or data-coordinate rectangle |
| `map.ops.dissolveLayer(options).source` / `target` | `string` / `string` | Required | Source and source layer to dissolve |
| `map.ops.dissolveLayer(options).field` / `fields` | `string` / `string[]` | Ungrouped | Attribute grouping fields |

## More event parameters

Event APIs return `map` for chaining; common types include `moveend`, `data`, `layerchange`, `selectionchange`, and `feature:click`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `on(type, listener).type` | `keyof EmapEventMap \| string` | Required | Continuously subscribed map event |
| `on(type, listener).listener` | `EventListener` | Required | Event callback |
| `on(type, filter, listener).filter` | `FeatureEventFilter` | All visible features | Source/layer filter for `feature:*` |
| `once(type, listener).type` / `listener` | `keyof EmapEventMap \| string` / `EventListener` | Required | One-time event subscription |
| `once(type, filter, listener).filter` | `FeatureEventFilter` | All visible features | Source/layer filter for one `feature:*` event |
| `off(type, listener).type` / `listener` | `keyof EmapEventMap \| string` / `EventListener` | Required | Removes event callback |

`source.getDataset()` provides a live, zero-copy TypeScript readonly view. Modify its underlying data through map editing and operation APIs to synchronize rendering, selection, indexes, and history.

Continue with [Emap map instance](./emap.md), [Sources and layers](./source-layer.md), [Topology model](./topology.md), and [Coordinates and CRS](./coordinates-crs.md); for code and plugin organization see [Architecture and source layout](./architecture.md).

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
