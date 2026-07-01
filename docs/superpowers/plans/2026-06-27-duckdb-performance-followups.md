# DuckDB-Wasm Performance Follow-ups

Backlog captured from the 2026-06-27 DuckDB integration review. These are
**performance** items only; the security/robustness findings from the same
review (function-name allowlist, error-classification consistency, dependency
pin, CSP/COOP-COEP docs) were already implemented.

> **Why these are not yet implemented.** Each item's payoff can only be
> confirmed with a real DuckDB-Wasm benchmark — large input datasets executed
> through the actual WASM runtime + spatial extension (network access to the
> jsDelivr bundle / extension repository, or a self-hosted equivalent). Without
> that measurement, adding the code risks duplicating optimizations DuckDB
> already performs, i.e. speculative complexity. Do **not** land any of these
> without a before/after benchmark.

## P1 — Relation ops are an unindexed spatial join (O(N×M)) — HIGH for large data

- **Where:** `src/duckdb/duckdb-sql.ts` — `buildRelationFilterSql`,
  `buildRelationAttributeSql`, `relationPredicate`.
- **Mechanism:** DuckDB decorrelates the `EXISTS (...)` into a semi-join and the
  scalar `SELECT MIN(ST_Distance(...))` into a join+aggregate — it does **not**
  re-run the subquery per row. The cost is that the spatial predicate
  (`ST_Intersects` / `ST_Distance`) cannot be hashed/merged and has no index, so
  the join degrades to a nested loop: input × mask exact comparisons.
- **Do NOT** rewrite the `filter`-mode `EXISTS` as an `INNER JOIN` — that fans
  out each input row once per matching mask feature (semantic change). The
  semi-join shape is correct.
- **Proposed approach:** build an `RTREE` index on the mask geometry (DuckDB
  spatial supports it) and/or a bounding-box prefilter (`toArrowTable` can emit a
  bbox struct column via `bboxColumn`; add `i.bbox && m.bbox` to the predicate
  before the exact test). Bbox prefilter is correctness-preserving by
  construction.
- **Verification / acceptance:**
  1. Correctness: relation integration tests (`duckdb-relation.integration.test.ts`)
     return identical row sets before and after.
  2. Performance: benchmark intersects/distance on a large input×mask pair
     (e.g. ≥10k × ≥10k features); record wall-clock before/after and confirm a
     net speedup. If no speedup (DuckDB already prefilters), do not land.

## P2 — Full Arrow/WKB round-trip per op; chained ops re-serialize — MEDIUM

- **Where:** `processGeometryWithDuckDb` / `processAttributeWithDuckDb` /
  `processRelationWithDuckDb` (each `toArrowTable(encoding:'wkb')` → insert →
  query → read back → `fromArrowTable`, then `DROP TABLE`).
- **Approach:** for a multi-op workflow, keep the data resident in DuckDB across
  ops (reuse one connection/registered table; read back only once at the end)
  instead of insert/drop per op. Requires a chained-op surface that does not
  exist today — design before building.
- **Verification:** benchmark a 3+ op chain (e.g. buffer → simplify → area) and
  confirm reduced total serialization time; unit results unchanged.

## P3 — Forced WKB encoding adds encode/decode CPU — MEDIUM/LOW

- **Where:** all DuckDB ops pass `encoding: 'wkb'`; `dataset-to-table.ts` also
  has a native GeoArrow path (`buildNativeColumn`).
- **Approach:** evaluate whether `insertArrowTable` accepts GeoArrow native
  columns directly so the in-process round trip can skip WKB encode/decode.
- **Verification:** confirm duckdb-wasm accepts the native column for the
  spatial functions used; benchmark encode/decode CPU before/after.

## P4 — Attribute columns materialized as JS arrays — LOW

- **Where:** `dataset-to-table.ts` — `buildAttributeColumn`
  (`new Array(rowCount)` + `vectorFromArray`). Pre-existing in the formats layer,
  triggered on every DuckDB op.
- **Approach:** stream into typed builders where possible to cut peak memory on
  wide attribute tables × many rows.
- **Verification:** measure peak memory on a wide-table dataset before/after;
  unit results unchanged.
