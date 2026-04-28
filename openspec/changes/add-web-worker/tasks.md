## 1. Build
- [x] 1.1 Create `src/worker/mapshaper-worker.ts`. Imports `mapshaper`, listens on `self.onmessage`, expects `{ id, type: 'run', cmd, packed, inputFiles? }`, runs the mapshaper pipeline, posts back `{ id, type: 'ok', packed }` or `{ id, type: 'error', message }`.
- [x] 1.2 Switch `rollup.config.mjs` to an array of two configs (main + worker). Worker output: `dist/emap-worker.js` (dev) / `dist/emap-worker.js` minified (prod). IIFE format with no global name (worker doesn't need one). Same plugin chain.

## 2. Runtime
- [x] 2.1 New `src/core/mapshaper-worker-pool.ts`:
  - Class `MapshaperWorkerPool { constructor(opts: { workerUrl: string }) }`.
  - `run(cmd: string, packed: PackedSession, inputFiles?: Record<string, Uint8Array | string>): Promise<PackedSession>`.
  - Lazy worker init on first `run()`.
  - `destroy()` terminates and rejects pending.
- [x] 2.2 In `src/map/map.ts`:
  - Add `useWorker?: boolean` and `workerUrl?: string` to the `EmapOptions` interface.
  - Lazy-construct a `MapshaperWorkerPool` when `useWorker` is true (default URL: `'emap-worker.js'` resolved against `document.baseURI`).
  - Modify `_runDatasetCommand`: when pool exists, pack via `exportDatasetsToPack({compact: false})`, call `pool.run`, unpack via `restoreSessionData`. Otherwise unchanged.
  - `remove()` calls `pool.destroy()`.
- [x] 2.3 Re-export `MapshaperWorkerPool` and `MapshaperWorkerPoolOptions` from `src/index.ts`.
- [x] 2.4 Declare `internal.restoreSessionData(obj) => Promise<{ datasets: MapshaperDataset[];[k: string]: unknown }>` in `src/types/mapshaper.d.ts`.

## 3. Tests
- [x] 3.1 `src/core/mapshaper-worker-pool.test.ts`:
  - MockWorker class collects posted messages and exposes a `respond(id, type, payload)` helper.
  - `run()` posts the right message shape and resolves when the matching response arrives.
  - Multiple in-flight requests get correlated correctly by `id`.
  - Worker error → all pending reject.
  - `destroy()` terminates worker and rejects pending.
- [x] 3.2 `src/map/map.test.ts`: add tests for `useWorker` routing.
  - Mocked `_workerPool.run`; assert `_runDatasetCommand` calls it with the packed dataset + cmd + inputFiles.
  - Assert dataset is restored via `restoreSessionData` and applied via `setDataset`.
  - Worker rejection → fires `error` event and returns `false`.

## 4. Example
- [x] 4.1 `test/examples/web-worker.html`:
  - Toggle to enable `useWorker`.
  - "Run heavy command" button performs `dissolveLayer` (or whatever lands first).
  - Status line shows main-thread freeze indicator: a CSS animation that pauses on freeze. Demonstrates that with-worker keeps the animation smooth.

## 5. Validation
- [x] 5.1 `npm run build` produces both `dist/emap.js` and `dist/emap-worker.js`.
- [x] 5.2 `npm test` — all tests pass.
