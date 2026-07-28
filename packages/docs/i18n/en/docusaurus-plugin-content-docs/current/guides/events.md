---
id: events
slug: /guides/events
title: Events
api: ["CameraEvent","Emap","EmapEventMap","EventDispatcher","EventListener","FeatureEvent","FeatureEventFilter"]
examples: ["feature-attributes","interaction-handlers"]
stability: stable
verifiedVersion: 0.5.0
---

# Events

emap uses `EventDispatcher` at the engine layer. Applications use `map.on`,
`map.once`, and `map.off` for camera, data, selection, history, validation,
pointer, and feature changes without subscribing to internal canvas events.

## Basic subscription

```ts
const onMoveEnd = (event: {
  center: [number, number];
  zoom: number;
}) => {
  console.log(event.center, event.zoom);
};

map.on('moveend', onMoveEnd);
map.off('moveend', onMoveEnd);
```

`off` requires the same function reference that was registered. For one
delivery:

```ts
map.once('data', (event) => {
  console.log(event.sourceId, event.reason);
});
```

## Public map events

| Event | Payload | Typical use |
|---|---|---|
| `movestart` | `CameraEvent` | Camera movement started |
| `move` | `Partial<CameraEvent>` | Movement in progress; fields may be absent |
| `moveend` | `CameraEvent` | Camera movement completed |
| `zoomstart` | `CameraEvent` | Zoom started |
| `zoom` | `CameraEvent` | Zoom in progress |
| `zoomend` | `CameraEvent` | Zoom completed |
| `resize` | no application fields | Container dimensions updated |
| `crschange` | no application fields | Map CRS changed |
| `data` | `sourceId`, `reason` | Load, replace, edit, or reproject |
| `editmodechange` | `mode` | Edit mode changed |
| `error` | `error` | Map-level asynchronous failure |
| `historychange` | history snapshot fields | Undo/redo state changed |
| `selectionchange` | `selected`, `added`, `removed` | Selection actually changed |
| `validationfailed` | `results`, `label` | An after-commit validator failed |
| `mousemove` | pointer screen/map data | Coordinate display or custom hover |

`move` may come from a complete camera lifecycle or a bare viewport pan, so its
camera fields are optional. Use `moveend` for a stable final center and zoom.

## Feature events

Public feature events are `feature:click`, `feature:hover`, `feature:enter`, and
`feature:leave`.

Listen to every visible layer:

```ts
map.on('feature:click', (event) => {
  console.log(event.ref);
  console.log(event.feature.properties);
});
```

Or filter by map source ID and source-layer name:

```ts
map.on(
  'feature:click',
  {
    source: 'main',
    layers: ['districts'],
  },
  (event) => {
    console.log(event.ref.id);
  },
);
```

`layers` filters `FeatureRef.layer`, which is a source-layer name inside the
dataset, not a render-layer ID.

`FeatureEvent` contains:

| Field | Meaning |
|---|---|
| `feature` | Feature accessor for properties and geometry |
| `ref` | `{ source, layer, id }` |
| `point` | Pixel coordinates inside the canvas container |
| `lngLat` | Current map coordinates |
| `modifiers` | Shift, Ctrl, Alt, and Meta state |
| `originalEvent` | Original browser event |

## Selection and camera events

`selectionchange` only fires when the set changes:

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  updateSelectionCount(selected.length);
  updatePropertyPanel(selected);
  console.log({ added, removed });
});
```

For a programmatic camera call, `CameraEvent.originalEvent` is `null`:

```ts
map.on('moveend', (event) => {
  if (event.originalEvent === null) {
    console.log('Triggered by application code');
  }
});
```

## Application events

Applications can augment `EmapEventMap`:

```ts
declare module '@zwishing/emap' {
  interface EmapEventMap {
    'panel:open': { panelId: string };
  }
}

map.on('panel:open', ({ panelId }) => {
  console.log(panelId);
});

map.fire('panel:open', { panelId: 'properties' });
```

Internal worker-pool `workerjob*` signals are not public `map.on` events. Drive
progress UI from the operation Promise, `OpResult`, and application state.

## High-frequency listeners

`move`, `zoom`, `mousemove`, and `feature:hover` may fire frequently. Do not
import data or run topology operations in those listeners. Coalesce DOM updates
with `requestAnimationFrame` when needed.

## API

- [Emap](/emap/api/classes/index.Emap.html)
- [EmapEventMap](/emap/api/interfaces/index.EmapEventMap.html)
- [CameraEvent](/emap/api/interfaces/index.CameraEvent.html)
- [FeatureEvent](/emap/api/interfaces/index.FeatureEvent.html)

## Runnable examples

- [Feature attributes](/emap/examples/feature-attributes/)
- [Interaction handlers](/emap/examples/interaction-handlers/)
- [Feature selection](/emap/examples/feature-selection/)
