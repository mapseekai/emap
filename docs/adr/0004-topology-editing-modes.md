# ADR 0004: Explicit topology-editing modes

- Status: Accepted
- Date: 2026-08-26

## Context

Reshape, vertex batch editing, hole editing, and multipart editing share pointer and sketch behavior but have different topology rules. A single configurable mega-handler would make state transitions and validation difficult to reason about.

## Decision

- Keep mutually exclusive edit modes for reshape, vertex, ring, and part workflows.
- Reuse focused infrastructure such as normalized pointer events, snapping, sketch sessions, overlays, and geometry predicates.
- Plan changes before mutation and represent committed edits with `EditCommand` implementations.
- Preserve shared topology where the operation requires shared arcs; split shared topology only through explicit commands.
- Validate closure, area, intersections, containment, part count, and path degeneration before committing.
- Keep temporary sketch and hover state outside source datasets and history.

## Consequences

- Shared interaction behavior is implemented once without combining unrelated operation semantics.
- Switching edit modes has a predictable cleanup boundary.
- Validation errors occur before partial source mutation.
- New editing tools should reuse the shared primitives but still define their own explicit mode and operation contract.

## Verification

Handler, command, topology, undo, and example tests cover reshape, multi-vertex movement and deletion, add/delete/fill ring, and add/delete part workflows.
