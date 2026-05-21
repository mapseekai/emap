## Project Context (`emap`)

`emap` is a topology-oriented map rendering and editing engine built around
`mapshaper` data structures and Canvas. It is a browser-only TypeScript
library.

Read `CLAUDE.md` for the architecture guide: repo structure, key patterns
(`MapshaperAdapter` isolation, `ParsedCommand[]` dispatch, `OpResult` error
model, memento commands, effect-aware dataset replace), and where each kind of
change goes.

## Where to make changes

| Task | Entry point |
|---|---|
| New mapshaper data op | `src/map/ops/<op>.ts` (+ delegate in `mapshaper-ops.ts`, option type in `types.ts`) |
| New edit command | `src/edit/commands/<cmd>.ts` (use `vertex-move.ts` as template) |
| New UI control | `src/ui/<control>.ts`, implement `Control` interface, export from `src/index.ts` |
| Data loading / format | `src/source/topology-source.ts` |
| CRS / projection | `src/geo/crs-resolver.ts`, `src/geo/projection.ts`, `src/geo/viewport.ts` |
| Mapshaper internals | `src/adapter/mapshaper-adapter.ts` only |
| Worker routing | `src/map/worker-routing.ts` |
| Handler behavior | `src/core/handlers/*`, `src/core/handler-manager.ts` |
| Public exports | `src/index.ts` |

## Hard rules

- Use `EventDispatcher` (`on` / `fire`) for internal communication, never raw
  DOM events for engine-level signals.
- Coordinate math goes through `AffineTransform`, never ad-hoc matrices.
- Layer resolution goes through `LayerRegistry.resolve(...)`, never inline
  `layers.find(...)`.
- Render-loop side effects (DOM updates, state changes) must defer via
  `requestAnimationFrame` or tween callbacks, not inline in `render()`.
- New ops must classify their effect (`shape-count` / `topology-only` /
  `attribute-only` / `crs-only`) in `src/map/ops/_runner.ts`'s
  `COMMAND_EFFECTS` table because selection preservation depends on it.
