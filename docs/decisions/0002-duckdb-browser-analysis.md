# ADR 0002: DuckDB-Wasm browser analysis

- Status: Accepted
- Date: 2026-08-18
- Supersedes: `docs/superpowers/specs/2026-08-18-duckdb-analysis-topic-design.md`

## Context

Some spatial workflows benefit from SQL, GeoParquet, Arrow, and DuckDB spatial functions, but loading DuckDB-Wasm for every map would increase startup and bundle cost. Arbitrary SQL and implicit CRS assumptions would also create security and correctness risks.

## Decision

- DuckDB integration is exposed through the optional `@mapseekai/emap/duckdb` entry point.
- Mapshaper datasets cross the boundary through Arrow tables and explicit geometry columns.
- Public query helpers accept a restricted single-SELECT subset; mutation, multiple statements, unapproved tables, and calculated output geometry are rejected before execution.
- Named spatial operations use typed operation identifiers and explicit output-column rules.
- Distance, length, perimeter, area, and buffer operations require declared unit semantics and reject geographic CRS by default when planar units are expected.
- Runtime creation, spatial-extension loading, and runtime injection remain testable seams.

## Consequences

Core maps do not pay the DuckDB-Wasm cost. Applications must deliberately initialize or inject a runtime, and each supported SQL or spatial capability needs an explicit typed contract and integration test.
