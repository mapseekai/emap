# ADR 0004: Reshape, ring, and multipart editing

- Status: Accepted
- Date: 2026-08-26
- Supersedes:
  - `docs/superpowers/specs/2026-08-26-reshape-vertex-batch-ring-part-design.md`
  - `docs/superpowers/plans/2026-08-26-reshape-vertex-batch-ring-part.md`

## Context

Reshaping paths, moving multiple vertices, adding or deleting holes, filling holes, and adding or deleting parts all mutate topology differently. A generic “replace coordinates” command cannot safely preserve shared arcs, minimum geometry cardinality, attributes, or selection state.

## Decision

- Each operation first builds a validated direct-edit plan against the current dataset version.
- Live mutation is performed by an `EditCommand` that owns undo, redo, version bumps, and publication.
- Shared topology is preserved or explicitly split according to the operation contract.
- Ring operations validate containment, winding, self-intersection, and contact with existing boundaries.
- Part operations validate target selection, geometry type, overlap, and minimum vertex requirements.
- Selection-free operations locate their target from the supplied point; selection-driven operations require an unambiguous compatible selection.
- Multi-step user gestures are coalesced into one history entry.

## Consequences

The handlers remain thin interaction state machines while commands own reversible mutation. New editing tools must define their topology and validation contract explicitly rather than routing through a generic coordinate patch.
> Repository layout note (2026-09-14): source paths and test placement now follow [ADR 0010](0010-source-and-test-layout.md). The decision in this ADR remains valid; path examples should be interpreted through the current six-zone layout.
