# Additional DuckDB Relation Predicates Design

**Date:** 2026-08-10  
**Status:** Approved in conversation

## Context

The optional `@mapseekai/emap/duckdb` entry already provides a generic relation
pipeline with filter and attribute modes. It currently exposes five topological
predicates (`intersects`, `contains`, `within`, `touches`, and `disjoint`) plus
distance and distance-within operations. DuckDB Spatial also provides six
common topological predicates that are not yet represented by emap:
`ST_Overlaps`, `ST_Equals`, `ST_Crosses`, `ST_Covers`, `ST_CoveredBy`, and
`ST_ContainsProperly`.

The existing relation pipeline already owns CRS alignment, WKB/Arrow
conversion, DuckDB-Wasm lifecycle, SQL execution, result conversion, cleanup,
and map-source integration. The new predicates should extend that pipeline
without creating another execution path.

## Goals

- Add the operation ids `overlaps`, `equals`, `crosses`, `covers`, `coveredBy`,
  and `containsProperly`.
- Support both existing relation modes for every new predicate:
  - `filter` keeps input features matching at least one mask feature.
  - `attribute` appends a boolean result column to every non-null input
    geometry.
- Provide explicit dataset helpers consistent with the existing public API.
- Make the new ids available through `duckDbRelationLayer` without adding a
  separate map operation.
- Verify every DuckDB function against the installed DuckDB-Wasm runtime.
- Document the predicates in both documentation languages and expose them in
  the existing runnable spatial-operations example.

## Non-goals

- No R-tree index, bounding-box prefilter, or other spatial-join optimization.
  Those changes require before/after benchmarks and remain separate performance
  work.
- No resident multi-operation DuckDB session or chained-operation API.
- No generic raw-function or raw-SQL relation API.
- No changes to overlay semantics, distance operations, or CRS unit policy.
- No fallback implementation outside DuckDB Spatial.

## Approaches Considered

### Extend the registry and add explicit helpers (selected)

Add each predicate to the existing typed operation registry and expose named
filter and attribute helpers. This preserves the current public API style and
reuses the complete relation pipeline.

### Extend operation ids only

The map operation could accept the new ids without adding named dataset
helpers. This produces a smaller diff but makes the new capabilities
inconsistent with existing predicates such as `intersects` and `contains`.

### Add a new generic public relation helper

A public helper accepting an arbitrary operation and mode would reduce helper
count, but it would broaden the API and duplicate the role already served by
the internal operation registry. The additional abstraction is not needed for
six fixed DuckDB functions.

## Public API

| Operation id | DuckDB function | Default attribute column |
| --- | --- | --- |
| `overlaps` | `ST_Overlaps` | `duckdb_overlaps` |
| `equals` | `ST_Equals` | `duckdb_equals` |
| `crosses` | `ST_Crosses` | `duckdb_crosses` |
| `covers` | `ST_Covers` | `duckdb_covers` |
| `coveredBy` | `ST_CoveredBy` | `duckdb_covered_by` |
| `containsProperly` | `ST_ContainsProperly` | `duckdb_contains_properly` |

Each registry entry has the same capabilities:

- `output: 'predicate'`
- `supportsFilter: true`
- `supportsAttribute: true`
- `requiresDistance: false`
- `rejectGeographicCrs: false`

The filter helpers are:

- `overlapsDatasetWithDuckDb`
- `equalsDatasetWithDuckDb`
- `crossesDatasetWithDuckDb`
- `coversDatasetWithDuckDb`
- `coveredByDatasetWithDuckDb`
- `containsProperlyDatasetWithDuckDb`

The attribute helpers are:

- `overlapsAttributeDatasetWithDuckDb`
- `equalsAttributeDatasetWithDuckDb`
- `crossesAttributeDatasetWithDuckDb`
- `coversAttributeDatasetWithDuckDb`
- `coveredByAttributeDatasetWithDuckDb`
- `containsProperlyAttributeDatasetWithDuckDb`

All helpers retain the existing `DuckDbRelationHelperOptions` contract and
runtime-injection argument. The `distance` option is ignored by these
non-distance operations, matching existing topological helpers.

## Predicate Direction

DuckDB receives the input geometry as the first argument and the mask geometry
as the second:

```sql
ST_Function(input_geometry, mask_geometry)
```

This ordering is observable for non-symmetric predicates:

- `covers` selects or marks an input feature when it covers a mask feature.
- `coveredBy` selects or marks an input feature when it is covered by a mask
  feature.
