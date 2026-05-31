# EPSG Index Proj4 Resolver Design

## Goal

When an application or example lets a user select a standard EPSG coordinate
system, `emap` should translate that EPSG code into a Proj.4 string before
handing it to the existing mapshaper/mproj projection path.

This is the first phase of CRS standardization. It covers outbound projection
requests (`map.ops.projectLayer()` and `map.reproject()`). It does not change
dataset CRS detection for imported files beyond preserving existing behavior.

## Current Behavior

CRS normalization is currently synchronous and heuristic:

- `normalizeCrsString()` maps imported metadata to canonical labels for a small
  set of known CRS values.
- `normalizeProjectCrs()` maps `EPSG:4326` to `wgs84` and Web Mercator EPSG
  aliases to `webmercator`.
- Other EPSG codes pass through as raw strings. In the browser, mapshaper/mproj
  cannot reliably resolve arbitrary `+init=epsg:*` values, so standard EPSG
  choices outside the hand-written cases may fail.

`@developmentseed/epsg` was evaluated but is not a fit for this phase because
it provides OGC WKT2 strings, not Proj.4 definitions, and the current
mapshaper/mproj stack does not parse those WKT2 definitions directly.

## Dependency Choice

Use `epsg-index` as the single EPSG data source.

The implementation should remove `@developmentseed/epsg` and add
`epsg-index`. `epsg-index` provides per-code records with a `proj4` field, so
the resolver can map `EPSG:4490` or `4490` directly to a Proj.4 definition such
as `+proj=longlat +ellps=GRS80 +no_defs +type=crs`.

Only one EPSG package should remain in `package.json` after implementation.

## Resolver API

Add an async outbound projection resolver near the existing CRS utilities:

```ts
resolveProjectCrs(crs: string): Promise<string>
```

Behavior:

- Trim whitespace and reject empty input at the caller boundary as today.
- Keep existing stable aliases:
  - `EPSG:4326` -> `wgs84`
  - `EPSG:3857`, `EPSG:900913`, `EPSG:102100` -> `webmercator`
- Recognize numeric EPSG input in both `EPSG:NNNN` and plain `NNNN` forms.
- For other EPSG codes, load the matching `epsg-index` record and return its
  `proj4` field.
- Preserve non-EPSG projection strings and mapshaper aliases unchanged:
  `+proj=...`, `robinson`, `natearth`, `wintri`, custom projection aliases.

The existing synchronous `normalizeProjectCrs()` may remain for metadata and
fast alias normalization, but outbound projection execution should use the new
async resolver.

## Data Loading

Prefer lazy loading so normal map usage does not pay the EPSG data cost until
an arbitrary EPSG projection is requested.

The implementation should avoid importing the full `epsg-index/all.json` into
the main bundle if a per-code import path can be used reliably. If the package
shape makes per-code bundling awkward, the implementation may use a small
adapter module that centralizes the import choice, so future bundle-size
improvements do not touch projection callers.

## Projection Flow

`map.ops.projectLayer()`:

1. Resolve `opts.crs` with `resolveProjectCrs()`.
2. Resolve `opts.init` the same way when supplied.
3. Pass the resolved strings to the existing parsed mapshaper `proj` command.
4. Keep all existing target-layer, densify, and operation-result behavior.

`map.reproject()`:

1. Resolve `targetCrs` with `resolveProjectCrs()`.
2. Compare against the current projection using the same resolved outbound form.
3. Call `Projection.reproject()` with the resolved value.
4. Keep existing spatial-index invalidation, extent reset, line-scale reset,
   `crschange`, and `data` event behavior.

`TopologySource.reproject()` and `Projection.reproject()` should continue to
execute through mapshaper/mproj. The resolver only changes the CRS string
handed to that path.

## Error Handling

Errors should be explicit and recoverable:

- Empty CRS remains a validation error.
- Unknown EPSG code should fail with a clear message such as
  `Unsupported EPSG code: EPSG:XXXX`.
- EPSG records without a usable `proj4` field should fail with
  `EPSG:XXXX does not include a Proj.4 definition`.
- Non-EPSG strings should not be eagerly rejected; mapshaper should continue to
  own validation for custom Proj.4 strings and named aliases.

`projectLayer()` should return an `OpResult` validation failure for resolver
errors. `map.reproject()` may reject its promise with the resolver error, which
matches its current async API shape.

## Testing

Add focused tests for:

- `resolveProjectCrs('EPSG:4490')` returns a Proj.4 string containing
  `+proj=longlat` and `+ellps=GRS80`.
- `resolveProjectCrs('32633')` resolves UTM zone 33N from EPSG data.
- `EPSG:4326` and Web Mercator aliases retain existing `wgs84` /
  `webmercator` behavior.
- Non-EPSG strings such as `+proj=utm +zone=10` and `robinson` pass through.
- Unknown EPSG codes fail with a readable error.
- `projectLayer()` passes resolved CRS/init strings to the mapshaper command.
- `map.reproject()` resolves before calling `Projection.reproject()`.

Run `npm run typecheck`, targeted CRS/projection tests, and the full test suite
if the change touches shared map operation behavior.

## Non-Goals

- Do not add `proj4` as a runtime projection engine.
- Do not convert WKT2 to Proj.4 in this phase.
- Do not redesign imported dataset CRS detection in this phase.
- Do not add network calls to EPSG.io or any external service.
