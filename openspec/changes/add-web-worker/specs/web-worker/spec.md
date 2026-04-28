## ADDED Requirements

### Requirement: Worker bundle is built alongside the main bundle
The build SHALL produce `dist/emap-worker.js` in both dev and production builds, alongside `dist/emap-dev.js` / `dist/emap.js`.

#### Scenario: Dev build produces both files
- **WHEN** `npm run dev-build` completes
- **THEN** both `dist/emap-dev.js` and `dist/emap-worker.js` exist

#### Scenario: Prod build produces both files
- **WHEN** `npm run build` completes
- **THEN** both `dist/emap.js` and `dist/emap-worker.js` exist

### Requirement: MapshaperWorkerPool
The system SHALL provide a `MapshaperWorkerPool` class that runs mapshaper commands inside a Web Worker and correlates request/response by id.

#### Scenario: First run() spawns the worker
- **WHEN** `pool.run(cmd, packed)` is called for the first time on a fresh pool
- **THEN** exactly one `Worker` is constructed using the configured URL
- **AND** the worker receives a postMessage of shape `{ id, type: 'run', cmd, packed, inputFiles }`

#### Scenario: Subsequent run() reuses the worker
- **WHEN** `pool.run` is called twice in quick succession
- **THEN** only one `Worker` is constructed across both calls

#### Scenario: Successful response resolves the matching promise
- **WHEN** the worker posts `{ id, type: 'ok', packed }`
- **THEN** the promise returned by `run()` whose request had that `id` resolves with the `packed` value

#### Scenario: Error response rejects the matching promise
- **WHEN** the worker posts `{ id, type: 'error', message }`
- **THEN** the promise returned by `run()` whose request had that `id` rejects with an `Error` carrying that `message`

#### Scenario: Multiple in-flight requests are correlated by id
- **WHEN** two `run()` calls are made before either response arrives
- **AND** the worker responds to the second-issued one first
- **THEN** the second-issued promise resolves first, and the first-issued promise stays pending until its matching response

#### Scenario: Worker error event rejects every pending request
- **WHEN** the worker fires an `error` event (e.g. uncaught exception during command)
- **THEN** every pending `run()` promise rejects

#### Scenario: destroy() terminates the worker and rejects pending
- **WHEN** `pool.destroy()` is called with N in-flight requests
- **THEN** the worker's `terminate()` method is invoked
- **AND** all N pending promises reject with a "destroyed" error
- **AND** subsequent `run()` calls re-spawn a fresh worker

### Requirement: Emap useWorker option
`Emap` SHALL accept `useWorker?: boolean` and `workerUrl?: string` constructor options.

#### Scenario: Default — no worker
- **WHEN** `new Emap({ container })` is constructed without `useWorker`
- **THEN** no worker is spawned at construction time
- **AND** dataset-replace operations run on the main thread (existing behaviour)

#### Scenario: useWorker: true routes dataset-replace ops through worker
- **WHEN** `new Emap({ container, useWorker: true })` and a dataset-replace op (e.g. `dissolveLayer`) is awaited
- **THEN** the source's dataset is packed via `mapshaper.internal.exportDatasetsToPack({compact: false})`
- **AND** the packed payload + cmd is sent to `MapshaperWorkerPool.run`
- **AND** the response is unpacked via `mapshaper.internal.restoreSessionData` and applied via `setDataset`

#### Scenario: workerUrl override
- **WHEN** `new Emap({ container, useWorker: true, workerUrl: '/custom/path/emap-worker.js' })`
- **THEN** the underlying `Worker` is constructed with `'/custom/path/emap-worker.js'` as the URL

#### Scenario: Worker rejection surfaces as error event + false return
- **WHEN** the worker rejects a dataset-replace op (e.g. mapshaper threw inside the worker)
- **THEN** the operation's promise resolves with `false`
- **AND** an `error` event is fired carrying the rejection reason

#### Scenario: Selection-level ops stay on main thread
- **WHEN** `translateSelected` / `rotateSelected` / vertex commands are invoked with `useWorker: true`
- **THEN** they DO NOT route through the worker (they aren't dataset-replace ops)
- **AND** they execute synchronously as before

#### Scenario: Emap.remove() destroys the worker pool
- **WHEN** an `Emap` constructed with `useWorker: true` is `.remove()`ed
- **THEN** the underlying worker pool's `destroy()` is invoked
- **AND** any in-flight worker requests reject
