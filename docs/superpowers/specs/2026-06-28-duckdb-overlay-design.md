# DuckDB Overlay Operations Design

## Context

`@zwishing/emap/duckdb` already exposes DuckDB-Wasm helpers for buffering,
unary geometry operations, geometry-to-attribute calculations, relation
predicates, distance calculations, restricted SQL queries, and GeoParquet byte
queries. Those helpers share a common pattern: convert Mapshaper datasets to
WKB Arrow tables, execute a constrained DuckDB Spatial query, convert the Arrow
result back to `MapshaperDataset`, and surface map-level wrappers through
`map-op.ts`.

The next missing spatial capability is overlay: generating new geometry from an
input layer and a mask layer. The first batch focuses on `intersection` and
`difference` because they map cleanly to the existing input-vs-mask operation
model and do not require mask attribute ownership decisions.

## Goals

- Add high-level DuckDB helpers for `intersection` and `difference`.
- Treat the mask layer as a coverage mask by unioning all mask geometries before
  applying overlay to each input feature.
- Preserve input attributes and drop mask attributes.
- Return a geometry-bearing `MapshaperDataset` with configurable output layer
  name.
- Expose the feature through a map operation that reads `src` and `mask`
  datasets and writes to `output.sourceId`.
- Keep error handling, cleanup, tests, and exports consistent with existing
  DuckDB helpers.

## Non-Goals

- Do not add `union` or `symDifference` in this batch.
- Do not add pairwise input-mask overlay output.
- Do not merge mask attributes into output records.
- Do not preserve mask feature identifiers or mask grouping.
- Do not add CRS reprojection.
- Do not add UI controls or interactive editing flows.
- Do not expose arbitrary overlay SQL through the restricted query validator.

## Public API

### Dataset Helpers

```ts
intersectionDatasetWithDuckDb(
  inputDataset,
  maskDataset,
  {
    inputLayer?: 'parcels',
    maskLayer?: 'floodplain',
    outputLayer?: 'parcels_clipped',
    inputGeometryColumn?: 'geometry',
    maskGeometryColumn?: 'geometry',
  },
  runtime?,
);

differenceDatasetWithDuckDb(
  inputDataset,
  maskDataset,
  {
    inputLayer?: 'parcels',
    maskLayer?: 'floodplain',
    outputLayer?: 'parcels_erased',
    inputGeometryColumn?: 'geometry',
    maskGeometryColumn?: 'geometry',
  },
  runtime?,
);
```

Both helpers return `Promise<MapshaperDataset>`.

### Map Operation

```ts
duckDbOverlayLayer(ctx, {
  src: 'parcels',
  mask: 'floodplain',
  operation: 'intersection',
  inputLayer: 'parcels',
  maskLayer: 'floodplain',
  output: { sourceId: 'parcels-clipped' },
  runtime?,
});
```

`operation` accepts `'intersection' | 'difference'`. The map operation follows
the existing `OpResult` contract: validation failures return structured
validation errors, missing sources return `not-found`, and DuckDB failures map
through the existing map-op DuckDB adapter.

## Architecture

Add overlay as a separate DuckDB path rather than extending relation helpers.
Relation helpers currently either filter input rows or append predicate/distance
attributes; overlay creates new geometry, so a separate boundary keeps both
concepts easier to reason about.

New modules:

- `src/duckdb/duckdb-overlay-op.ts`: shared executor for overlay operations.
  It owns input/mask Arrow conversion, table registration, SQL execution,
  result conversion, cleanup, and error wrapping.
- `src/duckdb/duckdb-overlay-ops.ts`: public named helpers and operation spec
  lookup for `intersection` and `difference`.

Existing modules to extend in the implementation scope:

- `src/duckdb/duckdb-sql.ts`: add SQL builders for overlay queries.
- `src/duckdb/map-op.ts`: add `DuckDbOverlayLayerOptions`,
  `DuckDbOverlayLayerResult`, and `duckDbOverlayLayer()`.
- `src/duckdb/index.ts`: export the overlay helper modules.
- `README.md`: document dataset helpers and the map-op adapter form.

## Data Flow

1. Convert input and mask datasets to WKB Arrow tables with `toArrowTable()`.
2. Register both Arrow tables in DuckDB temporary table names.
3. Build a mask union subquery from non-null mask geometries.
4. Apply the selected overlay function to each non-null input geometry.
5. Filter out `NULL` and empty overlay results.
6. Convert the Arrow result to `MapshaperDataset` with `fromArrowTable()`.
7. Copy `inputDataset.info.crs_string` to the result when present.
8. Drop temporary DuckDB tables and close the connection in `finally`.

