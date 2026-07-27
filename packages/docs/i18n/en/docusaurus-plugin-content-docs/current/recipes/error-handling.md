---
id: error-handling
slug: /recipes/error-handling
title: Error handling
api: ["Emap"]
examples: ["duckdb-buffer","duckdb-query"]
stability: stable
verifiedVersion: 0.5.0
---

# Error handling

Loaders reject on import errors, operations return `OpResult`, and DuckDB helpers can throw `DuckDbOperationError` with typed `kind` values.

## Behavior notes

Handle errors at app boundaries: keep the map alive, show retry instructions, and do not commit failed operation output to history.

## API

- [src.OpError](https://zwishing.github.io/emap/api/types/index.OpError.html)
- [src_duckdb.DuckDbOperationError](https://zwishing.github.io/emap/api/classes/src_duckdb.DuckDbOperationError.html)

## Runnable examples

- [check-geometry](https://zwishing.github.io/emap/examples/check-geometry/)
- [duckdb-query](https://zwishing.github.io/emap/examples/duckdb-query/)
- [duckdb-buffer](https://zwishing.github.io/emap/examples/duckdb-buffer/)

## Minimal snippet

```ts
const result = await map.ops.checkGeometry({ source: "main" })
if (!result.ok) setStatus(result.error.message)
```
