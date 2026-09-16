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

Map-processing methods return `OpResult<T>`; branch on `ok` and `error.kind`.

```ts
const result = await map.ops.checkGeometry({ source: "parcels" }) // Run a map operation
if (!result.ok) { // Branch on error.kind on failure
  if (result.error.kind === "validation") {
    console.error(result.error.field, result.error.reason) // Display the field to fix
  }
  return // Leave the success path
}
console.log(result.value) // Use the successful value
```

## Core error handling

| `kind` | Fields | Description |
| --- | --- | --- |
| `not-found` | `what`, `id` | Target not found. |
| `validation` | `field`, `reason` | Option, field, or geometry validation failed. |
| `expression-disabled` | `operation` | Disabled policy rejected a JavaScript expression. |
| `duckdb` | `operation`, `duckDbKind`, `reason`, `field?`, `cause?` | DuckDB operation exception. |
| `mapshaper` | `cause`, `cmd?`, `operation?` | mapshaper, Worker, or commit exception. |
| `stale-operation` | `sourceId`, `operation` | Source or transaction changed during async work. |
| `host-removed` | — | Operation or commit during map removal. |

Successful results carry `value`; failed results carry `error`. `OK` is the valueless success result; `okValue(value)` creates one with a value.

## More error construction

### `Err` constructor parameters

| Constructor | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `notFound` | `what`, `id` | `'source' \| 'layer' \| 'mask' \| 'divider' \| 'field'`, `string` | Required | Missing-target category and requested identifier. |
| `validation` | `field`, `reason` | `string`, `string` | Required | Option or field to correct and presentable reason. |
| `expressionDisabled` | `operation` | `string` | Required | Policy-gated operation name. |
| `duckdb` | `operation`, `duckDbKind`, `reason` | `string` | Required | DuckDB-invoking operation, failure category, and error message. |
| `duckdb` | `opts.field`, `opts.cause` | `{ field?: string; cause?: unknown }` | `undefined` | Optional input field and original exception. |
| `mapshaper` | `cause` | `unknown` | Required | mapshaper, Worker, or commit exception. |
| `mapshaper` | `opts.cmd`, `opts.operation` | `{ cmd?: string; operation?: string }` | `undefined` | Optional command text and API operation name. |
| `staleOperation` | `sourceId`, `operation` | `string`, `string` | Required | Changed source and pending operation. |
| `hostRemoved` | — | — | — | Creates a `host-removed` result. |

`Err` creates uniform failure shapes for internal operations and extensions; applications usually consume `OpResult`.

## More loading and DuckDB errors

### Source loading diagnostics

`SourceLoadError(code, diagnostics)` uses the first diagnostic message. Preflight returns diagnostics; `addSource()` and `confirmSource()` throw terminal conditions as this error.

| `code` | Trigger | Description |
| --- | --- | --- |
| `source-crs-required` | Input and metadata lack a CRS | Submit `SourceLoadAnswers.sourceCrs`, then preflight again. |
| `source-crs-invalid` | Empty or invalid `sourceCrs` | Diagnostics identify CRS corrections. |
| `source-crs-overrides-metadata` | Explicit CRS overrides or metadata CRS needs confirmation | Warning includes the effective CRS. |
| `source-id-conflict` | Source `id` is registered or pending | Choose a new `id` or wait. |
| `source-load-cancelled` | Map, AbortSignal, or pending task cancelled | Import cancelled. |
| `source-load-rejected` | Parsing, source contract, dataset, or CRS mismatch | Diagnostics identify the failure. |
| `source-plan-invalid` | Plan is invalid, cross-map, or consumed | Preflight again. |
| `source-plan-stale` | Source or map CRS changed after preflight | Preflight current data again. |

`SourceLoadDiagnostic` contains code, severity, and optional CRS values. Requests provide data through `id` and exactly one of `source` or `input`.

