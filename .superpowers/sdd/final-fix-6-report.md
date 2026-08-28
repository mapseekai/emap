# MAP-179 Final Fix 6 Report

## Scope

Canonicalized URL-basemap resource fields against the final redirected style response URL when Style overlays require composition. Basemap-only URL loading remains delegated to MapLibre.

## TDD

- RED: `pnpm vitest run src/map/maplibre-overlay-style.test.ts` failed because `normalizeMapLibreStyleUrls` did not exist.
- GREEN: added final-response URL canonicalization for glyphs, sprites, source `url`, `tiles`, `urls`, and GeoJSON `data`; added request-scoped, abortable URL-basemap loading using `transformRequest(..., 'Style')` before composition.
- Regression: URL basemap response redirects to `https://redirected.example.test/releases/v2/style.json`; its relative glyph matches an absolute overlay glyph, and sprite/source references resolve from that final URL.

## Validation

| Command | Result |
| --- | --- |
| `pnpm vitest run src/map/maplibre-overlay-style.test.ts` | PASS (17) |
| `pnpm vitest run src/map/maplibre-service-manager.test.ts` | PASS (161) |
| `pnpm vitest run src/map/maplibre-emap-integration.test.ts` | PASS (7) |
| `pnpm run typecheck` | PASS (`tsc --noEmit`) |
| `git diff --check` | PASS |

## Impact

`gitnexus_detect_changes` reported medium risk and one affected process (`Constructor → CloneValue`). The available GitNexus index is for the parent checkout rather than this linked worktree; its pre-change symbol lookup could not resolve the worktree's current overlay loader.
