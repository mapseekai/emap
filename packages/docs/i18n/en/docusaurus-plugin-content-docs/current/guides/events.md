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

emap uses `EventDispatcher` for engine signals. Camera, pointer, feature, history, validation, and worker events use typed payloads where the public map surface knows them.

## Behavior notes

Use `on`, `off`, and `once`. Feature events can be filtered by layer; custom app events remain possible through the generic event escape hatch.

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.EmapEventMap](https://zwishing.github.io/emap/api/interfaces/index.EmapEventMap.html)

## Runnable examples

- [feature-attributes](https://zwishing.github.io/emap/examples/feature-attributes/)
- [transaction](https://zwishing.github.io/emap/examples/transaction/)
- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)

## Minimal snippet

```ts
map.on("moveend", (event) => console.log(event.center, event.zoom))
map.on("feature:click", { layers: ["district-fill"] }, (event) => console.log(event.ref))
```
