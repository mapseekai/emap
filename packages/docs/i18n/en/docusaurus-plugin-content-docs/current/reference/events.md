---
id: events
slug: /reference/events
title: Events reference
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# Events reference

Common public events include `move`, `moveend`, `zoom`, `zoomend`,
`selectionchange`, `historychange`, `validationfailed`, `data`, and feature
events.

## Behavior notes

Known event names infer payloads. Unknown names remain available for
application-level extension. Internal worker-pool `workerjob*` signals are not
dispatched through `map.on`.

## API

- [src.EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [src.EventListener](/mapseekai/emap/api/types/emap.EventListener.html)

## Runnable examples

- [web-worker](/mapseekai/emap/examples/web-worker/)
- [feature-selection](/mapseekai/emap/examples/feature-selection/)

## Minimal snippet

```ts
map.once("moveend", (event) => console.log(event.center, event.zoom))
```