The result keeps input records only. Mask records are used only to construct the
unioned mask geometry.

## SQL Semantics

The first implementation should produce SQL with these properties:

- The mask side is collapsed once with DuckDB Spatial union aggregation.
- `intersection` uses `ST_Intersection(input.geometry, mask_union.geometry)`.
- `difference` uses `ST_Difference(input.geometry, mask_union.geometry)`.
- Output includes all non-geometry input columns plus the computed geometry.
- Output geometry column keeps the input geometry column name, defaulting to
  `geometry`.
- `ST_IsEmpty(...)` filters empty overlay results.
- DuckDB Spatial function names remain fixed by operation spec, not passed from
  user input.

Mask-empty behavior is operation-specific:

- `intersection`: returns an empty dataset with the requested output layer name.
- `difference`: returns the input geometries and input attributes unchanged,
  except for the requested output layer name.

CRS behavior:

- No automatic reprojection is performed.
- Callers are responsible for passing input and mask datasets in the same
  coordinate reference system.
- Output CRS metadata inherits from the input dataset.

## Error Handling

Use `DuckDbOperationError` consistently:

- `runtime-unavailable`: no runtime is available.
- `spatial-extension-unavailable`: `runtime.ensureSpatial()` fails.
- `validation`: unsupported operation, missing map-op source/mask/output, or
  invalid option values.
- `conversion-failed`: input/mask cannot be converted to Arrow or the DuckDB
  result cannot be converted back to `MapshaperDataset`.
- `query-failed`: DuckDB table registration, SQL execution, or cleanup fails.

Cleanup follows the existing DuckDB helper rule: preserve the primary error when
both primary work and cleanup fail. If primary work succeeds and cleanup fails,
report a cleanup failure.

## Edge Cases

- Null input geometries are excluded from overlay processing.
- Empty overlay results are filtered out.
- Mixed geometry results are allowed when `fromArrowTable()` can represent them.
- Geographic CRS is not rejected because topological overlay does not depend on
  linear units the same way area, length, and distance do.
- Input and mask CRS mismatches are not corrected in this batch.
- Mask attributes never appear in the result.

## Testing Strategy

### SQL Builder Tests

- `intersection` SQL includes mask union and `ST_Intersection`.
- `difference` SQL includes mask union and `ST_Difference`.
- SQL quotes input/mask table names and geometry columns.
- SQL filters null input geometries and empty overlay results.
- SQL uses fixed operation specs, not caller-provided function names.

### Executor Unit Tests

- Converts input and mask datasets to WKB Arrow tables.
- Registers both tables and closes the connection.
- Preserves input attributes in output.
- Preserves input CRS metadata.
- Does not include mask attributes.
- Handles empty mask for `intersection` and `difference`.
- Preserves primary query/conversion errors when cleanup also fails.
- Reports cleanup failure after otherwise successful work.

### Named Helper Tests

- `intersectionDatasetWithDuckDb()` dispatches to `ST_Intersection`.
- `differenceDatasetWithDuckDb()` dispatches to `ST_Difference`.
- Output layer name is configurable.
- Unsupported operation lookup fails as validation.

### Map-Op Tests

- Successful overlay writes `output.sourceId`.
- Missing `src` returns `not-found`.
- Missing `mask` returns `not-found`.
- Missing `output.sourceId` returns `validation`.
- DuckDB failures do not write output.

### DuckDB-Wasm Integration Tests

- Polygon intersection clips input geometry to the mask coverage.
- Polygon difference erases mask coverage from input geometry.
- Input attributes are preserved.
- Mask attributes are absent.
- Output CRS inherits input CRS.

Add the integration file to `test:duckdb` so real DuckDB-Wasm overlay coverage
runs with the existing DuckDB integration suite.

## Documentation

Update the DuckDB section in `README.md` with:

- Dataset helper examples for `intersectionDatasetWithDuckDb()` and
  `differenceDatasetWithDuckDb()`.
- A map-like adapter example for `duckDbOverlayLayer()`.
- A short note that mask geometries are unioned first, mask attributes are not
  copied, and input/mask CRS must already match.

## Verification

Implementation completion requires:

- focused overlay unit tests
- focused map-op tests
- `npm run test:duckdb`
- `npm run test:run`
- `npm run typecheck`
- `npm run build`
- `npm run format:check`
- `git diff --check`
- `node .gitnexus/run.cjs detect_changes --repo emap --scope staged` before
  each commit

## References

- DuckDB Spatial functions:
  `https://duckdb.org/docs/current/core_extensions/spatial/functions.html`
