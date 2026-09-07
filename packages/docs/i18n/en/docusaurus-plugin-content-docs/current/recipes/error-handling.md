---
id: error-handling
slug: /recipes/error-handling
title: Error handling
api: ["Emap"]
examples: ["duckdb-buffer","duckdb-query"]
stability: stable
verifiedVersion: 0.8.1
---

# Error handling

Loaders reject on import errors, operations return `OpResult`, and DuckDB helpers can throw `DuckDbOperationError` with typed `kind` values.

## Behavior notes

Handle errors at app boundaries: keep the map alive, show retry instructions, and do not commit failed operation output to history.

## API

- [src.OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [src_duckdb.DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## Runnable examples

- [check-geometry](/mapseekai/emap/examples/check-geometry/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [duckdb-buffer](/mapseekai/emap/examples/duckdb-buffer/)

## Minimal snippet

```ts
const result = await map.ops.checkGeometry({ source: "main" })
if (!result.ok) setStatus(result.error.kind)
```
