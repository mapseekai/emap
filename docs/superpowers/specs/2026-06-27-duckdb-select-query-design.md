# DuckDB Restricted SELECT Query Design

## Context

`@zwishing/emap/duckdb` already supports DuckDB-Wasm geometry operations,
attribute operations, two-layer relation operations, map-op integration, and a
browser example. Those APIs use constrained named operations and return
Mapshaper datasets.

The next DuckDB integration step is a read-only query layer. It should let a
caller run a restricted SQL `SELECT` against an existing map layer, produce a
new layer, and preserve the original geometry for rows selected by the query.
External Parquet, GeoParquet, and Arrow sources are a future extension point,
but the first implementation centers on querying current Mapshaper datasets.

## Goals

- Add a reusable DuckDB query core for a single existing dataset layer.
- Allow restricted, read-only `SELECT` SQL over a logical `input` table.
- Preserve original input geometry in query output.
- Allow attribute projection, filtering, ordering, and limiting.
- Reuse existing DuckDB runtime, Arrow, WKB, and Mapshaper conversion patterns.
- Add map-op integration for host applications.
- Keep the API shape compatible with future file-backed DuckDB sources.

## Non-Goals

- Do not implement a SQL editor UI in the browser example.
- Do not implement external Parquet, GeoParquet, Arrow, or URL input in this
  first batch.
- Do not support joins, multiple tables, CTEs, DDL, DML, `COPY`, `ATTACH`,
  `INSTALL`, `LOAD`, or multiple statements.
- Do not support calculated output geometry.
- Do not expose arbitrary DuckDB SQL against caller-controlled table names.

## API Surface

### Dataset Query Helper

```ts
queryDatasetWithDuckDb(dataset, {
  sql: 'SELECT name, population FROM input WHERE population > 100000 LIMIT 50',
  inputLayer?: string,
  geometryColumn?: string,
  rowIdColumn?: string,
}, runtime?)
```

The helper returns `Promise<MapshaperDataset>`. The output dataset uses original
input geometry selected by row id. Output records come from SQL result columns
after removing the internal row id column.

### SQL Validation Helper

```ts
validateDuckDbSelectSql(sql, {
  inputTableName?: 'input',
  rowIdColumn?: '__emap_rowid',
})
```

The helper validates and normalizes the restricted query contract. It rejects
queries that are not a single read-only `SELECT` from the logical `input` table.

### Map-Op Integration

```ts
duckDbQueryLayer(ctx, {
  sourceId: 'parcels',
  layer?: 'parcels',
  sql: "SELECT owner, landuse FROM input WHERE landuse = 'park'",
  output: { sourceId: 'parks' },
})
```

The map-op resolves the input source through the existing source context, runs
the dataset query helper, writes the output source dataset, and returns the
existing `OpResult` shape.

## Architecture

Add a narrow query layer under `src/duckdb`:

- `duckdb-query-op.ts` owns dataset to DuckDB table conversion, runtime
  lifecycle, SQL execution, row-id based geometry reconstruction, output dataset
  creation, cleanup, and error wrapping.
- `duckdb-query-sql.ts` or the existing `duckdb-sql.ts` owns restricted SELECT
  validation and SQL wrapping.
- `map-op.ts` gains `duckDbQueryLayer()`.
- `index.ts` exports the dataset helper, validation helper, and map-op types.

The implementation should follow existing DuckDB operation boundaries:

- Public APIs accept a named dataset or map-op source, not raw DuckDB table
  names.
- Runtime setup and cleanup mirror existing DuckDB operations, but the first
  query batch does not require `runtime.ensureSpatial()` because output
  geometry is copied from input rows rather than computed by DuckDB spatial
  functions.
- SQL validation happens before DuckDB execution.
- Query output geometry is never taken from SQL expressions.

## Data Flow

