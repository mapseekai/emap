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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (5161 symbols, 15764 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/emap/context` | Codebase overview, check index freshness |
| `gitnexus://repo/emap/clusters` | All functional areas |
| `gitnexus://repo/emap/processes` | All execution flows |
| `gitnexus://repo/emap/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
