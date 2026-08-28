# MAP-179 Final Fix 4 Report

## Scope

Fixed Finding 4 only: mixed legacy resource and Style overlays now retain registry order from bottom to top after a composed style loads. Style handles are adopted for every prepared overlay before active legacy overlays reconcile. The ordering lookup includes cached hidden Style layers, while retaining active-only legacy layers.

## TDD

RED:

```text
pnpm vitest run src/map/maplibre-service-manager.test.ts -t 'composes OpenFreeMap Bright without replacing the active basemap'
PASS (0) FAIL (1) skipped (157)

1. MapLibreServiceManager basemap style coordinator composes OpenFreeMap Bright without replacing the active basemap
   AssertionError: expected [ 'base-fill', …(4) ] to deeply equal [ 'base-fill', 'roads-line', …(3) ]
```

GREEN:

```text
pnpm vitest run src/map/maplibre-service-manager.test.ts -t 'OpenFreeMap Bright|preserves cached hidden layers'
PASS (2) FAIL (0) skipped (156)
```

The cached hidden-Style regression registers the resource overlay before the Style overlay, hides the Style overlay, switches basemap, and shows it through the visibility fast path. It asserts stable registry order before and after the switch and verifies that the show does not call `setStyle` again.

## Validation

```text
pnpm vitest run src/map/maplibre-service-manager.test.ts
PASS (158) FAIL (0)

pnpm vitest run src/map/maplibre-emap-integration.test.ts src/ui/layer-control.test.ts
PASS (17) FAIL (0)

pnpm run typecheck
$ tsc --noEmit
```

## Impact

`gitnexus_impact` for `_finishParsedStyle` reported LOW risk, with direct containment in `MapLibreServiceManagerImpl`; its transitive affected surface includes the manager factory, `Emap` construction, and the manager test file.

`gitnexus_detect_changes` ran against this linked worktree before commit. Its symbol mapping was stale/inaccurate for this worktree and was reported to tool QA; the detected diff summary still identified two changed files and medium risk.

## Commit

`fix: preserve mixed overlay registry order`
