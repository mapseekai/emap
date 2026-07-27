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

- [src.StatusControl](https://zwishing.github.io/emap/api/classes/index.StatusControl.html)
- [src.StatusOptions](https://zwishing.github.io/emap/api/interfaces/index.StatusOptions.html)

## Runnable examples

- [duckdb-query](https://zwishing.github.io/emap/examples/duckdb-query/)
- [web-worker](https://zwishing.github.io/emap/examples/web-worker/)
- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)

## Minimal snippet

```ts
map.addControl(new StatusControl({ text: "Ready" }), "bottom-left")
```
