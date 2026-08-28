# Final Fix 9 — Finding C

## Resolution

Established-map style-overlay application now composes the canonical object basemap and prepared overlays synchronously in `MapLibreServiceManagerImpl` before calling `Map#setStyle`. The call receives the fully composed `StyleSpecification` with `{ diff: false }` and no `transformStyle` callback. Basemap-only URL styles retain their native URL application path.

Composition failures now occur within the manager's synchronous application try/catch, so the existing style-error publication and rollback handling applies rather than depending on MapLibre's asynchronous transform callback behavior.

## Regression coverage

The manager test covers an established map through style-overlay add, update, and basemap switch. Every physical `setStyle` call is asserted to receive the composed object, `{ diff: false }`, and `transformStyle === undefined`; each generation reaches `style.load` and leaves the active basemap and overlay ready.

## Validation

- Focused regression test: passed.
- `src/map/maplibre-service-manager.test.ts`: 165 passed.
- `src/map/maplibre-emap-integration.test.ts`: 7 passed.
- `pnpm typecheck`: passed.

## Re-review outcome

No other findings.
