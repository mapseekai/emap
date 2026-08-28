# MAP-179 Final Fix 5 Report

## Scope

Fixed Finding 5 only: Style-overlay visibility now uses the direct layout mutation only when the current ready generation owns every prepared layer and no style request is applied or parsed. During a pending generation, visibility creates a latest-intent composite request, waits for that request under the overlay operation revision, and publishes `ready` only after reconciliation.

Style requests are also marked ready-to-apply only after their overlay preparation completes. This prevents a prior `style.load` from starting a replacement request before its latest composite snapshot is prepared.

## Regressions

Added delayed-`style.load` coverage for:

- hiding a visible Style overlay during an in-flight composite generation;
- showing a hidden Style overlay during an in-flight composite generation.

Both assert the interim state remains `loading`, no additional `setStyle` occurs before the delayed load completes, the final public state is `ready`, and the native composed style has the requested effective layer visibility. The existing fast-path regression continues to assert hide/show uses no fetch and no `setStyle` once ready.

## Validation

| Command | Result |
| --- | --- |
| `pnpm exec vitest run src/map/maplibre-service-manager.test.ts -t 'visibility changes during\|style overlay visibility hides owned layers'` | PASS — 3 tests |
| `pnpm exec vitest run src/map/maplibre-service-manager.test.ts` | PASS — 160 tests |
| `pnpm exec vitest run src/map/maplibre-emap-integration.test.ts src/ui/layer-control.test.ts` | PASS — 17 tests |
| `pnpm run typecheck` | PASS |
| GitNexus `detect_changes` | low risk; no affected processes |
