# DuckDB Relation Spatial Operations Design

## Context

`@zwishing/emap/duckdb` currently supports three DuckDB-Wasm spatial processing
surfaces:

- Geometry-to-geometry operations such as buffer, centroid, envelope, simplify,
  and make-valid.
- Geometry-to-attribute operations such as area, length, geometry type,
  validity predicates, point coordinates, and centroid coordinates.
- Map-op and browser example integration for running those operations and
  showing generated layers.

The next step is relation processing: operations where an input layer is tested
against a mask layer. This is the foundation for spatial selection, spatial
filtering, later drawn/selected geometry workflows, and future overlay or join
features.

## Goals

- Add a reusable DuckDB relation core for two-layer spatial predicates.
- Support both filtered geometry output and attribute-column output.
- Keep the API constrained to named operations; do not expose raw SQL.
- Preserve the existing Arrow table -> Mapshaper dataset conversion path.
- Integrate with map-op and the DuckDB browser example.
- Keep CRS behavior consistent with existing buffer/measurement operations.

## Non-Goals

- Do not implement overlay geometry generation such as intersection polygons,
  union, difference, dissolve, or clip output.
- Do not implement drawn or selected geometry UI in this change.
- Do not expose arbitrary SQL expressions.
- Do not add a new runtime or dependency.

## Supported Operations

First batch:

- `intersects`
- `contains`
- `within`
- `touches`
- `disjoint`
- `distance`
- `distanceWithin`

Deferred to later batches:

- `crosses`
- `overlaps`
- `equals`
- overlay operations such as `intersection`, `difference`, `union`, and `clip`

## Output Modes

### Filter Mode

Filter mode returns only input rows that satisfy the relation against at least
one mask row. The returned dataset preserves input geometry and input records.

Example SQL shape:

```sql
SELECT i.*
FROM "input_table" i
WHERE EXISTS (
  SELECT 1
  FROM "mask_table" m
  WHERE ST_Intersects(i."geometry", m."geometry")
)
```

### Attribute Mode

Attribute mode keeps all input rows and appends one scalar column.

Predicate operations append boolean columns:

```sql
SELECT
  i.*,
  EXISTS (
    SELECT 1
    FROM "mask_table" m
    WHERE ST_Intersects(i."geometry", m."geometry")
  ) AS "duckdb_intersects"
FROM "input_table" i
```

`distance` appends the minimum distance from each input geometry to the mask
layer:

```sql
SELECT
  i.*,
  (
    SELECT MIN(ST_Distance(i."geometry", m."geometry"))
    FROM "mask_table" m
  ) AS "duckdb_distance"
FROM "input_table" i
```

`distanceWithin` appends a boolean:

```sql
SELECT
  i.*,
  EXISTS (
    SELECT 1
    FROM "mask_table" m
    WHERE ST_Distance(i."geometry", m."geometry") <= 100
  ) AS "duckdb_distance_within"
FROM "input_table" i
```

Output column collisions follow the attribute operation behavior: requested
columns are suffixed with `_1`, `_2`, and so on until unique.

## Dataset API

Core files:

- `src/duckdb/duckdb-relation-op.ts`
- `src/duckdb/duckdb-relation-ops.ts`

Filter helpers:

```ts
intersectsDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
containsDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
withinDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
touchesDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
disjointDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
distanceWithinDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
```

Attribute helpers:

```ts
intersectsAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
containsAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
withinAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
touchesAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
disjointAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
distanceAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
distanceWithinAttributeDatasetWithDuckDb(inputDataset, maskDataset, opts, runtime)
```

Options:

```ts
interface DuckDbRelationOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
  outputColumn?: string;
  distance?: number;
  failOnGeographicCrs?: boolean;
}
```

`distance` is required for `distanceWithin`. It must be a finite positive
number.

## Runtime Flow

The core mirrors the existing DuckDB geometry and attribute pipelines:

1. Convert input dataset layer to Arrow WKB table.
2. Convert mask dataset layer to Arrow WKB table.
3. `runtime.ensureSpatial()`.
4. `runtime.connect()`.
5. Insert both Arrow tables with generated table names.
6. Run relation SQL.
7. Convert returned Arrow table to Mapshaper dataset.
8. Preserve `inputDataset.info.crs_string` on the result.
9. Drop both temporary tables in `finally`.
10. Close the connection in `finally`.

