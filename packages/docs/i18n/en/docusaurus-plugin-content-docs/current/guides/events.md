---
id: events
slug: /guides/events
title: Events
api: ["CameraEvent", "Emap", "EmapEventMap", "EventDispatcher", "EventListener", "FeatureEvent", "FeatureEventFilter"]
examples: ["feature-attributes","interaction-handlers"]
stability: stable
verifiedVersion: 0.13.0
---

# Events

`Emap` extends `EventDispatcher`: known events infer payloads from `EmapEventMap`, while string events use `EventListener<T>`.

```ts
const onMoveEnd = (event: { type: 'moveend'; center: [number, number]; zoom: number }) => {
  const view = { center: event.center, zoom: event.zoom }; // save the settled view
};
map.on('moveend', onMoveEnd); // subscribe continuously
map.once('data', () => map.getSelection()); // remove after the first data event
map.off('moveend', onMoveEnd); // remove with the same function
```

## Core methods

`on`, `once`, and `off` return `this`:

```ts
map.on<K extends keyof EmapEventMap>(
  type: K,
  listener: (event: { type: K } & EmapEventMap[K]) => void,
): this;

map.once<K extends keyof EmapEventMap>(
  type: K,
  listener: (event: { type: K } & EmapEventMap[K]) => void,
): this;

map.off<K extends keyof EmapEventMap>(
  type: K,
  listener: (event: { type: K } & EmapEventMap[K]) => void,
): this;

map.on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
map.once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
map.off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

`type` is an event name from `keyof EmapEventMap`; the string overload supports custom events, and `listener` receives the payload including `type`. `on` subscribes continuously; `once` removes itself before first delivery; `off` removes or cancels with the same original function.

## More subscription options

### Feature event filters

The four feature events support these overloads; omit `options` to listen across visible features:

```ts
map.on(type: string, listener: (event: FeatureEvent) => void): this;
map.on(type: string, options: FeatureEventFilter, listener: (event: FeatureEvent) => void): this;
map.once(type: string, listener: (event: FeatureEvent) => void): this; // also accepts the options filter
map.off(type: string, listener: (event: FeatureEvent) => void): this;
```

```ts
const showFeature = (event: FeatureEvent) => {
  map.setHighlightedFeatures([event.ref]);
};

map.on('feature:click', { layers: ['lots'] }, (event) => map.select([event.ref]));
map.once('feature:enter', { source: 'parcels' }, showFeature);
map.off('feature:enter', showFeature);
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `'feature:click' \| 'feature:hover' \| 'feature:enter' \| 'feature:leave'` | — | Feature event name. |
| `options` | `FeatureEventFilter` | Omitted | Hit-test filter: `source` matches `FeatureRef.source`; `layers` matches `FeatureRef.layer` and narrows the query. |
| `listener` | `(event: FeatureEvent) => void` | — | Receives the feature, coordinates, and originating DOM event. |

`FeatureEvent` is `{ type, feature, ref, point, lngLat, modifiers, originalEvent }`: `ref` is `{ source, layer, id }`, `point` is local pixels, `lngLat` is source-data coordinates, `modifiers` has four modifier keys, and `originalEvent` is the DOM `Event`.

## Event payloads

Except for `mousemove`, the following `EmapEventMap` payloads include `type`.

### Camera

| Event | Payload | Description |
| --- | --- | --- |
| `movestart` | `CameraEvent`: `center: [number, number]`, `zoom: number`, `originalEvent: MouseEvent \| null` | Camera motion or zoom begins. |
| `move` | `Partial<CameraEvent>`: `center`, `zoom`, and `originalEvent` optional | Panning; may contain only `type`. |
| `moveend` | `CameraEvent` | Settled center and zoom. |
| `zoomstart` / `zoom` / `zoomend` | `CameraEvent` | Zoom begins, progresses, and ends. |

`CameraEvent.zoom` is `log2(scale)`; programmatic calls set `originalEvent` to `null`.

### Lifecycle, data, and layers

| Event | Payload | Description |
| --- | --- | --- |
| `crschange` | `{ type: 'crschange' }` | CRS update. |
| `resize` | `{ type: 'resize' }` | Canvas-size update. |
| `data` | `{ sourceId?: string; reason?: 'edit' \| 'load' \| 'replace' \| 'reproject'; origin?: 'external' }` | Data change; `origin: 'external'` marks external replacement. |
| `layerchange` | `{ reason: 'add' \| 'remove' \| 'visibility' \| 'effective' \| 'filter'; layerId?: string; layers: readonly LayerSpecification[] }` | Layer change. |

### Editing, diagnostics, and selection

| Event | Payload | Description |
| --- | --- | --- |
| `editmodechange` | `{ mode: 'none' \| 'vertex' \| 'draw' \| 'split' \| 'measure' \| 'transform' \| 'reshape' \| 'auto-complete' \| 'ring' \| 'part' }` | Editing-mode change. |
| `historychange` | `Partial<{ canUndo: boolean; canRedo: boolean; label?: string; staleCount: number; topIsStale: boolean; skippedStale?: boolean }>` | History-state change; may contain only `type`. |
| `selectionchange` | `{ selected: FeatureRef[]; added: FeatureRef[]; removed: FeatureRef[] }` | Full selection and deltas. |
| `validationfailed` | `{ results: ValidatorResult[]; label: string }`; each result is `{ validator: string; report: { ok: boolean; issues: Array<{ severity: 'error' \| 'warning'; message: string; ref?: FeatureRef }> } }` | Validation diagnostics. |
| `error` | `{ error: Error; layerId?: string; filterExpression?: StyleExpression; valueType?: string }` | Operation or style-expression error. |
| `warning` | `{ layerId: string; buckets?: number; error?: unknown }` | Style diagnostic. |

### Other emitted map events

The string overload also receives these map-runtime events.

| Event | Payload | Description |
| --- | --- | --- |
| `feature_created` | `{ id: number; source: string; layer: string; geometryType: 'polygon' \| 'polyline' \| 'point'; properties: Record<string, unknown> }` | New feature committed. |
| `vertex_moved` | `{ id: number; source: string; layer: string; vertexIndex: number \| null; vertexIds: number[]; coords: [number, number] }` | Vertex drag completed. |
| `workerjobstart` | `{ id: number; cmd: string; label: string; datasetVertexCount: number }` | Worker job started. |
| `workerjobend` | `{ id: number; ok: boolean; durationMs: number; errorMessage?: string }` | Worker job completed. |

### Pointer and feature

`mousemove` uses dedicated overloads:

```ts
map.on(type: 'mousemove', listener: (event: PointerMoveEvent) => void): this;
map.once(type: 'mousemove', listener: (event: PointerMoveEvent) => void): this;
map.off(type: 'mousemove', listener: (event: PointerMoveEvent) => void): this;
```

| Event | Payload | Description |
| --- | --- | --- |
| `mousemove` | `PointerMoveEvent`: `point: { x, y }`, `mapCoord: [number, number]`, `originalEvent: Event` | Pointer coordinates; no `type` or hit test. |
| `feature:click` / `feature:hover` / `feature:enter` / `feature:leave` | `FeatureEvent` | Click, hover, enter, and leave on hit features. |

## High-frequency events

`move`, `zoom`, `mousemove`, and `feature:hover` can fire frequently; coalesce DOM updates with `requestAnimationFrame`.

## Runnable examples

- [Feature attributes](/mapseekai/emap/examples/feature-attributes/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
