---
id: errors
slug: /reference/errors
title: Errors reference
api: ["Emap","Err","OK","okValue","OpError","OpResult","topologyValidator","TopologyValidatorOptions","ValidationChange","ValidationIssue","ValidationReport","Validator","ValidatorPhase","ValidatorRegistry","ValidatorResult"]
examples: ["check-geometry","transaction"]
stability: stable
verifiedVersion: 0.5.0
---

# Errors reference

Operation errors are returned in `OpResult`. DuckDB errors carry a `kind` so applications can distinguish runtime setup, SQL validation, and operation failures.

## Behavior notes

Prefer user-facing recovery text near the triggering control and technical error text in logs.

## API

- [src.OpError](/emap/api/types/index.OpError.html)
- [src_duckdb.DuckDbOperationErrorKind](/emap/api/types/src_duckdb.DuckDbOperationErrorKind.html)

## Runnable examples

- [duckdb-query](/emap/examples/duckdb-query/)
- [check-geometry](/emap/examples/check-geometry/)

## Minimal snippet

```ts
if (!result.ok) console.error(result.error)
```
