# Task 8 Report: reshapeFeature interaction handler

## Delivered

- Added `ReshapeFeatureHandler`, implementing the standard handler lifecycle (`enable`, `disable`, `isEnabled`, options, cursor, pointer handling, and `dispose`).
- Validates a non-empty, same-source, same-layer selection with valid polyline or polygon path geometry before enabling.
- Uses `SketchSession` with a two-vertex minimum, map overlay state, keyboard Escape cancellation, and snapping to selected arc vertices and segments.
- Submits data-coordinate sketch vertices to `ops.reshapeSelected({ line })`, prevents duplicate pending submissions, and emits map `error` events for failed operations.
- Quietly disables when another edit mode takes ownership.
- Extended `EditHandlerHost.ops` with `reshapeSelected`.

## Tests added

`reshape-feature.test.ts` covers:

1. Invalid selection rejection on enable.
2. Two-click plus context-menu submission using unprojected data coordinates.
3. Escape cancellation without submission.
4. Operation failure error dispatch.
5. Automatic quiet disable on edit-mode change.

## Verification

- `rtk vitest run src/core/handlers/` — PASS: 181 tests.
- `rtk tsc --noEmit` — PASS: no errors.
