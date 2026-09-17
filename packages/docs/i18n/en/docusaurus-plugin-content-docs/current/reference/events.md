---
id: events
slug: /reference/events
title: Events reference
api: ["Emap", "EmapEventMap", "CameraEvent", "LayerChangeEvent", "EventListener", "FeatureEvent", "FeatureEventFilter", "PointerMoveEvent"]
examples: ["feature-selection","web-worker"]
stability: stable
verifiedVersion: 0.12.0
---

# Events reference

`Emap` subscribes with `on`, `once`, and `off`; known event names infer payload types.

```ts
map.once('moveend', (event) => {
  // Listen for the next movement end only
  console.log(event.center, event.zoom); // Read the final view
}); // Unsubscribe automatically
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `on(type, listener)` / `once(type, listener)` | `keyof EmapEventMap \| string`, `EventListener<T>` | Registers continuing / one-time listeners; known names infer payload. |
| `off(type, listener)` | `keyof EmapEventMap \| string`, `EventListener<T>` | Removes a listener by function reference. |

`EventListener<T>` receives `{ type: string } & T`; extend `EmapEventMap` through declaration merging.

## Core events

| Event | Payload | Fires when |
| --- | --- | --- |
| `movestart` / `move` / `moveend` | `CameraEvent` / `Partial<CameraEvent>` / `CameraEvent` | A camera movement starts / changes / ends. |
| `zoomstart` / `zoom` / `zoomend` | `CameraEvent` | Zooming starts / changes / ends. |

### Camera payload

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | Literal type of the corresponding event name | — | Event name. |
| `center` | `[number, number]` | Optional in `move` | Camera-center coordinates. |
| `zoom` | `number` | Optional in `move` | `log2(scale)`. |
| `originalEvent` | `MouseEvent \| null` | Optional in `move`; `null` for programmatic movement | Mouse event that moved the camera. |

All camera events except `move` provide complete `CameraEvent`.

## More map-state events

| Event | Payload | Fires when |
| --- | --- | --- |
| `crschange` | `Record<never, never>` | The map coordinate reference system changes. |
| `resize` | `Record<never, never>` | The map container size changes. |
| `data` | Source-change information | A source loads, edits, replaces data, or reprojects. |
| `layerchange` | `LayerChangeEvent` | A layer add, removal, visibility state, effective layer set, or display filter changes. |
| `editmodechange` | Edit mode | The edit mode changes. |
| `selectionchange` | Selection-set diff | The selection changes. |
| `historychange` | `Partial<HistoryStateSnapshot>` | History changes or its stack is cleared. |
| `validationfailed` | Validation failure results | Post-commit validation returns failed results. |
| `warning` | Style diagnostic | Style parsing produces a diagnostic. |
| `error` | Error diagnostic | A map operation or listener reports an error. |

### State payload

Every state event has its literal `type`; `crschange` and `resize` have no other payload.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `data.sourceId` | `string` | Omitted | Changed source ID. |
| `data.reason` | `'edit' \| 'load' \| 'replace' \| 'reproject'` | Omitted | Change category. |
| `data.origin` | `'external'` | Omitted | External-replacement marker. |
| `layerchange.reason` | `'add' \| 'remove' \| 'visibility' \| 'effective' \| 'filter'` | — | Layer-change reason. |
| `layerchange.layerId` | `string` | Omitted | Directly operated layer ID. |
| `layerchange.layers` | `readonly LayerSpecification[]` | — | Changed layer snapshot. |
| `editmodechange.mode` | `'none' \| 'vertex' \| 'draw' \| 'split' \| 'measure' \| 'transform' \| 'reshape' \| 'auto-complete' \| 'ring' \| 'part'` | — | Current edit mode. |
| `selectionchange.selected` | `FeatureRef[]` | — | Complete selection. |
| `selectionchange.added` | `FeatureRef[]` | — | Added features. |
| `selectionchange.removed` | `FeatureRef[]` | — | Removed features. |
| `historychange.canUndo` | `boolean` | Omitted | Undo availability. |
| `historychange.canRedo` | `boolean` | Omitted | Redo availability. |
| `historychange.label` | `string` | Omitted | Latest command label. |
| `historychange.staleCount` | `number` | Omitted | Stale command count. |
| `historychange.topIsStale` | `boolean` | Omitted | Next undo is stale. |
| `historychange.skippedStale` | `boolean` | Omitted | Post-stale-crossing marker. |
| `validationfailed.results` | `ValidatorResult[]` | — | Failing-validator results. |
| `validationfailed.results[].report.ok` | `boolean` | — | `true` with only warnings or no issues. |
| `validationfailed.results[].report.issues` | `ValidationIssue[]` | — | Validation issues. |
| `validationfailed.label` | `string` | — | Triggering command label. |
| `warning.layerId` | `string` | — | Style-diagnostic layer ID. |
| `warning.buckets` | `number` | Omitted | Style-bucket count. |
| `warning.error` | `unknown` | Omitted | Style-expression error. |
| `error.error` | `Error` | — | Original error. |
| `error.layerId` | `string` | Omitted | Associated layer ID. |
| `error.filterExpression` | `StyleExpression` | Omitted | Failed filter expression. |
| `error.valueType` | `string` | Omitted | Value type causing the error. |

## More pointer and feature events

| Event | Payload | Use |
| --- | --- | --- |
| `mousemove` | `PointerMoveEvent` | Read container pixel coordinates, map coordinates, and the original DOM event. |
| `feature:click` | `FeatureEvent` | Handle a hit feature click. |
| `feature:hover` | `FeatureEvent` | Continuously respond while the pointer is over a feature. |
| `feature:enter` / `feature:leave` | `FeatureEvent` | Handle entering / leaving a hit feature. |

### Pointer and feature payload

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `mousemove.point` | `{ x: number; y: number }` | — | Container CSS-pixel coordinates. |
| `mousemove.mapCoord` | `[number, number]` | — | Data coordinates from `unproject()`. |
| `mousemove.originalEvent` | `Event` | — | Original DOM event. |
| `feature.type` | `string` | — | Feature-event name. |
| `feature.feature` | `Feature` | — | Read-only hit-feature view. |
| `feature.ref` | `FeatureRef` | — | Hit-feature reference. |
| `feature.point` | `{ x: number; y: number }` | — | CSS-pixel hit coordinates. |
| `feature.lngLat` | `[number, number]` | — | Hit data coordinates. |
| `feature.modifiers` | `{ shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }` | — | Modifier-key state. |
| `feature.originalEvent` | `Event` | — | Original DOM event. |

### Feature-event filters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | All sources when omitted | Filters by `ref.source`. |
| `layers` | `string[]` | All visible source layers when omitted | Filters by `ref.layer`. |

`FeatureRef` is the `{ source, layer, id }` feature identifier.

```ts
map.on('feature:click', { source: 'parcels', layers: ['lots'] }, (event) => {
  // Listen only to parcels lots
  console.log(event.ref, event.lngLat); // Read the feature and hit coordinate
}); // Register a continuing listener
```

## API

- [src.EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [src.EventListener](/mapseekai/emap/api/types/emap.EventListener.html)
- [src.FeatureEvent](/mapseekai/emap/api/interfaces/emap.FeatureEvent.html)

## Runnable examples

- [feature-selection](/mapseekai/emap/examples/feature-selection/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
