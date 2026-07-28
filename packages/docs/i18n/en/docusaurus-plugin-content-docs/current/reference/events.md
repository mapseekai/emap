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

- [src.EmapEventMap](/emap/api/interfaces/index.EmapEventMap.html)
- [src.EventListener](/emap/api/types/index.EventListener.html)

## Runnable examples

- [web-worker](/emap/examples/web-worker/)
- [feature-selection](/emap/examples/feature-selection/)

## Minimal snippet

```ts
map.once("moveend", (event) => console.log(event.center, event.zoom))
```
