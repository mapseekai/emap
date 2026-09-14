# ADR 0007: Optional integration dependencies

- Status: Accepted
- Date: 2026-09-04

## Context

The core Canvas and topology editor can run without Arrow, Parquet, or DuckDB-Wasm. Keeping those libraries in the package's normal dependency graph made core-only installations pay for optional data and analysis integrations. MapLibre is different in the current release line: its types are part of `MapOptions` and the root service API, and the prebuilt core bundle retains a lazy MapLibre import.

## Decision

- `apache-arrow`, `parquet-wasm`, and `@duckdb/duckdb-wasm` are optional peer dependencies.
- They remain development dependencies so the repository can build declarations and run integration tests.
- The Arrow and DuckDB package subpaths document the peers that applications must install.
- `maplibre-gl` remains a normal dependency in the current release line because removing it would make existing root declarations and the prebuilt bundle unresolved for core consumers.
- Making MapLibre independently optional requires a versioned extraction of the MapLibre service types and runtime loader into a dedicated subpath or package; it is not performed as a silent maintenance change.

## Consequences

Core-only consumers no longer install Arrow, Parquet, or DuckDB-Wasm through the normal dependency graph. Consumers of `@mapseekai/emap/arrow` or `@mapseekai/emap/duckdb` must install the corresponding peers explicitly. MapLibre remains installed until a breaking, documented API boundary change can move it out of the root surface safely.
> Repository layout note (2026-09-14): source paths and test placement now follow [ADR 0010](0010-source-and-test-layout.md). The decision in this ADR remains valid; path examples should be interpreted through the current six-zone layout.
