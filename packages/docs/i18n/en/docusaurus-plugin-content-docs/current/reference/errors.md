---
slug: /reference/errors
title: Errors reference
---

# Errors reference

Operation errors are returned in `OpResult`. DuckDB errors carry a `kind` so applications can distinguish runtime setup, SQL validation, and operation failures.

## Behavior notes

Prefer user-facing recovery text near the triggering control and technical error text in logs.

## API

- [src.OpError](https://zwishing.github.io/emap/api/types/index.OpError.html)
- [src_duckdb.DuckDbOperationErrorKind](https://zwishing.github.io/emap/api/types/src_duckdb.DuckDbOperationErrorKind.html)

## Runnable examples

- [duckdb-query](https://zwishing.github.io/emap/examples/duckdb-query/)
- [check-geometry](https://zwishing.github.io/emap/examples/check-geometry/)

## Minimal snippet

```ts
if (!result.ok) console.error(result.error)
```
