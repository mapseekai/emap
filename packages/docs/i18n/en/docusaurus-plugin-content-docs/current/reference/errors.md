---
id: errors
slug: /reference/errors
title: Errors reference
api: ["Emap", "Err", "OK", "okValue", "OpError", "OpResult", "topologyValidator", "TopologyValidatorOptions", "ValidationChange", "ValidationIssue", "ValidationReport", "Validator", "ValidatorPhase", "ValidatorRegistry", "ValidatorResult", "SourceLoadError", "DuckDbOperationError", "DuckDbOperationErrorKind"]
examples: ["check-geometry","duckdb-query","transaction"]
stability: stable
verifiedVersion: 0.12.0
---

# Errors reference

Map-processing methods return `OpResult<T>` for recoverable failures: a successful result is `{ ok: true, value }`; a failed result is `{ ok: false, error }`. Discriminate on `ok`, then handle a failure by `error.kind`.

```ts
const result = await map.ops.checkGeometry({ source: "parcels" })
if (!result.ok) {
  if (result.error.kind === "validation") {
    console.error(result.error.field, result.error.reason)
  }
  return
}
console.log(result.value)
```

## `OpError` failure shapes

| `kind` | Fields | Meaning |
| --- | --- | --- |
| `not-found` | `what`, `id` | A source, layer, mask, divider, or field is absent |
| `validation` | `field`, `reason` | An option or field fails validation |
| `expression-disabled` | `operation` | The expression policy rejects the operation |
| `duckdb` | `operation`, `duckDbKind`, `reason`, `field?`, `cause?` | A DuckDB operation fails |
| `mapshaper` | `cause`, `cmd?`, `operation?` | A Mapshaper operation fails |
| `stale-operation` | `sourceId`, `operation` | The source changed while an operation was pending |
| `host-removed` | no fields | The map host has been removed |

`OK` is the successful result without a payload; `okValue(value)` creates a successful result with one. `Err` provides constructors for the failure shapes in the table.

## Loading and DuckDB errors

`SourceLoadError` provides `code` and `diagnostics` for source-preflight and loading diagnostics. `DuckDbOperationError` provides `kind`, an error message, and optional `field` and `cause`. Its `kind` is `validation`, `runtime-unavailable`, `spatial-extension-unavailable`, `query-failed`, or `conversion-failed`.

Place recovery guidance for users near the action that caused the error, and write raw errors and `cause` to logs.

## API

- [src.OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)
- [src_duckdb.DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## Runnable examples

- [check-geometry](/mapseekai/emap/examples/check-geometry/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [transaction](/mapseekai/emap/examples/transaction/)
