<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Project Context (`emap`)

`emap` is a topology-oriented map rendering and editing engine built around `mapshaper` data structures and Canvas. Browser-only TypeScript library.

**Read `CLAUDE.md` for the authoritative architecture guide** — repo structure, key patterns (MapshaperAdapter isolation, ParsedCommand[] dispatch, OpResult error model, memento commands, effect-aware dataset replace), and where each kind of change goes. The pointers below are an index into it.

**Where to make changes (quick index)**:

| Task | Entry point |
|---|---|
| New mapshaper data op | `src/map/ops/<op>.ts` (+ delegate in `mapshaper-ops.ts`, option type in `types.ts`) |
| New edit command | `src/edit/commands/<cmd>.ts` (use `vertex-move.ts` as template) |
| New UI control | `src/ui/<control>.ts`, implement `Control` interface, export from `src/index.ts` |
| Data loading / format | `src/source/topology-source.ts` |
| CRS / projection | `src/geo/crs-resolver.ts`, `src/geo/projection.ts`, `src/geo/viewport.ts` |
| Mapshaper internals | `src/adapter/mapshaper-adapter.ts` only — do not touch `mapshaper.internal.*` elsewhere |
| Worker routing | `src/map/worker-routing.ts` |

**Hard rules**:

- Use the `EventDispatcher` (`on` / `fire`) for internal communication, never raw DOM events.
- Coordinate math goes through `AffineTransform`, never ad-hoc matrices.
- Layer resolution goes through `LayerRegistry.resolve(...)`, never inline `layers.find(...)`.
- Render-loop side effects (DOM updates, state changes) must defer via `requestAnimationFrame` or tween callbacks — not inline in `render()`.
- New ops must classify their effect (`shape-count` / `topology-only` / `attribute-only` / `crs-only`) in `src/map/ops/_runner.ts`'s `COMMAND_EFFECTS` table — selection-preservation depends on it.
