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

---

## E - Incremental Flatbush spatial index

**Status:** deferred - not implemented.

`FeatureQuery` still uses a full immutable Flatbush cache keyed by `sourceId`,
layer index, shape count, arc count, and `dataset.editVersion`. There is no
`LiveSpatialIndex` wrapper or `markFeatureBBoxDirty(...)` API yet.

- **Trigger:** profile `_getOrBuildIndex` above 16 ms/frame, drag-FPS
  regression on realistic data, or a feature that queries the index every
  frame.
- **Next step:** benchmark the current rebuild cost, then design a dirty-bbox
  wrapper that is property-tested against brute-force scans.

## F - Large-file import guard / streaming import

**Status:** deferred - not implemented.

`TopologySource.setData(url)` still fetches the URL and calls
`response.arrayBuffer()` before import. There is no HEAD preflight,
source-level `maxBytes` option, or worker-side direct URL load path. Current
`maxBytes` coverage is limited to ZIP extraction limits.

- **Trigger:** real imports above 500 MB, OOM telemetry, or a mapshaper
  streaming import API.
- **Next step:** implement the smaller preflight guard first: optional source
  `maxBytes`, HEAD `content-length` check, and early validation error. True
  streaming remains blocked on mapshaper/upstream importer support.

## G - EditHistory ring buffer eviction

**Status:** deferred - not implemented.

`EditHistory.push(...)` still uses `_undoStack.push(...)` plus
`_undoStack.shift()` when `maxSize` is exceeded.

- **Trigger:** `maxSize` routinely configured much larger than the default 200
  or history eviction appears in profiles.
- **Next step:** replace the undo-stack eviction path with a ring buffer while
  preserving undo/redo/capture/merge semantics.

## H - Worker routing default semantics review

**Status:** conditional follow-up - not implemented as a behavior change.

`MapOptions` still defaults `useWorker` / `workerMode` to `false`, while custom
`workerRouting` only participates once worker execution is enabled. The backlog
item is conditional: revisit opt-out semantics only if real apps disagree with
the current default routing decision tree.

- **Trigger:** repeated integration feedback that the default should route
  eligible operations through workers unless explicitly disabled.
- **Next step:** write a compatibility note and decide whether the default can
  change without surprising existing browser consumers.
