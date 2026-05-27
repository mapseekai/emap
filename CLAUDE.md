# CLAUDE.md - AI Assistant Guide for `emap`

This file provides architecture and maintenance context for AI assistants
working in this repository.

## Project Overview

`emap` is a topology-oriented geographic map rendering and editing engine built
around Mapshaper data structures and HTML5 Canvas. It is a browser-only,
framework-agnostic TypeScript library with no backend server requirement.

Core capabilities:

- Topology-based rendering with shared-arc reuse and LOD.
- GeoJSON, TopoJSON, ZIP Shapefile, and Mapshaper snapshot loading.
- Interactive handlers for pan, zoom, click selection, box/lasso selection,
  vertex editing, feature drawing, and feature transform.
- 30+ data ops under `map.ops.*`.
- Off-thread execution through `MapshaperWorkerPool`.
- Undo/redo with command coalescing, dataset-replace barriers, transactions,
  and structured `OpResult` errors.
- Selection, feature events, feature accessors, highlighting, and validators.
- MapLibre-style camera methods and layer specifications.

## Hard Rules — Code Search (MANDATORY)

**Code search MUST go through GitNexus or CodeGraph first. `grep` / `find` / generic file-walking is a fallback, not a default.** This applies to every read-only investigation: locating a symbol, tracing callers/callees, finding usages, surveying an area, mapping execution flows, assessing impact.

Mandatory order:

1. **Structural lookups first** — use the right tool for the question:
   - "Where is X defined?" / "Find symbol X" → `codegraph_search` or `gitnexus_query`
   - "What calls Y?" → `codegraph_callers` or `gitnexus_context`
   - "What does Y call?" → `codegraph_callees`
   - "What breaks if I change Z?" → `codegraph_impact` or `gitnexus_impact`
   - "Show me Y's signature / source" → `codegraph_node`
   - "Focused context for an area" → `codegraph_context` or `gitnexus_context`
   - "Several related symbols at once" → `codegraph_explore`
   - "How does X reach Y? / trace the flow" → `codegraph_trace`
2. **Trust the result.** Do NOT re-verify a hit with `grep` — the index is from a full AST parse and is more accurate than text matching. Repeated verification wastes context.
3. **Fall back to `grep` ONLY when** GitNexus/CodeGraph cannot answer the question — e.g., literal string contents (log messages, comment text, JSON values), or symbols that legitimately don't exist in the graph yet (uncommitted code in untracked files).
4. **Document the fallback.** If you use `grep`, briefly state why the graph tools didn't suffice (e.g., "searching log message text, not a symbol").

Violations of this rule waste context and produce inferior answers. If GitNexus or CodeGraph reports the index is stale, run `npx gitnexus analyze` (and/or `codegraph init -i`) FIRST, then continue with the graph tools — do not switch to grep as a shortcut.

## Repository Structure

