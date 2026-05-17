# emap Engineering Backlog

Items deliberately deferred from the review-driven refactor (`/root/.claude/plans/cozy-frolicking-boole.md`).
Each entry documents:

- **What** the change does
- **Why now's not the right time** (the trigger condition that would
  reverse the decision)
- **Sketch** of the implementation, so the next person doesn't start
  from a blank page

---

## PR-22b — Incremental Flatbush spatial index

**What.** Today, `FeatureQuery._indexCache` keys on `(sourceId, layerIndex,
shapeCount, arcCount, dataset.editVersion)`. Any in-place edit (vertex
move, translate, shared-arc split) bumps `editVersion` and the entire
Flatbush is rebuilt on the next query. For a 100k-feature layer the
rebuild cost is sub-second; for 1M-feature layers under sustained drag
load it can drop FPS.

**Why deferred.**

- Flatbush is intentionally immutable — its packed-bbox layout is
  what makes its query path 5-10× faster than tree alternatives.
  An "incremental Flatbush" requires a wrapper, not a patch.
- We don't currently have a benchmark that shows the rebuild cost
  hurting a real user workflow. The default `editVersion`-keyed cache
  is correct; the question is purely throughput.
- PR-12 already cut the routing cost for these ops, and PR-13 made
  DisplayArcs LOD rebuild lazy. The marginal value of an
  incremental index is smaller now than when this was scoped.

**Reverse trigger.** Any of:
- A profile that shows `_getOrBuildIndex` taking > 16 ms/frame on a
  realistic dataset.
- A user-visible drag-FPS regression after a typical edit session.
- A new feature (live geofencing? ad-hoc spatial joins per drag step?)
  that hammers the index every frame.

**Implementation sketch.**

1. Wrap Flatbush with a `LiveSpatialIndex { main: Flatbush, dirty:
   Map<id, BBox> }`.
2. `update(id, bbox)` writes to `dirty`, NOT main; `delete(id)` adds
   a tombstone to `dirty`.
3. `query(box)` calls `main.search(box)` → filter out ids tombstoned
   in dirty → union with linear scan over `dirty` entries that
   overlap the query.
4. When `dirty.size > main.size * 0.10` (or a configurable
   threshold), rebuild `main` from the union and clear `dirty`.
5. The existing `editVersion` flow stays — but instead of
   invalidating the whole index, individual command `do/undo`
   pushes their bbox delta into `dirty` via a new
   `FeatureQuery.markFeatureBBoxDirty(sourceId, layerId, id, bbox)`
   API.

The hardest part is computing the per-feature bbox AFTER an in-place
edit cheaply. For point features the new coord is the bbox; for path
features it's the union over arc bboxes referenced by the shape, and
arc bboxes are already maintained by mapshaper's `updateArcBounds`.

**Risk.** Wrong dirty-bucket merge breaks query correctness silently
(returns wrong feature ids). Needs a property-test layer comparing
`LiveSpatialIndex` against a brute-force linear scan over the live
shapes.

---

## PR-22c — Streaming large-file import

**What.** `TopologySource.setData(url)` currently does
`fetch().arrayBuffer()` and hands the whole `Uint8Array` to mapshaper
in one shot. A 1+ GB shapefile or large geopackage triggers OOM on
desktop browsers (heap is roughly 4 GB on Chrome) and immediate
failure on mobile (~500 MB).

**Why deferred.**

- mapshaper's import path doesn't accept a stream — `runImport(cmd,
  inputFiles)` requires the whole bytes object before parseCommands
  runs. Working around this means either:
    a. Bypassing mapshaper's importer for the streaming case (requires
       reimplementing shapefile / geopackage parsing in the worker).
    b. Patching mapshaper-vendor to accept a chunked input — upstream
       dependency, blocked.
- No reported user has hit this. The current `DEFAULT_ZIP_LIMITS`
  defaults to 200 MB which already saves us from accidental OOMs in
  the ZIP path; non-zip large files just fail.
- The mitigation that DOES make sense — pre-flight HEAD check +
  early reject — is small enough to do separately and is
  tracked at the bottom of this doc as a quick win.

**Reverse trigger.** Any of:
- A specific user workload routinely importing > 500 MB single
  files. (Multi-file imports already chunk per file.)
- A measurable OOM rate in production analytics.
- mapshaper upstream gaining a streaming import API.

**Implementation sketch (when triggered).**

The smallest tractable variant:

1. Add `TopologySourceOptions.maxBytes?` (default `null` = no
   limit) and a HEAD request before the fetch:

       const head = await fetch(url, { method: 'HEAD' });
       const len = +head.headers.get('content-length') || 0;
       if (len > maxBytes) throw new Error('TopologySource: payload exceeds maxBytes');

2. For the fetch itself, force the source through the worker
   regardless of `useWorker` mode when `len > workerThreshold`. The
   worker terminates after each load, so its arena gets reclaimed
   even if mapshaper's parse path doesn't free intermediate buffers
   eagerly.

3. Document that streaming-true is not on the table without
   upstream changes.

The worker-routing path also needs a "load this URL DIRECTLY in the
worker, not via runOnDataset" code path so the bytes never land on
the main thread.

**Risk.** A worker that OOMs takes its own thread down but the main
thread survives — better than the current crash-the-tab outcome.
The main complication is shimming `fetch` inside the worker (some
bundlers strip it).

---

## Quick wins not yet pulled

- **L3** — `EditHistory` ring buffer instead of `Array.shift` on
  capacity. Only matters when `maxSize` is configured >> 200; trivial
  but unmotivated.
- Reverting `MapOptions.workerRouting` to opt-out semantics if real
  apps consistently disagree with the default routing decision tree.

## Recently landed

- **PR-7** — every op extracted into its own file under
  `src/map/ops/`. Landed in commit `f80d67d`.
- **PR-4b** — ops now build `ParsedCommand[]` instead of CLI strings;
  worker / runner / OpContext gained parallel parsed paths;
  `mergeSelected` no longer touches a shell-style command. Landed in
  commit `cf17d3d`.

---

## Authoring conventions

When pulling from this backlog into a real PR, replace the entry
above with a one-line redirect ("→ landed in PR-22b, commit
`<sha>`") and copy the commit message into the matching plan
section. Don't delete the rationale from history — the "why now"
text is useful when re-evaluating.

---

## DX Phase 1 follow-up — `interactive:false` not sticky vs edit-mode

**Found:** 2026-05-17 final review of `feat/dx-phase1-handler-registry`.

`Emap`'s edit-state callback (`src/map/map.ts`, the `editmodechange`
listener) calls `this._dragPan?.enable()` whenever edit mode returns to
`'none'`. On a map constructed with `interactive: false`, an edit-mode
round-trip therefore re-enables pan, overriding the user's intent.

- **Not a regression** vs. pre-Phase-1 master (where `interactive` was a
  dead no-op, so pan was never disabled at all). Impact is near-zero
  (`interactive:false` maps rarely enter edit mode).
- **Trigger to re-evaluate:** Phase 2 introduces the single-DOM
  arbitration layer + selection handlers. That layer should own a single
  source of truth for "is interaction X currently permitted" so transient
  consumers (edit mode, vertex editing) can suspend/restore without
  clobbering the user's construct-time `interactive:false` choice.
- **Fix shape (Phase 2):** edit-mode should request a *scoped* pan
  suspend/restore, not unconditional `enable()`, honoring the base
  enabled-state the handler was configured with.
