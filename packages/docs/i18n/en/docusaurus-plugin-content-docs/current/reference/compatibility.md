---
slug: /reference/compatibility
title: Compatibility
---

# Compatibility

emap is browser-first and requires a sized DOM container, Canvas, and modern module tooling. Optional formats and DuckDB features require their WASM dependencies.

## Behavior notes

Worker builds must serve `emap-worker.js` and mapshaper vendor assets from URLs reachable by the page.

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.MapshaperWorkerPool](https://zwishing.github.io/emap/api/classes/index.MapshaperWorkerPool.html)

## Runnable examples

- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)

## Minimal snippet

```ts
import "@zwishing/emap/style.css"
new Emap({ container: "map", workerUrl: "/dist/emap-worker.js" })
```
