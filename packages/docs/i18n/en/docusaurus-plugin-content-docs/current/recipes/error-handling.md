---
id: error-handling
slug: /recipes/error-handling
title: Error handling
api: ["Emap", "OpResult", "OpError"]
examples: ["check-geometry", "duckdb-buffer", "duckdb-query"]
stability: stable
verifiedVersion: 0.12.0
---

# Error handling

`Emap` data operations return `OpResult`; branch on `ok` to read a result or structured error.


```ts
const result = await map.ops.checkGeometry({ source: 'main' }); // run the operation
if (!result.ok) {
  // branch before reading the result
  switch (
    result.error.kind // narrow the structured error
  ) {
    case 'not-found': // missing source, layer, mask, divider, or field
      console.error(`Missing ${result.error.what}: ${result.error.id}`); // identify it
      break; // finish this error case
    case 'validation': // invalid operation input
      console.error(`${result.error.field}: ${result.error.reason}`); // show the field error
      break; // finish this error case
    default: // any other structured error
      console.error(result.error.kind); // report its kind
  }
} else {
  // successful operation
  console.log(result.value); // use the report
}
```

## Core methods


### `OpResult` shape

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ok` | `true \| false` | Required | Discriminant; read `value` when `true` and `error` when `false` |
| `value` | `T` | `undefined` for operations without a result | Successful operation result |
| `error` | `OpError` | — | Structured failure detail; branch on `kind` to narrow its type |

## More error details

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `error.kind` | `'not-found'` | Required | Source, layer, mask, divider, or field is missing; use `what` and `id` to identify it |
| `error.what` | `'source' \| 'layer' \| 'mask' \| 'divider' \| 'field'` | Required for `not-found` | Missing-resource category |
| `error.id` | `string` | Required for `not-found` | Missing-resource identifier |
| `error.kind` | `'validation'` | Required | Operation input failed validation |
| `error.field` | `string` | Required for `validation`; optional for `duckdb` | Associated option field |
| `error.reason` | `string` | Required for `validation` and `duckdb` | Human-readable failure detail |
| `error.kind` | `'expression-disabled'` | Required | Expression policy is disabled |
| `error.operation` | `string` | Required for `expression-disabled`, `duckdb`, and `stale-operation`; optional for `mapshaper` | Failed or stale operation name |
| `error.kind` | `'duckdb'` | Required | DuckDB operation failed |
| `error.duckDbKind` | `string` | Required for `duckdb` | DuckDB failure category |
| `error.cause` | `unknown` | Optional for `duckdb`; required for `mapshaper` | Original exception for diagnostics |
| `error.kind` | `'mapshaper'` | Required | mapshaper execution failed |
| `error.cmd` | `string` | Optional for `mapshaper` | Associated mapshaper command |
| `error.kind` | `'stale-operation'` | Required | Source changed while a queued operation waited |
| `error.sourceId` | `string` | Required for `stale-operation` | Changed source identifier |
| `error.kind` | `'host-removed'` | Required | Map was removed; no extra fields |

## Source load error event

`TopologySource.setData()` emits `error` and rejects with the same error when the current load fails. The event centralizes presentation; `await` stops follow-on loading.

```ts
source.on<{ error: unknown }>('error', ({ error }) => {
  console.error('Source import failed', error);
});

try {
  await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
} catch (error) {
  console.error('Keep the import UI open', error);
}
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `event.type` | `string` | — | `'error'` for a current load failure |
| `event.error` | `unknown` | Required | Original URL, parsing, format-plugin, or dataset-normalization error |

## Roll back a transaction

`map.beginTransaction()` and `transaction.rollback()` take no parameters. Rollback reverse-undos staged commands, restores initial source datasets and selection, and publishes state updates.

```ts
async function previewThenCancel(map: Emap) {
  const transaction = map.beginTransaction();
  try {
    const result = await map.ops.dropLayer({ source: 'main', target: 'draft' });
    if (!result.ok) {
      transaction.rollback();
      return result;
    }

    transaction.rollback();
    return result;
  } catch (error) {
    if (transaction.isOpen) transaction.rollback();
    throw error;
  }
}
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `map.beginTransaction()` arguments | `[]` | `[]` | Creates a transaction and starts command capture; one is active per map |
| `transaction.rollback()` arguments | `[]` | `[]` | Closes the transaction, restores initial data and selection, and reverse-undos staged commands |
| `transaction.rollback()` return value | `void` | — | Schedules rendering; emits `historychange`, `selectionchange` if selection changed, and sets `isOpen: false` |

## API

- `Emap`
- `OpResult`
- `OpError`

## Runnable examples

- [Geometry check](/mapseekai/emap/examples/check-geometry/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
- [DuckDB query](/mapseekai/emap/examples/duckdb-query/)
