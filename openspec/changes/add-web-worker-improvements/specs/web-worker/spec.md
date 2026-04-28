## ADDED Requirements

### Requirement: MapshaperWorkerPool.cancelAll
The `MapshaperWorkerPool` SHALL provide a `cancelAll(): void` method that hard-kills the worker (if spawned) and rejects every pending request, leaving the pool ready to accept new `run()` calls.

#### Scenario: Cancels in-flight requests
- **WHEN** `cancelAll()` is called with N pending `run()` promises
- **THEN** all N promises reject with an Error whose message contains `'cancelled'`
- **AND** the underlying worker's `terminate()` is invoked

#### Scenario: Spawns a fresh worker on next run()
- **WHEN** `cancelAll()` is called and then `run(...)` is called
- **THEN** a new `Worker` is constructed
- **AND** the new request is posted to the new worker

#### Scenario: cancelAll on an unspawned pool is a no-op
- **WHEN** `cancelAll()` is called before any `run()` (no worker yet)
- **THEN** no error is raised
- **AND** subsequent `run()` calls work normally

#### Scenario: Distinct from destroy()
- **WHEN** `cancelAll()` (rather than `destroy()`) is called
- **THEN** subsequent `run()` calls succeed (the pool is NOT destroyed)

### Requirement: Emap.cancelWorkerJobs
`Emap` SHALL provide a `cancelWorkerJobs(): void` method that delegates to the underlying worker pool's `cancelAll()`. No-op when no worker pool exists (`useWorker: false`).

#### Scenario: Calls cancelAll on the pool
- **WHEN** `Emap.cancelWorkerJobs()` is called on an instance with `useWorker: true`
- **THEN** the underlying `MapshaperWorkerPool.cancelAll()` is invoked

#### Scenario: Safe no-op without a pool
- **WHEN** `Emap.cancelWorkerJobs()` is called on an instance with `useWorker: false`
- **THEN** no error is raised
- **AND** no underlying pool method is invoked

### Requirement: Auto-threshold worker routing
`Emap` SHALL accept `useWorker: 'auto'` as a third value alongside `true` / `false`, plus a `workerThreshold?: number` option (default `50000`). In `'auto'` mode, dataset-replace operations route through the worker only when the source dataset's arc vertex count meets or exceeds the threshold.

#### Scenario: Default behaviour unchanged
- **WHEN** `useWorker` is not specified or is `false`
- **THEN** all dataset-replace ops run on the main thread (existing behaviour)

#### Scenario: useWorker: true forces worker
- **WHEN** `useWorker: true`
- **THEN** every dataset-replace op routes through the worker (existing behaviour)

#### Scenario: 'auto' routes small datasets to main thread
- **WHEN** `useWorker: 'auto'` and the source dataset's `arcs.getPointCount()` is less than `workerThreshold`
- **THEN** the dataset-replace op runs on the main thread
- **AND** the worker pool's `run()` is NOT invoked

#### Scenario: 'auto' routes large datasets to worker
- **WHEN** `useWorker: 'auto'` and the source dataset's `arcs.getPointCount()` is at least `workerThreshold`
- **THEN** the dataset-replace op routes through the worker
- **AND** the worker pool's `run()` is invoked

#### Scenario: Default threshold is 50000
- **WHEN** `useWorker: 'auto'` is set without `workerThreshold`
- **THEN** the threshold used is `50000` vertices

#### Scenario: Custom threshold overrides
- **WHEN** `useWorker: 'auto'` and `workerThreshold: 1000`
- **AND** the dataset has `arcs.getPointCount() === 1500`
- **THEN** the op routes through the worker

#### Scenario: Arc-less point datasets route to main thread
- **WHEN** `useWorker: 'auto'` and the source dataset has no `arcs` (or `arcs.getPointCount` is missing)
- **THEN** the effective vertex count is `0` and the op routes to the main thread

### Requirement: workerjobstart and workerjobend events
The `Emap` instance SHALL fire `workerjobstart` and `workerjobend` events around every dataset-replace op that routes through the worker.

#### Scenario: Start event fires before worker run
- **WHEN** a dataset-replace op routes through the worker
- **THEN** `workerjobstart` is fired before `pool.run()` is called
- **AND** the event payload contains `{ id, cmd, label, datasetVertexCount }`

#### Scenario: End event fires after worker resolves
- **WHEN** a worker run resolves successfully
- **THEN** `workerjobend` is fired with `{ id, ok: true, durationMs }`
- **AND** the same `id` matches the prior `workerjobstart`'s id

#### Scenario: End event fires after worker rejects
- **WHEN** a worker run rejects
- **THEN** `workerjobend` is fired with `{ id, ok: false, durationMs, errorMessage }`

#### Scenario: Main-thread runs do NOT fire these events
- **WHEN** `useWorker: false` (or `'auto'` below threshold) and a dataset-replace op runs
- **THEN** neither `workerjobstart` nor `workerjobend` fires

#### Scenario: Multiple in-flight events have distinct ids
- **WHEN** two dataset-replace ops are in-flight concurrently through the worker
- **THEN** their `workerjobstart` events have different `id` values
- **AND** each `workerjobend` matches the `id` of its corresponding `workerjobstart`
