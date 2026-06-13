# DuckDB Attribute Spatial Operations Design

Date: 2026-06-13

## Purpose

Add a second DuckDB-Wasm spatial processing batch for single-input,
feature-by-feature geometry-to-attribute operations.

The first DuckDB spatial batch returns geometry. This batch keeps the input
geometry unchanged and appends calculated attribute columns, so the result can
still be rendered as a normal `MapshaperDataset` while exposing measurements,
geometry metadata, and validity flags in records.

## Scope

Implement dataset helpers for these geometry-to-attribute operations:

- `areaDatasetWithDuckDb`
- `lengthDatasetWithDuckDb`
- `perimeterDatasetWithDuckDb`
- `xDatasetWithDuckDb`
- `yDatasetWithDuckDb`
- `geometryTypeDatasetWithDuckDb`
- `isValidDatasetWithDuckDb`
- `isEmptyDatasetWithDuckDb`
- `isSimpleDatasetWithDuckDb`

This batch excludes predicates, joins, overlays, aggregates, automatic
reprojection, and arbitrary public SQL expressions.

## Public API

All helpers accept a `MapshaperDataset`, operation options, and an optional
`DuckDbRuntime`.

Common options:

```ts
export interface DuckDbAttributeOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
  outputColumn?: string;
}
```

Projected-unit operations add CRS protection:

```ts
export interface DuckDbProjectedAttributeOptions extends DuckDbAttributeOptions {
  failOnGeographicCrs?: boolean;
}
```

Dataset helpers:

```ts
areaDatasetWithDuckDb(dataset, opts, runtime?)
lengthDatasetWithDuckDb(dataset, opts, runtime?)
perimeterDatasetWithDuckDb(dataset, opts, runtime?)
xDatasetWithDuckDb(dataset, opts, runtime?)
yDatasetWithDuckDb(dataset, opts, runtime?)
geometryTypeDatasetWithDuckDb(dataset, opts, runtime?)
isValidDatasetWithDuckDb(dataset, opts, runtime?)
isEmptyDatasetWithDuckDb(dataset, opts, runtime?)
isSimpleDatasetWithDuckDb(dataset, opts, runtime?)
```

Map adapter:

```ts
duckDbAttributeLayer(ctx, {
  src,
  operation,
  layer,
  output: { sourceId },
  outputColumn,
  runtime,
})
```

The map adapter success result should include:

```ts
{
  sourceId: string;
  dataset: MapshaperDataset;
  outputColumn: string;
}
```

## Internal Architecture

Add a shared attribute processor parallel to the existing unary geometry
processor:

```ts
processAttributeWithDuckDb(dataset, opts, spec, runtime?)
```

Operation specs should describe only safe, known DuckDB Spatial calls:

```ts
interface DuckDbAttributeOperationSpec {
  id: string;
  duckDbFunction: string;
  defaultOutputColumn: string;
  requiresProjectedUnits?: boolean;
}
```

The processor should:

1. Validate operation-specific options.
2. Validate projected-unit CRS requirements when applicable.
3. Convert the selected layer with `toArrowTable(dataset, { encoding: 'wkb' })`.
4. Call `runtime.ensureSpatial()`.
5. Open a DuckDB connection.
6. Insert the Arrow table into a unique temporary table.
7. Query the original rows plus the new attribute expression.
8. Convert the result with `fromArrowTable()`.
9. Preserve `dataset.info?.crs_string`.
10. Drop the temporary table and close the connection in `finally`.

## SQL Shape

Generated SQL should preserve geometry and append one scalar attribute:

```sql
SELECT
  *,
  ST_Area("geometry") AS "duckdb_area"
FROM "input_table"
WHERE "geometry" IS NOT NULL
```

The geometry column remains a DuckDB `GEOMETRY` Arrow column. Do not wrap it in
`ST_AsWKB`; current conversion already reads DuckDB geometry output back into a
dataset.