### Import resource limits

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `resourceLimits.maxInputBytes` | `number` | 2 GiB | Raw-input limit. |
| `zipLimits.maxCompressedBytes` | `number` | 2 GiB | Compressed ZIP-input limit. |
| `zipLimits.maxBytes` | `number` | 2 GiB | Extracted ZIP-byte limit. |
| `zipLimits.maxEntries` | `number` | 5000 | ZIP-entry limit. |
| `zipLimits.maxRatio` | `number` | 100 | Extraction-ratio limit; protects against ZIP bombs. |

### Expression and Worker controls

| API / Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `MapOptions.expressionPolicy`, `Emap.setExpressionPolicy(policy)` | `'disabled' \| 'trusted'` | `'disabled'` | Expression policy. |
| `MapOptions.useWorker` | `boolean \| 'auto'` | `false` | Worker routing. |
| `MapOptions.workerThreshold` | `number` | `50000` | `'auto'` vertex threshold. |
| `MapOptions.workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL. |
| `MapOptions.workerPoolSize` | `number` | `1` | Worker-pool slots. |
| `MapshaperWorkerPoolOptions.jobTimeoutMs` | `number` | `120000` ms | Request timeout, finite non-negative. |

Workers correlate responses by request `id`, message `type`, and slot `epoch`; late responses are ignored. `workerUrl` must use the page bundle's release.

### DuckDB failure kinds

Map operations convert `DuckDbOperationError` into `OpError` `duckdb`.

| `kind` | Trigger | Description |
| --- | --- | --- |
| `validation` | Invalid SQL or operation precondition | `field` identifies the parameter. |
| `runtime-unavailable` | DuckDB runtime missing or incomplete | Initialize the required runtime and retry. |
| `spatial-extension-unavailable` | Spatial extension failed to load | Check extension or runtime. |
| `query-failed` | SQL or connection operation failed | `message` and `cause` diagnose it. |
| `conversion-failed` | Dataset/Arrow conversion failed | Check geometry and field types. |

## More validator reports

Matching validators run in parallel after commit; any `ok: false` emits `validationfailed` with results and label.

| API | Parameter / field | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `ValidatorRegistry.register` | `v` | `Validator` | Required | Registers a validator and returns an idempotent unregister callback; separate same-name objects can register independently. |
| `ValidatorRegistry.runFor` | `phase` | `ValidatorPhase` | Required | Currently `'after-commit'`; runs after each commit. |
| `ValidatorRegistry.runFor` | `host`, `change` | `EmapHostInternal`, `ValidationChange` | Required | `host` supplies data access; `change.label` is the just-committed history-command label. |
| `Validator` | `name`, `phase`, `run(host, change)` | `string`, `'after-commit'`, `Promise<ValidationReport>` | Required | `name` appears in event results; `run` returns the diagnostic report. |
| `ValidationIssue` | `severity`, `message`, `ref?` | `'error' \| 'warning'`, `string`, `FeatureRef` | `ref` is `undefined` | `ref` lets a UI highlight the offending feature. |
| `ValidationReport` | `ok`, `issues` | `boolean`, `ValidationIssue[]` | Required | `ok` is `true` when `issues` is empty or contains warnings only. |
| `ValidatorResult` | `validator`, `report` | `string`, `ValidationReport` | Required | One completed validator result in the event. |

Validator exceptions become `severity: 'error'` issues.

### `topologyValidator` parameters

`topologyValidator(opts = {})` checks arc self-intersections after commit and creates one issue per affected source.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | `string[]` | Every registered source | Source IDs to scan. |
| `tolerance` | `number` | `undefined` | Intersection tolerance. |
| `severity` | `'error' \| 'warning'` | `'error'` | Issue severity. |

## API

- [src.OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)
- [src_duckdb.DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## Runnable examples

- [check-geometry](/mapseekai/emap/examples/check-geometry/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [transaction](/mapseekai/emap/examples/transaction/)
