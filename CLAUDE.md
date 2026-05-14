# CLAUDE.md — AI Assistant Guide for `emap`

This file provides authoritative context for AI assistants working in this repository.

---

## Project Overview

`emap` is a topology-oriented geographic map rendering and editing engine built around [Mapshaper](https://github.com/mbloch/mapshaper) data structures and HTML5 Canvas. It is a **browser-only, framework-agnostic TypeScript library** with no backend server requirements.

**Core capabilities:**
- Topology-based rendering (Mapshaper datasets → Canvas) with shared-arc reuse and LOD
- Multi-format data loading: GeoJSON, TopoJSON, ZIP Shapefiles
- Interactive editing: pan, wheel-zoom, vertex / feature / topology editing
- 30+ data ops under `emap.ops.*` (clip, dissolve, buffer, simplify, project, snap, clean, …)
- Off-thread execution via a `MapshaperWorkerPool` with command-family-aware routing
- Undo/redo with command coalescing, dataset-replace barriers, and structured `OpResult` errors
- Selection model + snapshot pack/unpack
- HTML5 Canvas 2D rendering with batched-stroke optimization for large topology datasets
- Geographic projections (EPSG / WKT / Proj.4 / mproj)

---

## Repository Structure

```
emap/
├── src/
│   ├── index.ts                  # Public entry point (explicit named exports only)
│   ├── map/                      # Orchestration + ops + selection + history glue
│   │   ├── map.ts                # Emap class — orchestrates sources, render, controls
│   │   ├── mapshaper-ops.ts      # `emap.ops` facade — 1-line delegations to src/map/ops/
│   │   ├── ops/                  # One file per data op (clip, dissolve, buffer, …)
│   │   │   ├── _context.ts       # OpContext handed to every op function
│   │   │   ├── _runner.ts        # Shared dataset-replace pipeline + worker routing
│   │   │   └── <op>.ts           # 30 individual op implementations
│   │   ├── op-result.ts          # OpResult discriminated union + helpers
│   │   ├── selection.ts          # Selection model (single/multi/diff)
│   │   ├── feature-query.ts      # Hit-testing via Flatbush spatial index
│   │   ├── highlight-manager.ts  # Hover/selection highlight state
│   │   ├── layer.ts              # LayerSpecification + paint resolution
│   │   ├── layer-registry.ts     # Sole resolve(sourceId, layerId) entry point
│   │   ├── attribute-ops.ts      # set/add/remove/rename property + field commands
│   │   ├── edit-sessions.ts      # FeatureTranslateSession / FeatureAffineSession
│   │   ├── edit-state-store.ts   # Per-session ephemeral edit state
│   │   ├── emap-host.ts          # Internal host contract for managers
│   │   ├── command-args.ts       # quoteCliArg + isValidLayerName / isValidFieldName
│   │   ├── worker-routing.ts     # Command-family-aware worker decision tree
│   │   └── types.ts              # Op option records (ClipEraseOptions, …)
│   ├── adapter/
│   │   └── mapshaper-adapter.ts  # SOLE bridge to mapshaper.internal.* — see below
│   ├── edit/                     # Memento-pattern edit commands + undo stack
│   │   ├── edit-history.ts       # Undo/redo, coalescing, stale flag
│   │   ├── edit-command.ts       # Command interface
│   │   └── commands/             # vertex / feature / dataset-replace / attribute
│   ├── source/
│   │   ├── topology-source.ts    # Data loading: GeoJSON/TopoJSON/ZIP + resource limits
│   │   ├── display-arcs.ts       # Level-of-Detail simplified arc storage
│   │   ├── source.ts             # Source interface
│   │   ├── mapshaper-runner.ts   # @deprecated — delegates to MapshaperAdapter
│   │   └── layer-utils.ts        # getLayerId fallback resolution
│   ├── geo/
│   │   ├── viewport.ts           # View transforms and zoom animations
│   │   ├── projection.ts         # CRS application + mproj wiring
│   │   ├── crs-resolver.ts       # EPSG / WKT / mproj heuristics → canonical CRS
│   │   ├── bounds.ts             # Bounding box operations
│   │   └── transform.ts          # 2D affine transforms (mx, my, bx, by)
│   ├── core/
│   │   ├── events.ts             # EventDispatcher base class
│   │   ├── interactions.ts       # Mouse wheel zoom
│   │   ├── drag-pan-handler.ts   # Drag-to-pan
│   │   ├── mapshaper-worker-pool.ts  # N-worker pool with epoch isolation
│   │   └── tween.ts              # Animation tweening
│   ├── ui/                       # Control implementations (see "Built-in controls")
│   ├── worker/
│   │   └── mapshaper-worker.ts   # Off-thread mapshaper entry
│   ├── renderer/
│   │   ├── painter.ts            # Painter interface
│   │   └── canvas-painter.ts     # HTML5 Canvas 2D, batched-stroke
│   ├── types/                    # Central mapshaper / mproj type definitions
│   └── shim.ts                   # Browser polyfills for Node modules referenced by mapshaper
├── test/
│   └── examples/                 # 40 standalone HTML playgrounds, one per feature
├── openspec/                     # Spec-driven development (see below)
├── docs/
│   └── backlog.md                # Deferred work + trigger conditions for re-evaluation
├── dist/                         # Build outputs (gitignored)
├── rollup.config.mjs
├── tsconfig.json
├── package.json
├── AGENTS.md                     # Short AI context + OpenSpec pointer
├── SECURITY.md                   # Expression-evaluation policy + reporting flow
└── README.md
```

---

## Tech Stack

| Area | Technology |
|---|---|
| Language | TypeScript 5.0 (strict mode) |
| Build | Rollup 4.x (IIFE bundle) |
| Test | Vitest 1.x |
| Core data | mapshaper v0.6 |
| Rendering | HTML5 Canvas 2D |
| Basemap tiles | maplibre-gl v5 |
| Projections | mproj |
| Spatial index | flatbush, kdbush |
| ZIP/Shapefile | fflate |

---

## Development Commands

```bash
# Install dependencies
pnpm install          # preferred
npm install           # also works

# Development (watch mode with sourcemaps)
npm run dev

# Single dev build
npm run dev-build

# Production build (minified)
npm run build

# Run tests
npm test
```

**Build outputs:**
- `dist/emap-dev.js` — development bundle with sourcemaps
- `dist/emap.js` — production minified bundle
- `dist/emap.mjs` — ES module
- `dist/emap.d.ts` — TypeScript declarations

**Manual testing:** Open any file in `test/examples/*.html` directly in a browser after building.

---

## Key Architectural Patterns

### MapshaperAdapter (sole bridge to mapshaper internals)
`src/adapter/mapshaper-adapter.ts` is the **only** place `mapshaper.internal.*` is touched in the runtime path. Every op, command, and source goes through `getDefaultMapshaperAdapter()`. Tests stub it via `setDefaultMapshaperAdapter(mock)`. Do not import `mapshaper` directly outside the adapter, the worker entry, and `src/types/`.

### ParsedCommand[] (no string-build path)
Ops emit `ParsedCommand[]` (`{ name, options }` objects) directly to `runOnDatasetParsed` / the worker. There is no shell-style CLI string between an op and mapshaper. New ops go in `src/map/ops/<op>.ts` and call `ctx.runDatasetCommandParsed(...)` — never `ctx.runDatasetCommand(string)` for new code.

### OpResult error model
Every op returns `Promise<OpResult<T>>` — a discriminated `{ ok: true, value? } | { ok: false, error: OpError }`. `OpError` is a `kind`-tagged union (`not-found` | `validation` | `expression-disabled` | `mapshaper` | `host-removed`). Use the `Err.*` / `OK` / `okValue` helpers in `src/map/op-result.ts`.

### Memento commands + EditHistory
Every edit captures enough state in its constructor to round-trip `do()` / `undo()` without referencing live dataset internals. Dataset-replace commands (clip, dissolve, …) flag prior commands as `stale` rather than clearing the history. See `src/edit/commands/` for templates and `EditHistory.push` for the merge / coalesce protocol.

### Effect-aware dataset replace
Each op classifies its effect: `shape-count` | `topology-only` | `attribute-only` | `crs-only` | `unknown` (see `_runner.COMMAND_EFFECTS`). The runner uses this to decide whether to clear the selection — attribute-only and crs-only ops preserve it. Adding a new op? Add its head to the table.

### Worker routing
`shouldUseWorker(cmd, vertexCount, mode, threshold)` decides per-call whether to dispatch off-thread. Cheap commands stay on main even at large vertex counts; expensive ones (buffer, clean, dissolve) use a 0.5× threshold. `MapOptions.workerRouting` overrides the decision globally.

### EventDispatcher
`src/core/events.ts` provides the base class. Both `Emap` and interaction handlers extend it. Use `on()` / `fire()` — never raw DOM events for internal communication.

### Rendering Loop
The `render()` method in `src/map/map.ts` drives all drawing. Never trigger DOM updates or state changes directly in render. Queue via `requestAnimationFrame` or tween callbacks.

### Affine Transforms
All coordinate math uses `AffineTransform` from `src/geo/transform.ts`: `(x * mx + bx, y * my + by)`. The viewport converts between geo and pixel space via this transform.

### Control Lifecycle
UI components implement the `Control` interface (`src/ui/control.ts`):
- `onAdd(map): HTMLElement` — attach to map, return root element
- `onRemove()` — clean up listeners and DOM

### LOD (Level of Detail)
`src/source/display-arcs.ts` manages simplified geometry for datasets >500k points. The display arcs are marked dirty after edits and rebuilt lazily on the next `getScaledArcs(pixelSize)` call. Do not bypass LOD when rendering large datasets.

### Batch Rendering
`CanvasPainter` groups 25 shapes per `canvas.stroke()` call. Do not change this pattern without profiling — it is a deliberate performance optimization for large topology datasets.

### LayerRegistry (sole layer resolver)
`src/map/layer-registry.ts` is the only entry point for `resolve(sourceId, layerId) → MapshaperLayer | null`. Do not write inline `layers.find(l => l.name === id)` — go through the registry so the cache stays consistent.

### Transaction (atomic multi-step edit)
`src/edit/transaction.ts` stages every command pushed during its lifetime via `EditHistory.beginCapture()` / `endCapture()`. `commit(label)` collapses the captured children into a single `CompositeCommand`; `rollback()` restores per-source first-touch snapshots and the selection. The runner records snapshots on the active transaction in `_applyDatasetReplace` — ops themselves are transaction-unaware. **Nesting is not supported.**

### Validation hooks (post-edit constraints)
`src/validation/registry.ts` owns the registered `Validator[]`. `Emap` listens to its own `historychange` event and asks the registry to fan out every `'after-commit'` validator in parallel. Failures fire `validationfailed` — the engine never auto-undoes, the app decides. Cost is one `size` check when no validators are registered (the common case). Built-in: `topologyValidator(opts)` in `src/validation/builtin/topology.ts`.

### FeatureAccessor (read-side feature lookups)
`src/map/feature-accessor.ts` exposed via `Emap.features`: `get(ref) → Feature | null`, `iter(sourceId, layerId) → IterableIterator<Feature>`, `count(sourceId, layerId) → number`. Returns `null` (not throws) for any failed lookup; `properties` are `Object.freeze`d. Mutations still go through `attribute-ops` / edit commands so they participate in undo.

### Operation vs Command (terminology)
- **Operation** ("op") — a mapshaper-driven dataset op (`emap.ops.clipLayer`, etc.). Implemented under `src/map/ops/<op>.ts`. Returns `Promise<OpResult>`. Internally pushes a `DatasetReplaceCommand` to history.
- **Command** — an undoable edit memento (`EditCommand` in `src/edit/edit-command.ts`). Has `do()` / `undo()`. Stored on the `EditHistory` undo stack. Includes vertex / feature / dataset-replace / composite variants.
- **Task** — not used in this codebase.

---

## Code Conventions

### Naming
- Private members: `_camelCase` (e.g., `_viewport`, `_painter`)
- Public API: `camelCase`
- Interfaces and types: `PascalCase`
- Constants inside functions/classes: `UPPER_CASE`
- Test files colocate with source: `foo.ts` → `foo.test.ts`

### TypeScript
- Strict mode is enforced (`noUnusedLocals`, `noUnusedParameters`)
- Path alias `@/*` maps to `src/*` (configured in tsconfig and rollup)
- All Mapshaper types are centralized in `src/types/mapshaper-types.ts` — do not scatter inline `any` casts

### Private access in tests
Tests use `Reflect` to access private properties/methods. This is an accepted pattern here — do not change private members to public just for testing.

---

## Where to Make Changes

| Task | Files to touch |
|---|---|
| Data loading, format parsing | `src/source/topology-source.ts` |
| Coordinate projection / CRS | `src/geo/projection.ts`, `src/geo/crs-resolver.ts`, `src/geo/viewport.ts` |
| Rendering appearance | `src/renderer/canvas-painter.ts` |
| Zoom / pan interactions | `src/core/interactions.ts`, `src/core/drag-pan-handler.ts` |
| Vertex editing | `src/ui/vertex-edit-control.ts`, `src/edit/commands/vertex-*.ts` |
| New UI control | Add to `src/ui/`, implement `Control` interface, export from `src/index.ts` |
| Map orchestration | `src/map/map.ts` |
| Feature hit-testing / spatial index | `src/map/feature-query.ts` |
| New mapshaper data op | New file `src/map/ops/<op>.ts` + 1-line delegate in `src/map/mapshaper-ops.ts` + option type in `src/map/types.ts` |
| Buffer parameter mapping (camelCase ↔ snake_case) | `src/map/ops/buffer.ts` — full `-buffer` option surface |
| New edit command | New file `src/edit/commands/<cmd>.ts` implementing `EditCommand` (see `vertex-move.ts` for the canonical template) |
| Worker routing decision | `src/map/worker-routing.ts` (CHEAP / EXPENSIVE sets) |
| Mapshaper internals access | `src/adapter/mapshaper-adapter.ts` only — never touch `mapshaper.internal.*` from outside the adapter |
| Layer resolution | `src/map/layer-registry.ts` only — do not inline `layers.find(...)` |
| New public API | Export explicitly from `src/index.ts` (no `export *`) |

---

## OpenSpec Workflow (Spec-Driven Development)

This project uses **OpenSpec** for structured feature proposals. **Read `openspec/AGENTS.md` before planning significant work.**

### When to create a proposal (do NOT code first):
- Adding new capabilities or API surface
- Breaking changes (API, schema, behavior)
- Architecture or pattern changes
- Performance work that changes behavior

### When to skip proposals (fix directly):
- Bug fixes restoring documented behavior
- Typos, formatting, comments
- Tests for existing behavior
- Non-breaking dependency updates

### Workflow summary:
```bash
openspec list                       # See active changes
openspec list --specs               # See existing capabilities
openspec show <item>                # View details
openspec validate <change> --strict # Validate before submitting
openspec archive <change-id> --yes  # Archive after deployment
```

Proposals live in `openspec/changes/<change-id>/` with:
- `proposal.md` — why + what
- `tasks.md` — implementation checklist
- `design.md` — technical decisions (only when needed)
- `specs/<capability>/spec.md` — delta spec using `## ADDED|MODIFIED|REMOVED Requirements`

---

## Testing

Framework: **Vitest** (`~760 unit tests across 30 files`).

```bash
npm test
```

- Test files: `src/**/*.test.ts` (colocated with source)
- Mocking mapshaper: prefer `setDefaultMapshaperAdapter(mockAdapter)` — do not stub `mapshaper.internal.*` directly. Tests that pre-date the adapter still spy on `mapshaper.internal.runParsedCommands` via `Reflect.set`; new tests should not.
- Private access: Use `Reflect.get(instance, '_prop')` pattern
- Op-level tests: instantiate `Object.create(MapshaperOps.prototype)` with a stub host + stub `runDatasetCommand` — see `src/map/ops/_context.ts` for the contract. Do NOT spin up a full `Emap` for op-level coverage.

---

## Important Constraints

- **Browser-only**: No Node.js runtime APIs at execution time. `src/shim.ts` polyfills any Node module references for the bundle.
- **No server**: All data is fetched client-side via `fetch()`.
- **Mapshaper internals are isolated**: `src/adapter/mapshaper-adapter.ts` is the single bridge to `mapshaper.internal.*`. The runtime path no longer touches it from anywhere else. mapshaper version upgrades route through one file. (The worker entry `src/worker/mapshaper-worker.ts` is the only other module that imports `mapshaper` directly — kept narrow because the worker is its own bundle.)
- **No CLI string-build path**: Ops emit `ParsedCommand[]` structures, not shell-style strings. `quoteCliArg` is retained as defense-in-depth but should not be needed for new code.
- **Expression evaluation is gated**: `MapOptions.expressionPolicy` defaults to `'disabled'`. Ops that accept JS expression strings (`applyExpression`, `filterFeatures`, `where=` / `calc=` everywhere) refuse to run when an expression is supplied unless the policy is flipped to `'trusted'`. See `SECURITY.md`.
- **iconv-lite shim**: `rollup.config.mjs` aliases `iconv-lite` → `src/types/iconv-shim.ts` for browser compatibility. Do not remove this alias.