Temporary table cleanup must tolerate failures the same way existing DuckDB
operations do.

## CRS Rules

- Topological predicates allow geographic CRS:
  - `intersects`
  - `contains`
  - `within`
  - `touches`
  - `disjoint`
- Distance operations reject geographic CRS by default:
  - `distance`
  - `distanceWithin`
- Distance operations accept `failOnGeographicCrs: false` when the caller
  intentionally wants degree-based distances.

If both input and mask datasets have CRS metadata and both are present, the
implementation should not attempt reprojection. It should assume the caller
provides compatible coordinate systems. A later change can add stricter CRS
compatibility checks if the project needs it.

## Error Handling

Use the existing `DuckDbOperationError` kinds:

- `runtime-unavailable`
- `spatial-extension-unavailable`
- `query-failed`
- `conversion-failed`
- `validation`

Validation errors:

- Unknown relation operation.
- Empty `outputColumn`.
- Missing or invalid `distance` for `distanceWithin`.
- Geographic CRS used with distance operations while
  `failOnGeographicCrs !== false`.
- Missing `output.sourceId` in map-op integration.
- Missing input or mask source in map-op integration.

DuckDB query failures remain wrapped as `query-failed`.

## Map-Op Integration

Add:

```ts
duckDbRelationLayer(ctx, {
  src: 'parcels',
  mask: 'roads',
  operation: 'intersects',
  mode: 'filter',
  inputLayer: 'parcels',
  maskLayer: 'roads',
  output: { sourceId: 'parcels-intersects-roads' },
})
```

`mode` is:

- `'filter'`
- `'attribute'`

The map-op resolves both `src` and `mask` through the existing source context,
runs the selected dataset helper, writes the output source dataset, and returns
an `OpResult`.

## Browser Example Integration

Update `test/examples/duckdb-spatial-ops.html` with relation controls:

- Input/current layer picker stays the shared layer picker.
- Add a mask layer picker.
- Add relation operation choices.
- Add relation mode choices: filter / attribute.
- Add distance input only for `distance` and `distanceWithin`.
- Generated relation output is appended to the same shared layer picker.
- Existing click-pick attributes panel remains active for generated output.

This keeps relation output consistent with the latest example behavior: all
generated layers are selectable from the same layer picker, and only the current
layer is visible.

## Testing Strategy

### SQL Builder Tests

- Filter predicate SQL.
- Attribute predicate SQL.
- Attribute distance SQL.
- Filter and attribute `distanceWithin` SQL.
- Identifier quoting for input, mask, and geometry columns.
- Output column collision resolution.

### Core Pipeline Tests

- Runtime sequence:
  `ensureSpatial -> connect -> insert input -> insert mask -> query -> drop input -> drop mask -> close`.
- Filter mode preserves input geometry and attributes.
- Attribute mode appends boolean or numeric columns.
- Error wrapping for spatial extension failures.
- Error wrapping for query failures.
- Error wrapping for conversion failures.

### Helper Tests

- Named helpers dispatch to the expected DuckDB spatial functions.
- Topological predicates allow WGS84.
- Distance operations reject WGS84 by default.
- Distance operations allow WGS84 with `failOnGeographicCrs: false`.
- `distanceWithin` validates `distance`.

### Map-Op Tests

- Filter mode writes an output dataset.
- Attribute mode writes an output dataset.
- Unknown operation returns validation error.
- Missing input or mask source returns not-found.
- Missing output source id returns validation error.

### DuckDB-Wasm Integration Tests

- Polygon intersects mask polygon.
- Attribute intersects boolean.
- Minimum distance returns expected numeric value.
- `distanceWithin` returns expected boolean value.
- WGS84 topological predicate is allowed.
- WGS84 distance operation is rejected unless explicitly allowed.

### Example Tests

- Relation controls exist.
- Relation operations exist.
- Relation mode controls exist.
- Mask layer picker exists.
- Generated output continues to enter the shared layer picker.
- Click-pick attribute panel remains wired.

## Implementation Order

1. Relation SQL builders.
2. Relation core pipeline.
3. Named dataset helpers.
4. Map-op integration.
5. Browser example integration.
6. README and barrel exports.
7. Full verification and commit.
