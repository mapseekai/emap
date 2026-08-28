# Final fix 10 report

## Change

- Wrapped the native MapLibre `transformRequest` without changing the caller's return value or invocation context.
- Indexed transformed runtime resource URLs against the active style request's overlay owner.
- Matched direct and expanded template URLs for sources/tiles, glyphs, and sprite `.json`, `.png`, and `@2x.png` requests.
- Resolved runtime errors in order: applied request, parsed request, then generation-valid committed request. Stale prior-generation URLs retain generic lifecycle handling and do not change the current overlay state.

## Regressions

Added manager regressions for:

1. A transformed sprite failure while a basemap recomposes an existing overlay.
2. A transformed resource failure owned by a non-trigger overlay.
3. A transformed sprite failure that arrives after `style.load`, attributed once to the committed overlay and transitioning it to error.
4. A transformed stale prior-generation source failure that leaves the current overlay ready.

## Validation

- `bunx vitest run --silent='passed-only' src/map/maplibre-service-manager.test.ts src/map/maplibre-emap-integration.test.ts` — 176 passing tests.
- `pnpm run typecheck` — passed.
- `gitnexus_detect_changes` — reviewed the affected MapLibre manager flow before commit.