- `containsProperly` selects or marks an input feature when it properly
  contains a mask feature.

The same ordering is used in filter and attribute modes. Documentation and
tests must use this terminology consistently.

## Architecture and Data Flow

No new processing component is introduced. The existing flow remains:

```text
input dataset + mask dataset
  -> align mask CRS to input CRS
  -> convert both selected layers to WKB Arrow tables
  -> load DuckDB Spatial and insert both tables
  -> execute the existing relation SQL builder
  -> convert the Arrow result to a dataset
  -> restore the input dataset CRS
  -> drop temporary tables and close the connection
```

Filter mode continues to use a correlated `EXISTS` predicate. This preserves
one output row per input feature even when several mask features match.
Attribute mode continues to append an `EXISTS` boolean expression. Null input
and mask geometries retain the current exclusion behavior.

The implementation extends `RelationDuckDbFunction` with the six fixed
`ST_*` names and extends the existing topological operation registry. The SQL
function-name safety check remains unchanged. `runRelationOperation` currently
uses explicit filter-mode and attribute-mode switches, so both switches gain
cases that call the corresponding new named helpers. `duckDbRelationLayer`
continues to use that existing runner rather than adding another map operation.

## CRS and Units

These operations are topological predicates and do not interpret coordinate
values as a linear distance. They therefore follow the current policy for
`intersects`, `contains`, `within`, `touches`, and `disjoint`:

- The mask dataset is aligned to the input dataset CRS before conversion.
- Geographic CRS inputs are allowed.
- `failOnGeographicCrs` does not reject these operations.
- The output dataset inherits the input dataset CRS.

## Error Handling

The new predicates use the existing error mapping without new error kinds:

- Unknown operation id: `validation`.
- Missing runtime: `runtime-unavailable`.
- Spatial extension load failure: `spatial-extension-unavailable`.
- DuckDB query or cleanup failure: `query-failed`.
- Dataset/Arrow input or result conversion failure: `conversion-failed`.

Errors retain their original cause. No predicate silently falls back to a
different relation or a non-DuckDB implementation.

## Testing Strategy

Implementation follows red-green-refactor. Each production behavior starts
with a focused failing test.

### Unit tests

- Table-driven registry tests assert every operation id, DuckDB function,
  default output column, supported modes, distance requirement, and CRS policy.
- SQL tests assert that every new function is accepted in both filter and
  attribute SQL without changing identifier quoting or `EXISTS` semantics.
- Fake-runtime helper tests assert that all twelve named helpers dispatch to
  the correct `ST_*` function and mode.
- Map-operation tests assert that every new id reaches the shared relation
  pipeline and writes the resulting source.
- Existing unknown-operation and error-classification tests remain unchanged.

### DuckDB-Wasm integration tests

Each new `ST_*` function executes at least once against the installed
DuckDB-Wasm spatial extension. The matrix covers both filter and attribute
modes while avoiding a redundant twelve-case Cartesian product. Fixtures make
directional semantics explicit:

- Partially intersecting polygons for `overlaps`.
- Identical geometries for `equals`.
- Crossing lines for `crosses`.
- A polygon and a boundary point for `covers` and `coveredBy`.
- A strictly interior geometry for `containsProperly`.

Assertions cover selected feature identity or appended boolean values, not
only successful query execution.

### Documentation and example checks

- Update the Chinese and English DuckDB guides with the new operation table,
  helper names, and directional semantics.
- Add the six ids to the relation selector in the existing runnable DuckDB
  spatial-operations example.
- Extend example contract tests so the new choices cannot drift out of the
  example.
- Regenerate API documentation through the existing documentation command;
  generated API files are not edited manually.

## Verification

Completion requires fresh successful runs of:

1. Focused relation SQL, helper, map-op, integration, and example tests.
2. The complete DuckDB-Wasm integration script.
3. TypeScript type checking.
4. Formatting checks.
5. Production build and documentation/API validation affected by the public
   exports.
6. GitNexus `detect_changes` to confirm only the DuckDB relation flow,
   documentation, and example surfaces are affected.

## Success Criteria

- All six operation ids work in filter and attribute modes through the shared
  dataset and map-operation APIs.
- All twelve named helpers are public and type-safe.
- Every mapped `ST_*` function is verified against DuckDB-Wasm.
- Directional predicate behavior is documented and enforced by tests.
- Existing DuckDB operations retain their behavior and pass regression tests.
- No unmeasured performance optimization or unrelated refactor is included.
