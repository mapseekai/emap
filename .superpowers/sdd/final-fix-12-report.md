# Final Fix 12 Report

## Fixed

- Late resource failures from a committed style-update request now emit their fatal style event for the resolved resource owner when it is a valid style overlay. If no such owner exists, the restored rollback record remains the fallback event owner.
- The updated overlay still restores its prior definition, prepared style, and state, then recomposes that prior composite.
- A prepared request now retains its composed style and passes that exact object to physical `setStyle`, avoiding a second composition and its associated clone/allocation work.

## Regression coverage

Added a manager regression with two style overlays using distinct sprite URLs. It updates the second overlay, completes `style.load`, then emits a transformed sprite failure for the first overlay. The test verifies exactly one fatal style event owned by the first overlay, recovery of the second overlay to its prior composite, preserved first-overlay ready state, and intact basemap resources.

## Validation

- `pnpm vitest run src/map/maplibre-service-manager.test.ts -t "attributes a late transformed sprite error"`
- `pnpm vitest run src/map/maplibre-service-manager.test.ts`
- `pnpm vitest run src/map/maplibre-emap-integration.test.ts`
- `pnpm typecheck`
