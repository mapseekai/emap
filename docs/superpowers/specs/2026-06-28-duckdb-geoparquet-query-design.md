# DuckDB GeoParquet Query Design

## Context

`@zwishing/emap/duckdb` now supports DuckDB-Wasm geometry operations, attribute
operations, relation operations, and restricted `SELECT` queries over an
existing map layer. The restricted query helper accepts a logical `input` table,
validates the SQL conservatively, rewrites it to an internal DuckDB table, and
returns a `MapshaperDataset`.

The next DuckDB integration step is file-backed input. The first batch focuses
on GeoParquet bytes or file contents because the project already has GeoParquet
export/import code, Arrow table conversion, and DuckDB-Wasm in place. Remote
URLs, File System Access handles, non-geometry result tables, and arbitrary SQL
are intentionally left for later batches.

## Goals

- Add a reusable helper that queries GeoParquet bytes through DuckDB-Wasm.
- Register GeoParquet bytes with DuckDB's virtual filesystem so DuckDB reads
  the parquet file directly.
- Keep the public SQL contract as restricted `SELECT ... FROM input ...`.
- Require query results to include a detectable geometry column.
- Convert DuckDB Arrow results directly to `MapshaperDataset`.
- Add map-op integration so host applications can wire GeoParquet query output
  into the existing source/output flow.
- Keep the API shape compatible with later URL, Arrow, or structured source
  descriptors.

## Non-Goals

- Do not support remote URL parquet input in this batch.
- Do not support File System Access handles in this batch.
- Do not support arbitrary `read_parquet(...)` in user SQL.
- Do not support joins, CTEs, multiple tables, DDL, DML, `COPY`, `ATTACH`,
  `INSTALL`, `LOAD`, or multiple statements.
- Do not preserve original geometry automatically when the SQL projection omits
  the geometry column.
- Do not produce attribute-only datasets or summary tables.
- Do not add a SQL editor UI.

## API Surface

### GeoParquet Query Helper

```ts
queryGeoParquetWithDuckDb(
  data,
  {
    sql: "SELECT geometry, name FROM input WHERE kind = 'road'",
    geometryColumn?: 'geometry',
    layerName?: 'roads',
    noTopology?: false,
  },
  runtime?,
)
```

The helper accepts `Uint8Array | ArrayBuffer`, validates SQL against the same
logical `input` contract as existing DuckDB queries, and returns
`Promise<MapshaperDataset>`.

The query result must contain a geometry column that `fromArrowTable()` can
detect through GeoParquet metadata, GeoArrow extension metadata, or a WKB-like
binary column name. If no geometry column is detectable, the helper fails with a
conversion error.

### Map-Op Integration

```ts
duckDbGeoParquetQueryLayer(ctx, {
  src: 'uploaded-geoparquet',
  sql: "SELECT geometry, name FROM input WHERE kind = 'road'",
  output: { sourceId: 'roads' },
  geometryColumn?: 'geometry',
  layerName?: 'roads',
  noTopology?: false,
  runtime?,
})
```

The map operation resolves GeoParquet bytes from a source, calls the helper,
writes the resulting dataset to `output.sourceId`, and returns the existing
`OpResult` shape.

The source boundary should be narrow in the first batch: a GeoParquet source
must expose a byte accessor such as `getBytes()` returning
`Uint8Array | ArrayBuffer | null | undefined`. Dataset-only sources remain
valid for existing DuckDB map operations, but `duckDbGeoParquetQueryLayer()`
requires bytes. General source descriptors, URLs, and file handles remain
future extensions.

## Architecture

Add a separate GeoParquet query path under `src/duckdb` rather than folding
file-backed input into `queryDatasetWithDuckDb()`:

- `duckdb-runtime.ts` extends the runtime abstraction with virtual file support
  for `registerFileBuffer(name, bytes)`. The DuckDB-Wasm runtime implements it
  by delegating to the underlying database object.
- `duckdb-geoparquet-query-op.ts` owns parquet file registration, temporary
  view creation, SQL validation, query execution, Arrow result conversion,
  cleanup, and error wrapping.
- `duckdb-query-sql.ts` keeps owning restricted `SELECT` validation and rewrite.
  The GeoParquet helper reuses it by presenting a logical `input` table and
  rewriting that table to an internal view.
- `map-op.ts` adds the GeoParquet query map-op option/result types and a
  wrapper that handles source byte lookup, output dataset writes, and
  `OpResult` conversion.
- `index.ts` exports the new helper and map-op types through the existing
  DuckDB public entrypoint.

The first implementation should prefer the existing `fromArrowTable()` result
conversion instead of custom row reconstruction. Unlike dataset-backed queries,
GeoParquet-backed queries do not need an internal row id because the SQL result
itself is expected to carry geometry.

## Data Flow

