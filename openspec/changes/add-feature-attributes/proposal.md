# Change: Add feature attribute query + highlight

## Why
Users need a MapLibre-style way to pick features, read their attribute properties, and visually highlight the picked feature(s).

## What Changes
- Add a MapLibre-like `Emap.queryRenderedFeatures(...)` API that accepts a point or bbox in pixel space and supports layer filtering.
- Return attribute properties for matched features (no geometry), plus identifiers needed for highlighting.
- Add highlight support for matched features with a lightweight overlay draw path.
- Add a new upload-based HTML test example that demonstrates querying and highlighting.

## Impact
- Affected specs: `feature-inspection` (new)
- Affected code: `src/map/map.ts`, `src/source/topology-source.ts`, `src/renderer/*`, `test/examples/*`