```text
emap/
├── src/
│   ├── index.ts                 # Public entry point, explicit named exports
│   ├── map/                     # Emap orchestrator, ops, selection, history
│   │   ├── map.ts               # Main Emap class
│   │   ├── mapshaper-ops.ts     # map.ops facade
│   │   ├── ops/                 # One file per data op
│   │   ├── op-result.ts         # OpResult and OpError helpers
│   │   ├── selection.ts         # Selection model
│   │   ├── feature-query.ts     # Hit testing and Flatbush indexes
│   │   ├── feature-accessor.ts  # Read-side feature lookup API
│   │   ├── highlight-manager.ts # Highlight state and rendering
│   │   ├── layer.ts             # LayerSpecification and paint resolution
│   │   ├── layer-registry.ts    # Layer resolution surface
│   │   ├── edit-sessions.ts     # Translate/affine edit sessions
│   │   ├── edit-state-store.ts  # Edit mode state
│   │   ├── attribute-ops.ts     # Attribute and field commands
│   │   ├── worker-routing.ts    # Worker decision tree
│   │   └── types.ts             # Public map option and op option types
│   ├── adapter/
│   │   └── mapshaper-adapter.ts # Sole runtime bridge to mapshaper internals
│   ├── core/
│   │   ├── events.ts            # EventDispatcher
│   │   ├── event-map.ts         # Typed Emap events
│   │   ├── handler.ts           # Handler contract
│   │   ├── handler-manager.ts   # Pointer arbitration and cursor resolution
│   │   ├── handlers/            # Built-in interaction handlers
│   │   ├── feature-event-dispatcher.ts
│   │   ├── pointer-event-dispatcher.ts
│   │   ├── mapshaper-worker-pool.ts
│   │   └── tween.ts
│   ├── edit/
│   │   ├── edit-history.ts
│   │   ├── edit-command.ts
│   │   ├── transaction.ts
│   │   └── commands/
│   ├── source/
│   │   ├── topology-source.ts
│   │   ├── display-arcs.ts
│   │   ├── source.ts
│   │   └── layer-utils.ts
│   ├── geo/
│   │   ├── viewport.ts
│   │   ├── camera.ts
│   │   ├── projection.ts
│   │   ├── crs-resolver.ts
│   │   ├── bounds.ts
│   │   └── transform.ts
│   ├── renderer/
│   │   ├── painter.ts
│   │   ├── canvas-painter.ts
│   │   └── edit-overlay-renderer.ts
│   ├── ui/
│   │   ├── control.ts
│   │   ├── controls.css
│   │   └── *-control.ts
│   ├── validation/
│   ├── worker/
│   ├── vendor/
│   ├── types/
│   └── shim.ts
├── test/examples/               # Manual HTML examples
├── docs/                        # Supporting notes and backlog
├── dist/                        # Build outputs, gitignored
├── README.md                    # User-facing quick start
├── FEATURES.md                  # Capability matrix
├── AGENTS.md                    # Short agent rules
├── SECURITY.md
├── CHANGELOG.md
├── package.json
└── rollup.config.mjs
```

## Development Commands

Use `cmd /c npm ...` on this Windows workspace to avoid PowerShell shim issues.

```bash
cmd /c npm install
cmd /c npm run dev
cmd /c npm run dev-build
cmd /c npm run typecheck
cmd /c npm run test:run
cmd /c npm run build
```

Manual testing: build first, then open `test/examples/*.html` directly in a
browser.

## Key Architectural Patterns

### MapshaperAdapter

`src/adapter/mapshaper-adapter.ts` is the only runtime bridge to
`mapshaper.internal.*`. Ops, commands, and sources should go through
`getDefaultMapshaperAdapter()`. Tests can stub it with
`setDefaultMapshaperAdapter(mock)`.

Do not import `mapshaper` directly outside the adapter, worker entry, vendor
modules, and type/shim boundaries.

### ParsedCommand[]

Ops emit parsed command objects:

```ts
[{ name: 'buffer', options: { radius: 50 } }]
```

New ops should call the parsed-command runner path. Avoid shell-style command
strings for new code.

### OpResult

Every op returns:

```ts
{ ok: true, value?: T } | { ok: false, error: OpError }
```

Use `Err.*`, `OK`, and `okValue` from `src/map/op-result.ts`.

### Effect-Aware Dataset Replace

Each dataset op must classify its effect in `COMMAND_EFFECTS` inside
`src/map/ops/_runner.ts`:

- `shape-count`
- `topology-only`
- `attribute-only`
- `crs-only`
- `unknown`

Selection preservation depends on this table.

### Memento Commands and EditHistory

Every edit command must capture enough state to perform `do()` and `undo()`
without depending on later live dataset state. Dataset-replace commands mark
older commands as stale barriers rather than clearing history.

### Transaction

`src/edit/transaction.ts` stages commands pushed during its lifetime.
`commit(label)` collapses captured commands into one `CompositeCommand`.
`rollback()` restores first-touch source snapshots and selection. Nesting is not
supported.

