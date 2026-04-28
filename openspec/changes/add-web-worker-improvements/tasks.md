## 1. Cancellation
- [x] 1.1 Add `MapshaperWorkerPool.cancelAll(): void`. Terminates the worker (if spawned) and rejects every pending request with `Error('MapshaperWorkerPool: cancelled')`. Pool stays usable — the next `run()` spawns a fresh worker.
- [x] 1.2 Add `Emap.cancelWorkerJobs(): void` that delegates to `_workerPool?.cancelAll()`. No-op when no pool exists.

## 2. Auto-thresholding
- [x] 2.1 Widen `MapOptions.useWorker` to `boolean | 'auto'`.
- [x] 2.2 Add `MapOptions.workerThreshold?: number` (default `50_000`). Stored on the Emap instance.
- [x] 2.3 In `_runDatasetCommand`, replace the `if (this._workerPool)` branch with:
  - `useWorker: false` → main-thread (no pool was constructed).
  - `useWorker: true` → always worker (existing path).
  - `useWorker: 'auto'` → if `dataset.arcs?.getPointCount?.() ?? 0 >= workerThreshold`, worker; else main.
- [x] 2.4 Track the resolved `useWorker` value and threshold on the Emap instance so the routing decision is testable.

## 3. Progress events
- [x] 3.1 Emit `workerjobstart` event before the worker `run()` call: `{ id, cmd, label, datasetVertexCount }`.
- [x] 3.2 Emit `workerjobend` event after worker `run()` resolves or rejects: `{ id, ok, durationMs, errorMessage? }`.
- [x] 3.3 Use the worker pool's correlation id for the event id (single source of truth). Add a way for the pool to surface that id pre-postMessage — either return `{ id, promise }` from a new internal method, or use a callback.

## 4. Tests
- [x] 4.1 In `src/core/mapshaper-worker-pool.test.ts`:
  - `cancelAll()` terminates the worker and rejects every pending request.
  - `cancelAll()` on an unspawned pool is a no-op.
  - `run()` after `cancelAll()` spawns a fresh worker.
- [x] 4.2 In `src/map/map.test.ts` — auto-thresholding:
  - `useWorker: 'auto'` with vertex count under threshold → main-thread (no `pool.run` call).
  - `useWorker: 'auto'` with vertex count over threshold → worker path.
  - Custom `workerThreshold` overrides the default.
  - Datasets without `arcs.getPointCount` resolve to vertex count `0` and route to main-thread.
- [x] 4.3 In `src/map/map.test.ts` — events:
  - `workerjobstart` fires before `pool.run`, `workerjobend` fires after.
  - Event payload shape (id, cmd, label, datasetVertexCount, durationMs, ok).
  - On rejection, `workerjobend.ok === false` and `errorMessage` is populated.
  - Main-thread runs do NOT fire these events.
- [x] 4.4 In `src/map/map.test.ts` — cancel:
  - `cancelWorkerJobs()` calls `pool.cancelAll()`.
  - With no pool, `cancelWorkerJobs()` is a safe no-op.

## 5. Example
- [x] 5.1 Update `test/examples/web-worker.html`:
  - Worker mode select: `off` / `on` / `auto`.
  - Threshold input visible when `auto` selected.
  - "Abort" button calling `cancelWorkerJobs()`.
  - Live event log subscribing to `workerjobstart` / `workerjobend`.

## 6. Validation
- [x] 6.1 `npm test` — all tests pass.
