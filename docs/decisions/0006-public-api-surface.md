# ADR 0006: Root public API surface

- Status: Accepted
- Date: 2026-09-04

## Context

`src/index.ts` accumulated a large but already published set of editing, rendering, source, compatibility, and advanced mapshaper types. Removing names solely to shorten the entry point would be a breaking change and would move complexity to consumers. At the same time, wildcard exports and accidental exports from internal implementation files make the surface grow without review.

## Decision

- The root entry point uses explicit named exports only.
- Default exports, namespace exports, wildcard exports, underscore-prefixed names, and symbols listed by TypeDoc as intentionally internal are rejected by `api:check-surface`.
- Existing documented exports remain compatible during the current release line.
- Optional Arrow and DuckDB capabilities remain under their package subpaths.
- New low-level implementation types require an explicit documentation association before they may enter the root API.
- Future breaking removals must be grouped into a versioned migration rather than mixed into maintenance refactors.

## Consequences

The current root file remains intentionally explicit and reviewable instead of being mechanically shortened. CI prevents accidental expansion, while a future major release can move compatibility-only types to a dedicated subpath with a migration guide.
> Repository layout note (2026-09-14): source paths and test placement now follow [ADR 0010](0010-source-and-test-layout.md). The decision in this ADR remains valid; path examples should be interpreted through the current six-zone layout.