### Handler Architecture

All map interactions are represented as `Handler` implementations:

- `dragPan`
- `scrollZoom`
- `clickSelect`
- `boxSelect`
- `lassoSelect`
- `vertexEdit`
- `drawFeature`
- `transformFeature`

`HandlerManager` owns pointer normalization, priority ordering, exclusive
gesture locking, pointer sinks for delegated events, and cursor arbitration.

Thin UI controls should forward to handlers instead of duplicating pointer
logic.

### EventDispatcher

Use `on()` and `fire()` for engine-level communication. Raw DOM events are
limited to browser input boundaries, control DOM, and the handler manager.

### Rendering Loop

`Emap.render()` is the render driver. Avoid DOM updates or state changes inside
render. Defer with `requestAnimationFrame`, event callbacks, or tween callbacks.

### AffineTransform

All coordinate math uses `AffineTransform` and viewport projection helpers. Do
not introduce ad-hoc matrix calculations.

### LayerRegistry

Resolve source/layer pairs through `LayerRegistry.resolve(...)`. Do not inline
`layers.find(...)` in new code.

### LOD and Batch Rendering

`DisplayArcs` manages zoom-dependent arc simplification for large datasets.
`CanvasPainter` batches stroke rendering for performance. Do not bypass these
paths for large topology rendering without profiling.

### Validation

`ValidatorRegistry` runs validators after committed history changes. Failures
fire `validationfailed`; the engine does not auto-undo.

## Where to Make Changes

| Task | Files |
|---|---|
| New mapshaper op | `src/map/ops/<op>.ts`, `src/map/mapshaper-ops.ts`, `src/map/types.ts`, `_runner.COMMAND_EFFECTS` |
| New edit command | `src/edit/commands/<cmd>.ts` |
| New handler | `src/core/handlers/<name>.ts`, `src/core/handler-manager.ts` if priority changes, `src/index.ts` |
| New UI control | `src/ui/<control>.ts`, `src/ui/controls.css`, `src/index.ts` |
| Source loading/export | `src/source/topology-source.ts` |
| CRS/projection | `src/geo/crs-resolver.ts`, `src/geo/projection.ts`, `src/geo/viewport.ts` |
| Rendering | `src/renderer/canvas-painter.ts`, `src/map/map.ts` |
| Hit testing | `src/map/feature-query.ts` |
| Worker routing | `src/map/worker-routing.ts`, `src/map/ops/_runner.ts` |
| Public API | `src/index.ts` |
| User docs | `README.md`, `FEATURES.md`, `CHANGELOG.md` |

## Code Conventions

- Private members use `_camelCase`.
- Public API uses `camelCase`.
- Interfaces and types use `PascalCase`.
- Constants inside functions/classes use `UPPER_CASE`.
- Tests are colocated as `*.test.ts`.
- Keep public exports explicit; do not use `export *` in `src/index.ts`.
- Keep TypeScript strict-mode compatible.
- Centralize Mapshaper runtime types in `src/types/mapshaper-types.ts`.

## Testing

Framework: Vitest.

Useful targeted checks:

```bash
cmd /c npm run typecheck
cmd /c npx vitest run src\map\handler-registry.test.ts src\core\handler-manager.test.ts --reporter=dot
cmd /c npx vitest run src\map\map.test.ts src\source\topology-source.test.ts --reporter=dot
cmd /c npm run build
```

Use private access through `Reflect` in tests when needed. Do not make private
members public only for tests.

## Important Constraints

- Browser-only runtime; no Node.js runtime APIs in shipped code.
- No backend server requirement.
- Expression evaluation defaults to disabled. Expression-bearing APIs require
  `expressionPolicy: 'trusted'`.
- Worker offloading requires the host app to serve `emap-worker.js` and
  `mapshaper-vendor.js`.
- Mapshaper internals must remain isolated behind `MapshaperAdapter`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **emap** (5274 symbols, 16078 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
