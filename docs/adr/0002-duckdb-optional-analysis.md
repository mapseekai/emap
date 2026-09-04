# ADR 0002: Optional DuckDB analysis

- Status: Accepted
- Date: 2026-08-18

## Context

The core renderer and editor must not require DuckDB-Wasm, while advanced users need browser-side SQL, GeoParquet queries, geometry processing, spatial predicates, overlays, and aggregate joins.

## Decision

- Publish DuckDB integration through the optional `@mapseekai/emap/duckdb` entry point.
- Require an explicit runtime or create one through the documented browser factory.
- Convert between mapshaper datasets and Arrow tables at the module boundary.
- Use typed operation descriptors and restricted SQL builders rather than accepting arbitrary command strings.
- Reject distance-like operations on geographic CRS data by default because their units would be angular.
- Return datasets from low-level helpers without silently changing a map; map-facing operations own source replacement, history, and rendering effects.
- Keep GeoParquet bytes under helper control instead of permitting user SQL to read arbitrary files.

## Consequences

- Core-only applications do not load DuckDB-Wasm.
- Runtime initialization and the spatial extension remain explicit deployment concerns.
- Low-level analysis is reusable outside an `Emap` instance.
- Map mutation remains consistent with the normal operation and undo model.

## Verification

Dedicated integration tests execute the shipped DuckDB-Wasm runtime for buffer, attribute, relation, query, GeoParquet, overlay, and spatial aggregate workflows.