1. The caller passes GeoParquet bytes and SQL.
2. The helper normalizes `ArrayBuffer` input to `Uint8Array`.
3. The helper generates a unique internal parquet filename, for example
   `emap_geoparquet_query_1.parquet`.
4. The runtime registers those bytes with DuckDB's virtual filesystem.
5. The helper opens a DuckDB connection.
6. The helper creates a temporary view that binds the logical source to the
   registered file, for example:

   ```sql
   CREATE VIEW "emap_geoparquet_query_input_1" AS
   SELECT * FROM read_parquet('emap_geoparquet_query_1.parquet')
   ```

7. The helper discovers available columns from the view schema and passes the
   user SQL to `validateDuckDbSelectSql()`.
8. The validator accepts only restricted single-table `SELECT` SQL from logical
   `input` and rewrites it to the internal view name.
9. DuckDB executes the validated SQL and returns an Arrow table.
10. `fromArrowTable()` converts the result Arrow table into a `MapshaperDataset`.
11. `finally` drops the temporary view, closes the connection, and removes the
    virtual file if DuckDB-Wasm exposes a file removal API. If file removal is
    unavailable, unique filenames prevent collisions.

## SQL Contract

Allowed first-batch shape:

```sql
SELECT geometry, <attributes>
FROM input
WHERE <predicate>
ORDER BY <attribute>
LIMIT <n>
```

The validator should remain conservative. A valid DuckDB query can be rejected
if the first implementation cannot prove that it is a single-table read-only
query over logical `input`.

The validator must reject:

- SQL that omits `FROM input`.
- SQL that references `read_parquet(...)` directly.
- Multiple statements.
- `JOIN`, CTEs, unions, or any second table reference.
- `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `ALTER`, `DROP`, `COPY`,
  `ATTACH`, `DETACH`, `INSTALL`, `LOAD`, `EXPORT`, `IMPORT`, `CALL`, and
  `PRAGMA`.

## Error Handling

Use `DuckDbOperationError` consistently:

- `runtime-unavailable`: no runtime is available, or the runtime cannot support
  GeoParquet byte registration.
- `validation`: SQL violates the restricted query contract, the GeoParquet
  source is missing, the source is not bytes, or `output.sourceId` is missing.
- `query-failed`: DuckDB cannot register/read the parquet file, create the
  view, describe the view, or execute the query.
- `conversion-failed`: DuckDB returns Arrow successfully but `fromArrowTable()`
  cannot find or convert a geometry column.

Cleanup follows the existing DuckDB query rule: do not replace the primary
runtime, validation, query, or conversion error. If the operation otherwise
succeeds and cleanup fails, report a cleanup error.

Map-op integration continues to convert validation errors to `Err.validation()`
and other DuckDB failures through the existing DuckDB map-op error adapter.

## Testing Strategy

### SQL and Contract Unit Tests

Cover accepted queries:

- `SELECT * FROM input`
- `SELECT geometry, name FROM input WHERE kind = 'road'`
- multiline and uppercase keyword formatting
- `ORDER BY`
- `LIMIT`

Cover rejected queries:

- direct `read_parquet(...)`
- multiple statements
- joins, CTEs, unions, and non-`input` table names
- mutating or side-effecting keywords
- queries without `FROM input`

### Helper Unit Tests

Use fake DuckDB runtime tests to cover:

- bytes normalization
- file registration
- view creation
- schema discovery before validation
- validated query execution
- Arrow result conversion call shape
- cleanup order for success and failure
- runtime, validation, query, conversion, and cleanup error mapping

### DuckDB-Wasm Integration Tests

Use real DuckDB-Wasm coverage for:

- exporting a small dataset to GeoParquet bytes with `exportGeoParquet()`
- querying those bytes through DuckDB's parquet reader
- `WHERE` filtering
- attribute projection with geometry included
- `ORDER BY` and `LIMIT`
- output layer name
- geometry count and record values
- missing geometry projection failing as a conversion error
- direct `read_parquet(...)` blocked before DuckDB execution

### Map-Op Tests

Cover:

- successful output source write
- missing source as `not-found`
- non-byte source as `validation`
- missing `output.sourceId` as `validation`
- SQL validation errors as `OpResult`
- helper failures as `OpResult`

### Verification Commands

Run these before completing implementation:

- `npm run test:duckdb`
- focused DuckDB query and map-op tests
- `npm run typecheck`
- `npm run build`
- `npm run format:check`

## Future Extensions

- URL-backed GeoParquet sources using DuckDB-Wasm `registerFileURL`.
- File System Access handles using DuckDB-Wasm file handle registration.
- In-memory Arrow or GeoArrow source descriptors.
- Attribute-only query outputs for aggregations and summaries.
- Structured query builder input that generates the restricted SQL contract.
- Spatial SQL result support when geometry expression handling is designed
  separately.
