# ADR 0005: Attribute-driven fill styling

- Status: Accepted
- Date: 2026-09-02
- Supersedes:
  - `docs/superpowers/specs/2026-09-02-attribute-driven-styling-design.md`
  - `docs/superpowers/plans/2026-09-02-attribute-styling-phase1-fill.md`

## Context

Geometry edits and attribute edits invalidate different rendering work. Recomputing attribute styles after every vertex movement is wasteful, while failing to invalidate after an attribute command leaves stale colors. Per-feature Canvas state changes also scale poorly for large layers.

## Decision

- Datasets carry independent monotonic `editVersion` and `attributeVersion` counters.
- Commands bump the counter that matches their actual effect; stale-operation checks compare both counters.
- `classifyFeatures` computes authoritative breaks and counts, then bakes explicit colors into a field through mapshaper.
- Fill paint supports a deliberately small, validated expression subset without `eval`.
- `StyleResolver` caches by expression fingerprint, dataset identity, attribute version, and layer ID.
- Resolved colors are grouped into fill buckets so Canvas changes fill state once per bucket rather than once per feature.
- Record-scale classification participates in Worker routing using record count rather than arc vertex count.
- Classification results return defensive snapshots of caller-provided arrays.

## Consequences

Attribute styling remains opt-in and existing static paint behavior is unchanged. Supporting additional paint properties requires an explicit cache, validation, bucket, and invalidation design rather than extending the expression language implicitly.
