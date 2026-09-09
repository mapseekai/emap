---
id: events
slug: /reference/events
title: Events reference
api: ["Emap","EmapEventMap","CameraEvent","LayerChangeEvent","EventListener","FeatureEvent","FeatureEventFilter","PointerMoveEvent"]
examples: ["feature-selection","web-worker"]
stability: stable
verifiedVersion: 0.9.1
---

# Events reference

`Emap` subscribes to events with `on`, `once`, and `off`. Known event names infer their payloads. Applications can extend `EmapEventMap` through declaration merging to type custom events.

```ts
map.once("moveend", (event) => {
  console.log(event.center, event.zoom)
})
```

## Camera events

| Event | Payload | Fires when |
| --- | --- | --- |
| `movestart` | `CameraEvent` | A camera movement starts |
| `move` | `Partial<CameraEvent>` | The view or camera position changes |
| `moveend` | `CameraEvent` | A camera movement ends |
| `zoomstart` | `CameraEvent` | Zooming starts |
| `zoom` | `CameraEvent` | The zoom value changes |
| `zoomend` | `CameraEvent` | Zooming ends |

`CameraEvent` contains `center`, `zoom`, and `originalEvent`. `originalEvent` is `null` for programmatic camera movement. `move` also fires for pan and wheel view updates, so its camera fields are optional.

## Map state events

| Event | Payload | Fires when |
| --- | --- | --- |
| `crschange` | no fields | The map coordinate reference system changes |
| `resize` | no fields | The map container size changes |
| `data` | `sourceId?`, `reason?`, `origin?` | A source loads, edits, replaces data, or reprojects |
| `layerchange` | `LayerChangeEvent` | A layer is added, removed, or its effective visibility changes |
| `editmodechange` | `{ mode }` | The edit mode changes |
| `selectionchange` | `{ selected, added, removed }` | The selection changes |
| `historychange` | optional history-snapshot fields | History changes |
| `validationfailed` | `{ results, label }` | Post-commit validation returns failed results |
| `warning` | `{ layerId, buckets?, error? }` | Style parsing produces a diagnostic |
| `error` | `{ error }` | A map operation or event listener reports an error |

`data.reason` is `edit`, `load`, `replace`, or `reproject`. External input replacement includes `origin: "external"`. `layerchange.reason` is `add`, `remove`, `visibility`, or `effective`.

## Pointer and feature events

| Event | Payload | Use |
| --- | --- | --- |
| `mousemove` | `PointerMoveEvent` | Read container pixel coordinates, map coordinates, and the original DOM event |
| `feature:click` | `FeatureEvent` | Handle a hit feature click |
| `feature:hover` | `FeatureEvent` | Handle a hit feature hover |
| `feature:enter` | `FeatureEvent` | Handle a pointer entering a feature |
| `feature:leave` | `FeatureEvent` | Handle a pointer leaving a feature |

Feature events can filter by source or layer:

```ts
map.on("feature:click", { source: "parcels", layers: ["parcel-fill"] }, (event) => {
  console.log(event.ref, event.lngLat)
})
```

`FeatureEvent` provides `feature`, `ref`, `point`, `lngLat`, modifier state, and `originalEvent`. `mousemove` does not perform a feature hit test; its payload provides `point`, `mapCoord`, and `originalEvent`.

Internal handler, Worker, and source-dispatcher events are not dispatched through `map.on`.

## API

- [src.EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [src.EventListener](/mapseekai/emap/api/types/emap.EventListener.html)
- [src.FeatureEvent](/mapseekai/emap/api/interfaces/emap.FeatureEvent.html)

## Runnable examples

- [feature-selection](/mapseekai/emap/examples/feature-selection/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