1. Read the requested input dataset layer.
2. Convert that layer to an Arrow table with WKB geometry and attributes.
3. Add an internal row id column, defaulting to `__emap_rowid`.
4. Register the Arrow table in DuckDB under a generated temporary table name.
5. Validate the user SQL against the restricted SELECT contract.
6. Rewrite the logical `input` table reference to the generated temporary table.
7. Ensure the final query returns the internal row id column.
8. Execute the query.
9. Convert the DuckDB Arrow result into output records.
10. Use returned row ids to copy original input geometry into the output layer.
11. Remove the internal row id from output records.
12. Preserve input CRS metadata on the output dataset.
13. Drop the temporary table and close the connection in `finally`.

Cleanup failures must not replace the primary runtime, validation, query, or
conversion error.

## SQL Contract

Allowed first-batch shape:

```sql
SELECT <attributes>
FROM input
WHERE <predicate>
ORDER BY <attribute>
LIMIT <n>
```

The validator must accept common formatting differences, including uppercase
keywords and newlines.

The validator must reject:

- Multiple statements or semicolon-separated SQL.
- `JOIN`, CTEs, subqueries referencing other tables, or any table other than
  `input`.
- `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `ALTER`, `DROP`, `COPY`,
  `ATTACH`, `DETACH`, `INSTALL`, `LOAD`, `EXPORT`, `IMPORT`, `CALL`, and
  `PRAGMA`.
- SQL that omits `FROM input`.
- SQL that attempts to produce calculated geometry as output geometry.

The validator can be conservative. If a valid DuckDB query is too hard to prove
safe with the first implementation, it should return a validation error.

## Error Handling

Use `DuckDbOperationError` consistently:

- `validation`: SQL violates the restricted contract, the input layer is
  invalid, the output source id is missing, or the row id column conflicts in an
  unsupported way.
- `runtime-unavailable`: no DuckDB runtime is available.
- `query-failed`: DuckDB execution fails.
- `conversion-failed`: Arrow or result conversion fails.

Map-op integration converts these errors through the existing DuckDB map-op
error adapter.

## Testing Strategy

### SQL Validator Unit Tests

Cover allowed queries:

- `SELECT * FROM input`
- `SELECT name FROM input WHERE population > 100`
- queries with `ORDER BY`
- queries with `LIMIT`
- uppercase keywords and multiline formatting

Cover rejected queries:

- multiple statements
- `JOIN`
- non-`input` table names
- mutating or side-effect keywords
- subqueries referencing other tables
- queries without `FROM input`

### Query Core Unit Tests

Use fake DuckDB runtime tests to cover:

- lifecycle order: `connect -> insert -> query -> drop -> close`
- automatic row id inclusion
- row-id based geometry reconstruction
- output records omit the internal row id
- CRS metadata preservation
- cleanup failure handling
- runtime, query, and conversion error mapping

### DuckDB-Wasm Integration Tests

Use real DuckDB-Wasm coverage for:

- `WHERE` filtering
- attribute projection
- `ORDER BY` and `LIMIT`
- string, number, and boolean roundtrips
- row id mapping after ordering and limiting
- illegal SQL blocked before DuckDB execution

### Map-Op Tests

Cover:

- successful output source write
- missing input source as `not-found`
- missing output source id as `validation`
- SQL validation errors as `OpResult`
- query failures as `OpResult`

## Implementation Order

1. SQL validation helper and tests.
2. Query core fake-runtime tests.
3. Query core implementation.
4. DuckDB-Wasm integration tests.
5. Map-op tests and implementation.
6. Barrel exports and README examples.
7. Full verification with formatter, typecheck, build, unit tests, and DuckDB
   integration tests.

## Acceptance Criteria

- A caller can query an existing dataset layer with restricted `SELECT` SQL.
- Output geometry always comes from the original input rows.
- Output records reflect selected SQL columns and do not expose the internal row
  id.
- Unsafe SQL is rejected before DuckDB execution.
- Map-op integration can write query results as a new source.
- Tests cover validator, fake runtime, real DuckDB-Wasm, and map-op behavior.
