---
id: error-handling
slug: /recipes/error-handling
title: Error handling
api: ["Emap", "OpResult", "OpError"]
examples: ["check-geometry", "duckdb-buffer", "duckdb-query"]
stability: stable
verifiedVersion: unreleased
---

# Error handling

`Emap` data operations return an `OpResult`: successful results have `ok: true`; failed results have `ok: false` and a discriminated `OpError`. Branch on `ok` and do not continue with a failed result as if it succeeded.

## Handle an operation result

```ts
const result = await map.ops.checkGeometry({ source: "main" })
if (!result.ok) {
  switch (result.error.kind) {
    case "not-found":
      console.error(`Missing ${result.error.what}: ${result.error.id}`)
      break
    case "validation":
      console.error(result.error.reason)
      break
    default:
      console.error(result.error.kind)
  }
}
```

On success, `checkGeometry` returns its geometry-check report in `value`. Handle rejected loader promises and `DuckDbOperationError` exceptions from DuckDB at an application boundary with `try`/`catch`. Update layers, history, and UI state only after an operation succeeds.

## API

- `Emap`
- `OpResult`
- `OpError`

## Runnable examples

- [Geometry check](/mapseekai/emap/examples/check-geometry/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
- [DuckDB query](/mapseekai/emap/examples/duckdb-query/)