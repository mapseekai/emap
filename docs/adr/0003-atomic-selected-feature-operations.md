# ADR 0003: Atomic selected-feature operations

- Status: Accepted
- Date: 2026-08-24

## Context

Merging and splitting selected path features changes geometry, attributes, feature counts, selection, caches, and undo history together. Applying those changes independently can leave partial edits or select feature IDs that no longer exist.

## Decision

- Validate that all selected targets belong to the required source and layer before mutation.
- Perform mapshaper geometry work on a copied or prepared dataset through `MapshaperAdapter`.
- Preserve unselected geometry and attributes exactly.
- For merge, choose one selected feature as the explicit attribute source and replace the selected set with the geometric union.
- For split, calculate effective cuts, reject degenerate results, and replace each target with its valid output pieces.
- Commit dataset and selection changes as one undoable command after stale-operation checks pass.
- Publish source, selection, and history notifications only after a complete commit.

## Consequences

- A failed operation leaves the live dataset unchanged.
- Undo and redo restore geometry and selection together.
- Feature IDs may change after replacement, so callers must use the returned result selection instead of retaining old positional IDs.
- Cross-source selected operations require an explicit higher-level workflow.

## Verification

Tests cover geometry results, attribute choice, untouched neighbours, invalid cutters, stale operations, selection replacement, history round trips, and runnable merge and split examples.
