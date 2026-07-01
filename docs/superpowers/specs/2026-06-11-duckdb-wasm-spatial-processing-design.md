# DuckDB-Wasm Spatial Processing Design

Date: 2026-06-11

## Purpose

Add an optional DuckDB-Wasm processing module that can run spatial operations on
emap datasets, starting with a complete buffer workflow. The module should use
the existing GeoArrow conversion path for data exchange, keep DuckDB-Wasm out of
the main bundle, and provide a map operation adapter that can display results
as a dataset/source.

## Goals

- Provide an optional `@zwishing/emap/duckdb` entry point.
- Support a core `dataset -> dataset` processing API independent of `Map`.
- Support a map operation wrapper for processing a source and displaying the
  result.
- Use DuckDB-Wasm plus the spatial extension for the first operation.
- Implement `buffer` as the first end-to-end operation.
- Keep arbitrary public SQL and automatic reprojection out of v1.

## Non-Goals

- No UI controls in v1.
- No public arbitrary SQL API in v1.
- No automatic CRS reprojection in v1.
- No multi-layer joins or persistent DuckDB database state in v1.
- No streaming or chunked processing in v1.

## Recommended Approach

Use a mixed operation registry, but implement only `buffer` in the first
iteration. The public core API receives structured operation options, while the
internal runtime keeps a SQL execution path available for future operations.

This keeps the first version small enough to verify while preserving room for
future SQL-powered spatial tools.

Rejected alternatives:

- SQL-first public API: too flexible for v1, and difficult to validate that the
  result can always become an emap dataset.
- Structure-only API forever: safer, but too restrictive for future DuckDB
  workflows.
- Main-bundle integration: too heavy for users who do not need DuckDB-Wasm.

## Module Layout

Proposed files:

```text
src/duckdb/
  index.ts
  duckdb-runtime.ts
  duckdb-operation.ts
  duckdb-buffer.ts
  duckdb-errors.ts
  duckdb-sql.ts
  map-op.ts
  duckdb-runtime.test.ts
  duckdb-buffer.test.ts
  map-op.test.ts
```

Build outputs:

```text
dist/emap-duckdb.mjs
dist/emap-duckdb.js
```

Package export:

```json
{
  "./duckdb": {
    "types": "./dist/duckdb/index.d.ts",
    "import": "./dist/emap-duckdb.mjs",
    "default": "./dist/emap-duckdb.mjs"
  }
}
```

DuckDB-Wasm assets, workers, and extensions must not be pulled into the main
`emap` or `formats` bundles.

## Public API

Core processing API:

```ts
type DuckDbRuntime = {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  insertArrowTable(table: ArrowTable, opts: { name: string }): Promise<void>;
  query(sql: string): Promise<ArrowTable>;
  close?(): Promise<void>;
};

type DuckDbBufferOptions = {
  layer?: string | number;
  distance: number;
  outputLayer?: string;
  geometryColumn?: string;
  failOnGeographicCrs?: boolean;
};

async function bufferDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbBufferOptions,
  runtime?: DuckDbRuntime,
): Promise<MapshaperDataset>;
```

Map operation API:

```ts
async function duckDbBufferLayer(ctx: OpContext, opts: {
  src: string;
  target?: string;
  distance: number;
  output?: 'replace-source' | { sourceId: string };
  layer?: string | number;
  runtime?: DuckDbRuntime;
}): Promise<Result>;
```

Runtime helpers:

```ts
setDuckDbRuntime(runtime: DuckDbRuntime | null): void;

async function createDuckDbRuntimeFromJsDelivr(opts?: {
  extensionRepository?: string;
  logger?: DuckDbLogger;
}): Promise<DuckDbRuntime>;
```

The runtime API is injection-first. A default CDN/helper loader may be provided
for demos and simple use cases, but production users can supply their own
worker, WASM, and extension hosting strategy.

## Data Flow

The first buffer operation should follow this path:

```text
MapshaperDataset
  -> toArrowTable(dataset, { encoding: "wkb" })
  -> DuckDB temp table
  -> LOAD spatial
  -> internal buffer SQL
  -> Arrow result table
  -> fromArrowTable(result)
  -> MapshaperDataset
  -> map source update or new output source
```