Do not accept raw SQL from callers. Numeric, string, and boolean outputs all
come from known operation specs.

## Output Columns

Default output column names:

- `duckdb_area`
- `duckdb_length`
- `duckdb_perimeter`
- `duckdb_x`
- `duckdb_y`
- `duckdb_geometry_type`
- `duckdb_is_valid`
- `duckdb_is_empty`
- `duckdb_is_simple`

Column naming rules:

- If `outputColumn` is omitted, use the operation default.
- If `outputColumn` is provided, validate that it is not empty after trimming.
- Never overwrite an existing data field.
- Generate a unique column name when needed:
  - `duckdb_area`
  - `duckdb_area_1`
  - `duckdb_area_2`
- The returned dataset contains only the actual generated field name.
- The map adapter success result returns the generated `outputColumn`.

## Type Rules

Expected output types:

- `area`, `length`, `perimeter`, `x`, `y`: number
- `geometryType`: string
- `isValid`, `isEmpty`, `isSimple`: boolean

`x` and `y` have stable meaning for point geometries. The first implementation
should not pre-validate geometry type in JavaScript; if DuckDB rejects an input
geometry type, wrap the DuckDB failure as `query-failed`.

## CRS Rules

Reject known geographic CRS by default for projected-unit operations:

- `area`
- `length`
- `perimeter`

For those operations, `failOnGeographicCrs` defaults to `true` and can be set to
`false` when degree-based coordinate units are intentional.

Allow geographic CRS by default for operations that do not imply projected
units:

- `x`
- `y`
- `geometryType`
- `isValid`
- `isEmpty`
- `isSimple`

All outputs preserve the input CRS metadata because no operation changes the
coordinate reference system.

## Error Handling

Reuse `DuckDbOperationError` and current error kinds:

- `validation` for invalid `outputColumn`, unknown operation, or CRS rejection.
- `runtime-unavailable` when no runtime is available.
- `spatial-extension-unavailable` when `ensureSpatial()` fails.
- `query-failed` when DuckDB query execution fails.
- `conversion-failed` when Arrow-to-dataset conversion fails.

Map adapter errors should follow the existing DuckDB map-op pattern:

- Validation errors become `Err.validation(...)`.
- Missing source becomes `Err.notFound('source', src)`.
- Other failures become `Err.mapshaper(err, { operation })`.
- Output source is written only after successful processing.

## Tests

Unit tests should cover:

- SQL generation for scalar attribute expressions.
- Identifier quoting for table, geometry column, and output column names.
- Output column collision handling with `_1`, `_2` suffixes.
- Helper-to-DuckDB function mapping for all nine helpers.
- `area`, `length`, and `perimeter` CRS rejection on geographic CRS.
- `failOnGeographicCrs: false` override for projected-unit helpers.
- `x`, `y`, `geometryType`, `isValid`, `isEmpty`, and `isSimple` allowing
  geographic CRS.
- Fake runtime pipeline order:
  `ensureSpatial -> connect -> insert -> query -> drop -> close`.
- Result conversion preserves geometry and adds the attribute record field.
- Error wrapping for spatial setup, query, and conversion failures.
- `duckDbAttributeLayer()` success and typed failure cases.

Real DuckDB-Wasm integration tests should cover representative output types:

- `area` for numeric projected-unit output.
- `geometryType` for string output.
- `isValid` for boolean output.
- `x` and `y` on a point fixture.

## Non-Goals

This design does not include:

- Spatial predicates such as `ST_Intersects`, `ST_Contains`, or `ST_Within`.
- Overlay operations such as `ST_Intersection`, `ST_Difference`, or `ST_Union`.
- Spatial joins.
- Aggregate operations.
- Geometry output operations, already handled by the first DuckDB spatial batch.
- Public arbitrary SQL execution.
- Automatic reprojection.
- UI controls beyond example/demo updates.
