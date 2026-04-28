# Change: Web Worker improvements — cancel / auto-threshold / progress events

## Why
The initial Web Worker offload (`add-web-worker`) is opt-in-or-not: every dataset-replace op routes through the worker when `useWorker: true`, otherwise none do. Three rough edges remain:

1. **Stuck jobs can't be abandoned.** mapshaper isn't interruptible mid-run; if the user fires a heavy union by accident on a 500k-feature dataset, they have no choice but to wait or close the page.
2. **Round-trip overhead dominates on small datasets.** `useWorker: true` adds ~50–100 ms on each side for pack/unpack of a 100k-feature dataset; on a 1k-feature dataset that's a 50 % slowdown. Power users with mixed dataset sizes want "use worker only when it pays off".
3. **No UI feedback during worker runs.** Callers know the operation started (they just `await`), but cross-cutting UI like "show a spinner while ANY heavy op runs" requires per-call wiring. An event hook would make this trivial.

## What Changes

### 1. Cancellation — terminate-and-recreate
- Add `MapshaperWorkerPool.cancelAll(): void`. Hard-kills the worker, rejects every pending request with a `'cancelled'` error, leaves the pool ready for `run()` to spawn a fresh worker.
- Add `Emap.cancelWorkerJobs(): void` that delegates to `_workerPool?.cancelAll()`. No-op when no pool exists.
- mapshaper itself isn't cancellable mid-command, so this is the only sound semantics: terminate the entire worker (losing other queued jobs as collateral). Per-request cancellation is left for a future iteration.

### 2. Auto-thresholding — `useWorker: 'auto'`
- Widen `MapOptions.useWorker` from `boolean` to `boolean | 'auto'`.
- New `MapOptions.workerThreshold?: number` (default `50_000`). Vertex-count threshold above which `'auto'` mode routes through the worker.
- New `_runDatasetCommand` decision:
  - `useWorker: false` (default) → always main-thread.
  - `useWorker: true` → always worker.
  - `useWorker: 'auto'` → check `dataset.arcs?.getPointCount?.() ?? 0`; if `>= workerThreshold`, worker; else main.
- Construction always builds the pool when `useWorker !== false`, so 'auto' mode pays the lazy-spawn cost only on first worker run, not at construction.
- Vertex count is the right heuristic, not feature count: a 500-feature OSM admin layer with 2M vertices wants the worker; a 100k-feature point-cloud with 100k vertices doesn't.

### 3. Progress events
- Emit `workerjobstart` and `workerjobend` events on the `Emap` instance whenever a dataset-replace op routes through the worker.
  - `workerjobstart`: `{ id, cmd, label, datasetVertexCount }`
  - `workerjobend`: `{ id, ok, durationMs, errorMessage? }`
- Main-thread runs do not fire these events (the UI couldn't update during a sync block anyway). Documented in the spec so callers don't expect symmetry.
- Each job gets a unique id so multi-job UIs can correlate start/end pairs.

## Impact
- Affected specs: `web-worker` (modified — three new requirements added)
- Affected code:
  - `src/core/mapshaper-worker-pool.ts` — add `cancelAll()`
  - `src/core/mapshaper-worker-pool.test.ts` — add cancel tests
  - `src/map/map.ts` — widen useWorker type, add workerThreshold, cancelWorkerJobs(), worker-vs-main routing decision, fire events
  - `src/map/map.test.ts` — add tests for auto-threshold, events, cancel
  - `test/examples/web-worker.html` — add 'auto' mode toggle, threshold input, "abort" button, live event log
- Backward compatible:
  - `useWorker: true` semantics unchanged (still always-worker).
  - `useWorker: false` (default) semantics unchanged.
  - The new `'auto'` value and `workerThreshold` option are additive.
  - Events fire only when worker path runs; existing callers don't subscribe → no behavioural change.

## Notes
- **Why not auto-detect threshold from prior run timings?** A learned threshold would adapt better but adds complexity (per-command stats tracking, cold-start problem, regression risk). Static vertex-count threshold is good-enough for v2; adaptive thresholding is a future iteration.
- **Why no per-request cancellation?** A `cancel(id)` API is misleading — mapshaper inside the worker is uninterruptible, so we'd just hide the result and let the worker keep computing wastefully. `cancelAll()` is honest: it actually frees the CPU.
- **Job id correlation**: the same id is shared between the worker pool's correlation id and the events. So a user who saves the worker pool's request id from `workerjobstart` could correlate with internal logging if they ever need to.
- **Selection-level events**: not in scope. The events fire only for dataset-replace ops (the ones routing through `_runDatasetCommand`). Selection-level ops (translate, rotate, vertex commands) are sync and need no progress hook.
