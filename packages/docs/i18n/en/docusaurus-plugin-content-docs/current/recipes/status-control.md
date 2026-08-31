---
id: status-control
slug: /recipes/status-control
title: Status control
api: ["Emap"]
examples: ["duckdb-geoparquet-query","duckdb-query"]
stability: stable
verifiedVersion: 0.8.1
---

# Status control

Use a status area for async load, unsupported optional dependencies, worker progress, and operation errors.

## Behavior notes

Status UI should distinguish loading, success, warning, and error states; keep the underlying operation error available for logs or diagnostics.

## API

- [src.StatusControl](/mapseekai/emap/api/classes/emap.StatusControl.html)
- [src.StatusOptions](/mapseekai/emap/api/interfaces/emap.StatusOptions.html)

## Runnable examples

- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)

## Minimal snippet

```ts
map.addControl(new StatusControl({ showMousePos: true, showEPSG: true }), "bottom-left")
```
