# MAP-179 Final Fix 2 Report

## Finding

A visible Style overlay update that had reached `setStyle()` could fail asynchronously before `style.load`. The applied-error handler incremented/deactivated the trigger record before the updating transaction resumed, causing its rollback to observe itself as superseded and abandon the prior definition/resources.

## Fix

`StyleRequest` now records the Style-overlay update transaction that owns a composite request. When that exact request receives an applied async error, the handler rejects the request but leaves its owner untouched. `_replaceStyleOverlay()` then restores its saved definition, prepared style, and state, requests the rollback composite generation, and rethrows the original error. The ownership check requires the same record and operation revision; newer operations retain existing supersession protection.

## Regression

Added `style overlay update restores the old definition and resources after an applied style error` in `src/map/maplibre-service-manager.test.ts`:

1. Starts an active, ready Style overlay over an active basemap.
2. Updates it to a replacement Style overlay and waits until physical `setStyle()` begins.
3. Emits an asynchronous native map error before `style.load`.
4. Confirms a rollback generation starts and completes.
5. Confirms the update rejects with the original error, the old public definition is restored and ready/active, basemap and original generated resources remain, and replacement resource IDs are absent.

## TDD evidence

RED command:

```sh
pnpm vitest run src/map/maplibre-service-manager.test.ts -t 'style overlay update restores the old definition and resources after an applied style error'
```

RED result: failed as expected with `rollback style was not composed`.

GREEN command:

```sh
pnpm vitest run src/map/maplibre-service-manager.test.ts -t 'style overlay update restores the old definition and resources after an applied style error'
```

GREEN result: `PASS (1) FAIL (0) skipped (153)`.

## Validation

```sh
pnpm vitest run src/map/maplibre-service-manager.test.ts
# PASS (154) FAIL (0)

pnpm vitest run src/map/maplibre-emap-integration.test.ts
# PASS (7) FAIL (0)

pnpm run typecheck
# tsc --noEmit (exit 0)
```

GitNexus impact analysis ran before the shared manager change (manager class: MEDIUM risk; direct map integration callers identified). `detect_changes` ran before commit and identified the manager update flow as affected.
