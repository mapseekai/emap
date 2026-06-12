# DuckDB Unary Spatial Operations Design

Date: 2026-06-12

## Purpose

Extend the optional `@zwishing/emap/duckdb` module from the existing buffer
vertical slice to a first batch of DuckDB Spatial single-input,
feature-by-feature geometry operations.

This change keeps the current DuckDB integration shape:

```text
MapshaperDataset
  -> Arrow table with WKB geometry
  -> DuckDB-Wasm + spatial extension
  -> Arrow table with WKB geometry
  -> MapshaperDataset
```

The first batch intentionally excludes predicates, joins, overlays, aggregates,
attribute-producing operations, arbitrary SQL, and automatic reprojection.

## Scope

Implement geometry-to-geometry operations that can run independently for each
input feature:

- `centroidDatasetWithDuckDb`
- `envelopeDatasetWithDuckDb`
- `convexHullDatasetWithDuckDb`
- `boundaryDatasetWithDuckDb`
- `simplifyDatasetWithDuckDb`
- `simplifyPreserveTopologyDatasetWithDuckDb`
- `makeValidDatasetWithDuckDb`

Keep `bufferDatasetWithDuckDb` as a supported public API. It may be migrated to
the shared pipeline internally, but its behavior and option names must remain
compatible.

## Public API

All dataset helpers accept an input `MapshaperDataset`, operation options, and
an optional injected `DuckDbRuntime`.

Common options:

```ts
export interface DuckDbUnaryGeometryOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
}
```

Distance/tolerance operations add CRS protection:

```ts
export interface DuckDbSimplifyOptions extends DuckDbUnaryGeometryOptions {
  tolerance: number;
  failOnGeographicCrs?: boolean;
}
```

Existing buffer options remain:

```ts
export interface DuckDbBufferOptions extends DuckDbUnaryGeometryOptions {
  distance: number;
  failOnGeographicCrs?: boolean;
}
```

Dataset helpers:

```ts
centroidDatasetWithDuckDb(dataset, opts, runtime?)
envelopeDatasetWithDuckDb(dataset, opts, runtime?)
convexHullDatasetWithDuckDb(dataset, opts, runtime?)
boundaryDatasetWithDuckDb(dataset, opts, runtime?)
simplifyDatasetWithDuckDb(dataset, opts, runtime?)
simplifyPreserveTopologyDatasetWithDuckDb(dataset, opts, runtime?)
makeValidDatasetWithDuckDb(dataset, opts, runtime?)
```

The DuckDB map adapter should expose one generic operation surface and keep
small named wrappers where they are useful:

```ts
duckDbGeometryLayer(ctx, {
  src,
  operation,
  layer,
  output: { sourceId },
  runtime,
  ...operationArgs
})
```

`duckDbBufferLayer` should remain available and keep its current semantics.

## Internal Architecture

Add a table-driven unary operation core instead of duplicating the current
buffer pipeline for every function.

```ts
interface DuckDbGeometryOperationSpec {
  id: string;
  duckDbFunction: string;
  args: DuckDbOperationArgSpec[];
  requiresProjectedUnits?: boolean;
}
```

The core processor should:

1. Validate operation-specific arguments.
2. Validate projected-coordinate requirements when applicable.
3. Convert the selected layer with `toArrowTable(dataset, { encoding: 'wkb' })`.
4. Call `runtime.ensureSpatial()`.
5. Create a DuckDB connection.
6. Insert the Arrow table into a unique temporary table.
7. Query a generated unary geometry SQL statement.
8. Convert the result with `fromArrowTable()`.
9. Preserve `dataset.info?.crs_string`.
10. Drop the temporary table and close the connection in `finally`.

## SQL Shape

Generated SQL must continue to quote identifiers and must use an explicit WKB
bridge for DuckDB Spatial function calls:

```sql
SELECT
  * EXCLUDE ("geometry"),
  ST_AsWKB(ST_Op(ST_GeomFromWKB("geometry"), ...args)) AS "geometry"
FROM "input_table"
WHERE "geometry" IS NOT NULL
```

Numeric operation arguments must be validated before interpolation. Do not
accept raw SQL expressions from callers.

## CRS Rules

Operations with coordinate-unit parameters must reject known geographic CRS by
default:

- `buffer`
- `simplify`
- `simplifyPreserveTopology`

For those operations, `failOnGeographicCrs` defaults to `true` and may be set
to `false` only when degree-based units are intentional.

Operations without coordinate-unit parameters do not reject geographic CRS by
default:

- `centroid`
- `envelope`
- `convexHull`
- `boundary`
- `makeValid`

All outputs preserve the input CRS metadata because these operations do not
change coordinate reference systems.

## Error Handling

Reuse `DuckDbOperationError` and the existing error kinds:

- `validation` for invalid distance, tolerance, operation id, layer, or output.
- `runtime-unavailable` when no runtime is available.
- `spatial-extension-unavailable` when `ensureSpatial()` fails.
- `query-failed` when DuckDB query execution fails.
- `conversion-failed` when Arrow-to-dataset conversion fails.

Map adapter errors should continue converting validation errors to existing
`OpResult` validation failures and all other errors to mapshaper operation
errors with operation context.

## Tests

Unit tests should cover:

- SQL generation for every operation spec.
- Identifier quoting for table and geometry column names.
- Numeric argument validation for `distance` and `tolerance`, including
  `NaN`, `Infinity`, and invalid sign rules.
- Geographic CRS rejection for `buffer`, `simplify`, and
  `simplifyPreserveTopology`.
- Fake runtime pipeline order:
  `ensureSpatial -> connect -> insert -> query -> drop -> close`.
- Conversion back to `MapshaperDataset`.
- Error wrapping for spatial setup, query, and conversion failures.
- Map adapter success, missing source, missing dataset, missing output, and
  failure-without-output-write cases.

Integration tests should keep runtime cost bounded. The first real
DuckDB-Wasm integration batch should cover representative operations:

- `centroid`
- `envelope`
- `simplifyPreserveTopology`
- `makeValid`

The remaining operation specs can be covered by SQL builder and fake runtime
tests unless a function shows DuckDB-Wasm-specific behavior.

## Non-Goals

This design does not include:

- Spatial predicates such as `ST_Intersects`, `ST_Contains`, or `ST_Within`.
- Overlay operations such as `ST_Intersection`, `ST_Difference`, or
  `ST_Union`.
- Spatial joins.
- Aggregate operations.
- Geometry-to-attribute helpers such as `ST_Area` or `ST_Length`.
- Public arbitrary SQL execution.
- Automatic reprojection.
- UI controls.

Those can be added in later designs with separate API and result-shape
decisions.