Use WKB as the DuckDB geometry bridge because DuckDB spatial functions can
consume and emit WKB, and the existing GeoParquet path already treats WKB as the
compatibility default.

Internal SQL shape:

```sql
SELECT
  * EXCLUDE (geometry),
  ST_AsWKB(ST_Buffer(ST_GeomFromWKB(geometry), ?)) AS geometry
FROM input_table
WHERE geometry IS NOT NULL
```

Exact DuckDB spatial function names should be verified during implementation
against real DuckDB-Wasm tests.

For buffer, CRS metadata should be preserved because the operation does not
change coordinate reference systems.

## CRS Policy

DuckDB spatial buffer distance uses the input coordinate units.

V1 policy:

- Reject known geographic CRS by default, including `EPSG:4326` and
  `OGC:CRS84`.
- Error message:
  `DuckDB buffer uses coordinate units; reproject to a projected CRS before buffering.`
- Allow projected CRS.
- Allow unknown CRS with a warning or metadata note, because the engine cannot
  verify distance units.
- Do not automatically reproject in v1.

## Map Integration

The map-facing layer should follow the existing ops architecture:

- Accept an existing `OpContext`.
- Resolve a source by `src`.
- Read the loaded dataset.
- Call the core DuckDB processor.
- Update the map only after the core operation succeeds.
- If output is a new source, create or replace that output source id.
- If output is `replace-source`, use transaction-aware replacement if the
  existing ops runner supports a clean hook; otherwise defer replace-source out
  of the first implementation.

The map wrapper should not know SQL details. It should translate source and
operation options into `bufferDatasetWithDuckDb()`.

## Error Handling

Validation errors before DuckDB:

- `distance` must be finite and greater than zero.
- Dataset must exist and be loaded.
- Target layer must exist.
- Target layer must have geometry.
- Geometry column must exist if custom geometry column support is enabled.
- Geographic CRS should fail by default.

Runtime errors:

- `runtime-unavailable`: no injected runtime and default loader unavailable.
- `spatial-extension-unavailable`: spatial extension cannot be installed or
  loaded.
- `query-failed`: DuckDB query failed.
- `conversion-failed`: result Arrow table cannot become an emap dataset.

Map op behavior:

- Failure must leave existing sources unchanged.
- New output source should be created only after success.
- Errors should be returned in the existing typed `Result` style when used from
  map ops.

## Testing Strategy

Core tests:

- Reject invalid distance.
- Reject geographic CRS by default.
- Allow projected CRS.
- Allow unknown CRS with warning behavior.
- Validate SQL shape using a fake injected runtime.
- Verify temp table cleanup and connection cleanup with fake runtime.

Conversion tests:

- Dataset to Arrow uses WKB geometry.
- Result Arrow table converts back to a dataset.
- CRS metadata is preserved for buffer output.

Map op tests:

- Success creates expected output source.
- Failure leaves source unchanged.
- Missing source/layer/geometry returns typed validation errors.

Integration tests:

- Add at least one real DuckDB-Wasm buffer test if worker, WASM, and spatial
  extension loading are stable in the test environment.
- If real DuckDB-Wasm integration is too heavy or flaky for normal CI, keep it
  opt-in and document the command.

## References

- DuckDB-Wasm data ingestion:
  https://duckdb.org/docs/current/clients/wasm/data_ingestion.html
- DuckDB-Wasm query:
  https://duckdb.org/docs/current/clients/wasm/query.html
- DuckDB-Wasm extensions:
  https://duckdb.org/docs/lts/clients/wasm/extensions.html
- DuckDB spatial extension:
  https://duckdb.org/docs/lts/core_extensions/spatial/overview.html
- DuckDB spatial functions:
  https://duckdb.org/docs/current/core_extensions/spatial/functions.html

## Open Implementation Checks

- Confirm the exact DuckDB-Wasm API signatures for Arrow insertion and query
  return type in the installed package version.
- Confirm spatial function names and WKB types in DuckDB-Wasm with the spatial
  extension loaded.
- Confirm the existing map ops runner has a safe source-replacement hook for
  `replace-source`; otherwise implement only new-output-source in v1.
- Confirm Rollup can keep DuckDB-Wasm out of the main and formats bundles.
