# ADR 0009 — Replace the custom kernel with upstream Cordis

Status: implemented and validated on `refactor/cordis-native`; the complete release gate passed. See [validation record](../audits/cordis-native-migration.md).

## Context

Commit `fdd3e136` introduced an emap-specific PluginRuntime, ServiceRegistry, ServiceKey and EffectScope. The project owner subsequently requested complete replacement by standard Cordis rather than a compatibility layer or a proof of concept.

## Decision

Use the exact official upstream package `cordis@4.0.0-rc.10`. Do not use a DeepSeek fork, vendor snapshot, patched framework, second plugin graph, adapter that emulates the old kernel, or custom lifecycle state machine. Cordis is a production dependency; its two additional dependencies are locked. All existing GIS dependency versions remain unchanged.

`map.ctx` is an actual `Context`. Plugins implement native `name`, `inject`, `apply` and optional `provide` metadata. Services use Context declaration merging and native `ctx.provide`. Functions, object plugins, Service subclasses, multiple Fiber instances, configuration updates, native events and isolation remain upstream behavior.

## Initialization

`Emap.create(options)` returns a ready map. `new Emap(options)` remains possible, but callers must await `map.ready`. The constructor mounts directly through `ctx.plugin`; it does not synchronously simulate native scheduling. The bootstrap waiter observes native Fiber promises and rejects an incomplete mandatory preset after transitions finish.

## Resource ownership

Acquisitions are owned by native `ctx.effect`. Generator groups preserve necessary ordering: revoke a service and stop its consumers before closing its backend. Browser AbortControllers are registered as native effects to guard asynchronous GIS commits. Control instances are child plugins; optional `Control.inject` is forwarded unchanged to the native Fiber. A dependent control suspends and reactivates with its service while retaining ownership bookkeeping.

Native teardown errors go to the Cordis logger. `map.dispose()` waits for teardown but does not recreate the previous AggregateError protocol. `remove()` requests disposal; containers must not be reused until the disposal promise resolves.

## Removed API

- All `src/kernel` implementation and custom-kernel contract tests.
- Service token modules and `serviceKey`, `ServiceKey`, `ServiceResolver`.
- `map.runtime`, `map.services`, `map.getService`, `map.use`.
- ID-based runtime mount/unmount/disable/enable and the custom scope API.
- The package `/kernel` subpath, replaced by `/context` native re-exports and diagnostics.

Use `ctx.plugin`, native Fiber references, `fiber.dispose`, `fiber.restart` and `fiber.update` directly. `inspectContext` and `inspectServices` read the native registry and reflection store without retaining a second graph. `settleContext` only waits for native transitions. Cancellation is a browser adapter registered as an effect, not another scope implementation.

## Retained GIS domain objects

Dataset, Source, LayerRegistry, Canvas rendering, history, geometry operations, format catalogs and CapabilityRegistry are domain concepts that Cordis does not replace. Existing GIS EventDispatcher remains `ctx.mapEvents`; it neither schedules plugins nor owns a competing lifecycle. Mapshaper and DuckDB algorithms are reused.

## Compatibility and risks

This is a breaking migration on a separate branch, not an npm release. Cordis is currently pinned to an RC; future upgrades require full validation. ESM output leaves Cordis external rather than bundling another copy. Applications that import Cordis directly should use the same pinned version. IIFE users access the bundled native types through `emap.Context`; `Context.is()` supports checking native contexts across bundles.

## Validation

Native tests cover dependency disappearance/restoration, Service classes, native function plugins, isolation, restart, config updates, event cleanup, duplicate-service failures, failed bootstrap cleanup, generator disposal ordering and effect release. Existing GIS tests are migrated to ready/dispose promises. The browser inspector tests actual pointer movement and native provider disposal/reinstallation, not merely labels.
