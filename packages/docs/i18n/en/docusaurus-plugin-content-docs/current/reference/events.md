---
slug: /reference/events
title: Events reference
---

# Events reference

Common events include `move`, `moveend`, `zoom`, `zoomend`, `selectionchange`, `historychange`, `validationfailed`, `workerjobstart`, and `workerjobend`.

## Behavior notes

Known event names infer payloads. Unknown names remain available for application-level extension.

## API

- [src.EmapEventMap](https://zwishing.github.io/emap/api/interfaces/index.EmapEventMap.html)
- [src.EventListener](https://zwishing.github.io/emap/api/types/index.EventListener.html)

## Runnable examples

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [feature-selection](https://zwishing.github.io/emap/examples/feature-selection/)

## Minimal snippet

```ts
map.once("workerjobend", (event) => console.log(event.ok))
```
