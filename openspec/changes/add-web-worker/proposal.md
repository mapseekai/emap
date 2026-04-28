# Change: Add Web Worker offload for heavy mapshaper commands

## Why
Every dataset-replace command emap wraps (`clip` / `dissolve` / `union` / `mosaic` / `clean` / `simplify` / etc.) is a synchronous mapshaper call on the main thread. For a 100k-feature US Counties dataset, `dissolveLayer` takes 2–5 s; for a 500k-feature OSM administrative-boundary dataset, `unionLayers` can take **15+ seconds**. During that time the main thread is frozen — pan, zoom, render, click, even Cmd+Tab feels locked.

This is the single biggest perceived-quality issue in emap on real-world data and the reason every "is your library ready for production?" review will dock points until it's fixed.

The fix is structurally clear: run the mapshaper command in a Web Worker. mapshaper's bundle is already worker-safe (the only browser-global it touches, `window`, is guarded). The only hard part is the dataset round-trip — which we've already solved for the `.msx` snapshot work, via `mapshaper.internal.exportDatasetsToPack({compact: false})` ↔ `restoreSessionData`.

## What Changes
### Build
- New worker entry `src/worker/mapshaper-worker.ts`. Imports mapshaper, listens for messages, runs the command, posts the result back.
- `rollup.config.mjs` switches from a single config object to an array of two configs — main bundle + worker bundle (`dist/emap-worker.js` / `dist/emap-worker.mjs`).

### Runtime
- New `MapshaperWorkerPool` class (`src/core/mapshaper-worker-pool.ts`):
  - Lazy-instantiates a single `Worker` on first `run()` call.
  - Correlates request/response by id; pending map.
  - `run(cmd, packedDataset, inputFiles?): Promise<packedResult>`.
  - `destroy()` terminates and rejects in-flight requests.
- New `Emap` constructor options:
  - `useWorker?: boolean` — default `false`. When `true`, every `_runDatasetCommand` routes through the worker.
  - `workerUrl?: string` — path to `emap-worker.js`. Defaults to `'emap-worker.js'` resolved relative to the document.
- `_runDatasetCommand` new branch: when worker enabled, packs original via `exportDatasetsToPack({compact: false})`, calls the pool, unpacks result via `restoreSessionData`. Existing main-thread path unchanged when worker disabled.
- `Emap.remove()` calls `workerPool.destroy()`.

### Re-exports
- `MapshaperWorkerPool` and its options interface from `src/index.ts`.

### Type stubs
- `src/types/mapshaper.d.ts` declares `restoreSessionData`. `exportDatasetsToPack` is already declared (added in `add-multi-source-snapshot`).

## Impact
- Affected specs: `web-worker` (new capability)
- Affected code:
  - `rollup.config.mjs` — array-of-configs
  - `src/worker/mapshaper-worker.ts` — new
  - `src/core/mapshaper-worker-pool.ts` — new
  - `src/core/mapshaper-worker-pool.test.ts` — new (mock-Worker harness)
  - `src/map/map.ts` — constructor opts, `_runDatasetCommand` branch, `remove()` cleanup
  - `src/map/map.test.ts` — new tests for the routing behaviour
  - `src/types/mapshaper.d.ts` — declare `restoreSessionData`
  - `src/index.ts` — re-exports
  - `test/examples/web-worker.html` — demonstrates the flag

## Notes
- **Opt-in, not auto-detect**: v1 ships `useWorker: boolean`, not "auto-route based on dataset size". Auto-thresholding is a follow-up; the heuristic surface is non-trivial and we want users in control.
- **Single worker, sequential queue**: mapshaper inside one worker isn't reentrant. Concurrent `postMessage`s queue at the worker's event-loop level (browser handles serialization). One emap instance = one worker.
- **Cancellation**: mapshaper itself isn't cancellable mid-run, so the API doesn't expose a cancel hook. If a caller doesn't need the result they `.catch(() => {})`. A future `terminate()` could hard-kill the worker for "abandon and recreate" semantics.
- **Selection-level ops stay on main**: `translateSelected`, `rotateSelected`, vertex commands etc. mutate arc coordinates in place using mapshaper's editArcs APIs. They don't go through `_runDatasetCommand` and aren't worker candidates — their cost is per-vertex, far cheaper than overlay ops, and the round-trip overhead would dominate.
- **Round-trip cost**: `exportDatasetsToPack({compact: false})` plus `restoreSessionData` both run on main. For a 100k-feature dataset, each is ~50–100 ms. Worker payoff: only when the command itself takes longer than the round-trip overhead (so >300 ms or so). For tiny datasets `useWorker: true` is slightly slower than the main-thread path; that's OK because the user opted in.
- **Worker file deployment**: emap is consumed as a single IIFE today. Adding a worker file means consumers need to deploy two files. The README/example HTML will have to mention this; not a regression, just a new fact.
- **Test approach**: WorkerPool is unit-tested with a `MockWorker` class providing `postMessage` / `onmessage`. The actual worker bundle's correctness is validated manually via the example HTML — automated end-to-end testing of a real worker that loads mapshaper is out of scope (would need playwright or similar).
