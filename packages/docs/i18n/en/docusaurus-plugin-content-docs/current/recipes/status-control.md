---
id: status-control
slug: /recipes/status-control
title: Status control
api: ["Emap"]
examples: ["duckdb-geoparquet-query","duckdb-query"]
stability: stable
verifiedVersion: 0.5.0
---

# Status control

Use a status area for async load, unsupported optional dependencies, worker progress, and operation errors.

## Behavior notes

Status UI should distinguish loading, success, warning, and error states; keep the underlying operation error available for logs or diagnostics.

## API

- [src.StatusControl](/emap/api/classes/index.StatusControl.html)
- [src.StatusOptions](/emap/api/interfaces/index.StatusOptions.html)

## Runnable examples

- [duckdb-query](/emap/examples/duckdb-query/)
- [web-worker](/emap/examples/web-worker/)
- [geoparquet-viewer](/emap/examples/geoparquet-viewer/)

## Minimal snippet

```ts
map.addControl(new StatusControl({ text: "Ready" }), "bottom-left")
```
