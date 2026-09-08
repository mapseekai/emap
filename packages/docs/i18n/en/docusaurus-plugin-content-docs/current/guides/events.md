---
id: events
slug: /guides/events
title: Events
api: ["CameraEvent","Emap","EmapEventMap","EventDispatcher","EventListener","FeatureEvent","FeatureEventFilter"]
examples: ["feature-attributes","interaction-handlers"]
stability: stable
verifiedVersion: 0.9.0
---

# Events

Use `map.on()` to subscribe, `map.once()` for one subscription, and `map.off()` with the same listener to remove it. Emap supplies typed payloads for camera, data, layer, selection, history, validation, pointer, and feature events.

## Subscribe and remove

```ts
const onMoveEnd = ({ center, zoom }: { center: [number, number]; zoom: number }) => {
  const view = { center, zoom };
};

map.on('moveend', onMoveEnd);
map.once('data', () => map.getSelection());
map.off('moveend', onMoveEnd);
```

## Common map events

| Event | Use |
|---|---|
| `movestart`, `move`, `moveend` | Synchronize camera position |
| `zoomstart`, `zoom`, `zoomend` | Synchronize zoom UI |
| `data`, `crschange`, `resize` | Respond to data and viewport lifecycle |
| `layerchange` | Update a layer list |
| `selectionchange` | Update a selection summary |
| `historychange` | Enable or disable undo/redo buttons |
| `editmodechange` | Synchronize editing-tool state |
| `validationfailed`, `error`, `warning` | Present operation and style diagnostics |

A `CameraEvent` from a programmatic camera call has `originalEvent` set to `null`.

## Subscribe to feature events

Feature events accept an optional filter. `layers` uses source-layer names:

```ts
map.on('feature:click', { layers: ['lots'] }, (event) => {
  map.select([event.ref]);
});

map.on('feature:hover', (event) => {
  map.setHighlightedFeatures([event.ref]);
});
```

The available events are `feature:click`, `feature:hover`, `feature:enter`, and `feature:leave`. `mousemove` supplies pointer events without hit-test filtering.

## Handle high-frequency events

`move`, `zoom`, `mousemove`, and `feature:hover` can fire frequently. Coalesce DOM updates in a listener with `requestAnimationFrame`, and run data imports and topology operations from explicit user actions.

## Runnable examples

- [Feature attributes](/mapseekai/emap/examples/feature-attributes/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
