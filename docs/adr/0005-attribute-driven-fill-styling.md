# ADR 0005: Attribute-driven fill styling

- Status: Accepted
- Date: 2026-09-02

## Context

Users need choropleth and categorical fill styling without replacing the existing static Canvas paint path or embedding a full MapLibre expression engine. Attribute edits must invalidate styles, while geometry-only edits should not force a full style rebuild.

## Decision

- Keep static scalar paint as the default and highest-priority path.
- Make baked mapshaper fields available only through explicit `styleSource: 'mapshaper'` configuration.
- Support a small validated expression subset for `fill-color`: `get`, `match`, `step`, linear `interpolate`, comparisons, and boolean composition.
- Track attribute changes with a dedicated monotonic `attributeVersion` in addition to `editVersion`.
- Cache resolved styles by layer, expression fingerprint, dataset identity, and attribute version.
- Resolve per-feature colors once, group feature IDs into color buckets, and let `CanvasPainter` draw each bucket in one pass.
- Quantize static color interpolation to bound bucket cardinality and emit a warning when dynamic results still exceed the expected limit.
- Compute classification breaks and counts in emap, then pass explicit values to mapshaper for field baking.

## Consequences

- Existing static layers retain their previous behavior and fast path.
- Attribute mutations reliably invalidate cached styles.
- Geometry-only editing does not recalculate fill classification.
- The expression surface remains intentionally smaller than MapLibre Style Specification.
- Classification results are returned as stable snapshots rather than references to caller-owned arrays.

## Verification

Tests cover expression validation, classification algorithms, cache invalidation, bucket rendering, worker routing by record count, end-to-end classified fill rendering, and large-record benchmarks.
