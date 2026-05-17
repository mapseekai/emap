# TODO

Deferred work from the `@zwishing/emap` integration-notes triage
(2026-05-17). Items #9 (awaitable `setData`), A (typed `getLayers`), and
B (`source-layer` examples) are already done — see CHANGELOG `[Unreleased]`.

Both items below are new-capability / breaking-architecture changes, so per
`CLAUDE.md` they must go through an **OpenSpec proposal before coding** — do
not implement directly.

---

## C — Sandboxed / `'literal'` expression policy

**Status:** deferred — needs OpenSpec proposal.

`ExpressionEvaluationPolicy` (`src/map/types.ts:18`) is today a binary
`'trusted' | 'disabled'`. Consumers that want expression-driven ops
(`applyExpression`, `filterFeatures`, `where=` / `calc=`) on untrusted data
have no safe middle ground — it's all-or-nothing.

- **Want:** a third value (e.g. `'literal'` / `'sandboxed'`) that allows a
  restricted, non-arbitrary-eval subset.
- **Touch points:** `src/map/types.ts`, the expression gate in the ops layer,
  `SECURITY.md`.
- **Risk:** security-sensitive — the sandbox boundary must be specified and
  reviewed before any code. Additive enum value (non-breaking) but the
  evaluation semantics are the hard part.
- **Next step:** `openspec` proposal under `openspec/changes/`.

## D — Slim / core bundle (externalize mapshaper)

**Status:** deferred — needs OpenSpec proposal.

`@zwishing/emap` inlines mapshaper (~2.1 MB min / ~645 kB gzip) into
`dist/emap.mjs` unconditionally. Plan A only *split* the vendor chunk; it is
still shipped to every consumer even those needing only rendering/attribute
editing.

- **Want:** either (a) a `@zwishing/emap/core` subpath that externalizes
  mapshaper as an optional peer (`peerDependenciesMeta.optional`), or
  (b) a separate `@zwishing/emap-lite` package for render-only use.
- **Touch points:** `rollup.config.mjs`, `package.json` (`exports`,
  `peerDependencies`), the mapshaper-vendor build, README.
- **Risk:** breaking build/exports architecture; interacts with the
  worker-vendor and Plan-A self-containment guarantees.
- **Next step:** `openspec` proposal under `openspec/changes/`; decide (a)
  vs (b) in the proposal.
