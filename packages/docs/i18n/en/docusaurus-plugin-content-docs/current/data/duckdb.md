---
slug: /data/duckdb
title: DuckDB
---

# DuckDB

The optional DuckDB entry runs SQL and spatial operations in DuckDB-Wasm. Load it lazily so core maps do not pay the optional dependency cost.

## Behavior notes

Helpers validate restricted SELECT SQL, normalize operation options, preserve CRS metadata when possible, and return operation-layer results for map display.

## API

- [src_duckdb.queryDatasetWithDuckDb](https://zwishing.github.io/emap/api/functions/src_duckdb.queryDatasetWithDuckDb.html)
- [src_duckdb.bufferDatasetWithDuckDb](https://zwishing.github.io/emap/api/functions/src_duckdb.bufferDatasetWithDuckDb.html)
- [src_duckdb.DuckDbOperationError](https://zwishing.github.io/emap/api/classes/src_duckdb.DuckDbOperationError.html)

## Runnable examples

- [duckdb-query](https://zwishing.github.io/emap/examples/duckdb-query/)
- [duckdb-buffer](https://zwishing.github.io/emap/examples/duckdb-buffer/)
- [duckdb-spatial-ops](https://zwishing.github.io/emap/examples/duckdb-spatial-ops/)

## Minimal snippet

```ts
const duckdb = await import("@zwishing/emap/duckdb")
const result = await duckdb.queryDatasetWithDuckDb({ runtime, source, sql })
```
