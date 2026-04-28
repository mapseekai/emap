## 1. Type / state plumbing
- [x] 1.1 Extend `EditDrawState` interface in `src/map/map.ts` with `snapKind: 'vertex' | 'edge' | null`. Export `SnapKind` type.
- [x] 1.2 Extend `DrawFeatureControlOptions` in `src/ui/draw-feature-control.ts` with `snapSources?: string[]`, `snapToVertex?: boolean`, `snapToEdge?: boolean`.

## 2. Snap algorithm
- [x] 2.1 Rewrite `_findSnapTarget` to return `{ coord: [number, number]; kind: SnapKind } | null`. Iterate `snapSources` (or `[opts.source]` if unset).
- [x] 2.2 Per source: vertex scan if `snapToVertex !== false`; edge scan via `arcs.forEachSegment` if `snapToEdge !== false`. Take the closest in pixel space across both kinds.
- [x] 2.3 Add module-private `projectPointOnSegment(p, a, b)` helper returning `{ point: [number, number]; dist: number }` where `point` is the closest point on segment `[a, b]` to `p` and `dist` is pixel distance. Clamp parameter `t` into `[0, 1]`.
- [x] 2.4 In-progress drawing vertex loop unchanged.
- [x] 2.5 Update call sites: `_findSnapTarget` callers now read `coord` / `kind` from the return value. Store both into private state and surface in `EditDrawState`.

## 3. Rendering
- [x] 3.1 In `CanvasPainter.drawEditDraw`: when `state.snapKind === 'edge'`, draw a square ring instead of a circle. Same radius, same color.

## 4. Tests
- [x] 4.1 In `src/ui/draw-feature-control.test.ts`:
  - Vertex snap returns `kind: 'vertex'` (regression).
  - Edge snap: cursor near segment midpoint snaps to segment, returns `kind: 'edge'`.
  - Cursor not perpendicular to any segment falls through (no edge snap).
  - Vertex preference: cursor exactly on vertex snaps to vertex (kind: 'vertex'), not adjacent edge.
  - `snapToVertex: false` disables vertex snap; cursor at vertex still finds edge if nearby.
  - `snapToEdge: false` disables edge snap.
  - `snapSources: ['s2']` snaps against another source.
- [x] 4.2 New `projectPointOnSegment` exported for testability:
  - Cursor inside the segment box → perpendicular projection.
  - Cursor past segment endpoint → clamped to endpoint (t = 0 or 1).
  - Zero-length segment → returns the endpoint with distance to it.

## 5. Example
- [x] 5.1 Update or add an example HTML demonstrating draw-with-edge-snap behaviour. Ideally extend an existing draw example (e.g. `vertex-editing.html` already exists; or create `draw-features.html`).

## 6. Validation
- [x] 6.1 `npm test` — all tests pass.
