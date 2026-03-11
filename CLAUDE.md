# CLAUDE.md — AI Assistant Guide for `emap`

This file provides authoritative context for AI assistants working in this repository.

---

## Project Overview

`emap` is a modern, topology-oriented geographic map rendering and editing engine built around [Mapshaper](https://github.com/mbloch/mapshaper) data structures and HTML5 Canvas. It is a **browser-only, framework-agnostic TypeScript library** with no backend server requirements.

**Core capabilities:**
- Topology-based rendering (Mapshaper datasets → Canvas)
- Multi-format data loading: GeoJSON, TopoJSON, ZIP Shapefiles
- Interactive editing: panning, zooming, vertex topology editing
- Multiple rendering backends: Canvas 2D (default) and Skia WASM (experimental)
- Geographic projections and coordinate transformations

---

## Repository Structure

```
emap/
├── src/
│   ├── index.ts                  # Library entry point (27 public exports)
│   ├── map/
│   │   ├── map.ts                # Core Emap class — orchestrates everything
│   │   ├── feature-query.ts      # Hit-testing and feature query
│   │   └── highlight-manager.ts  # Hover/selection highlight state
│   ├── renderer/
│   │   ├── painter.ts            # Painter interface
│   │   ├── canvas-painter.ts     # HTML5 Canvas 2D (default, fast)
│   │   └── canvaskit-painter.ts  # Skia WASM (experimental)
│   ├── source/
│   │   ├── topology-source.ts    # Data loading: GeoJSON/TopoJSON/ZIP
│   │   ├── source.ts             # Source interfaces
│   │   ├── layer-utils.ts        # Layer helpers
│   │   └── display-arcs.ts       # Level of Detail (LOD) management
│   ├── geo/
│   │   ├── viewport.ts           # View transforms and zoom animations
│   │   ├── projection.ts         # CRS and coordinate conversions
│   │   ├── bounds.ts             # Bounding box operations
│   │   └── transform.ts          # 2D affine transforms (mx, my, bx, by)
│   ├── core/
│   │   ├── events.ts             # EventDispatcher base class
│   │   ├── interactions.ts       # Mouse wheel zoom
│   │   ├── drag-pan-handler.ts   # Drag-to-pan
│   │   └── tween.ts              # Animation tweening
│   ├── ui/
│   │   ├── control.ts            # Control lifecycle interface (onAdd/onRemove)
│   │   ├── navigation-control.ts # Zoom/pan buttons
│   │   ├── vertex-edit-control.ts# Topology-aware vertex dragging
│   │   ├── edit-toolbar.ts       # Toolbar wrapping edit controls
│   │   ├── status-control.ts     # Mouse position and EPSG display
│   │   ├── basemap-control.ts    # MapLibre raster basemap toggle
│   │   └── controls.css          # Control stylesheet
│   ├── types/
│   │   ├── mapshaper-types.ts    # Central Mapshaper interface definitions
│   │   ├── mapshaper.d.ts        # Mapshaper module declaration
│   │   └── mproj.d.ts            # mproj projection library types
│   └── shim.ts                   # Browser polyfills for Node modules
├── test/
│   └── examples/                 # Standalone HTML playgrounds for manual testing
│       ├── geojson-viewer.html
│       ├── vertex-editing.html
│       ├── china-editing.html
│       ├── canvaskit-viewer.html
│       └── feature-attributes.html
├── openspec/                     # Spec-driven development (see below)
│   ├── AGENTS.md                 # OpenSpec workflow guide for AI assistants
│   ├── project.md                # Project-level conventions
│   ├── specs/                    # Current capabilities (what IS built)
│   └── changes/                  # Active proposals (what SHOULD change)
├── dist/                         # Build outputs (gitignored)
├── rollup.config.mjs
├── tsconfig.json
├── package.json
├── AGENTS.md                     # Short AI context + OpenSpec pointer
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
| Rendering | HTML5 Canvas 2D / canvaskit-wasm (Skia) |
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
`src/source/display-arcs.ts` manages simplified geometry for datasets >500k points. Do not bypass LOD when rendering large datasets.

### Batch Rendering
`CanvasPainter` groups 25 shapes per `canvas.stroke()` call. Do not change this pattern without profiling — it is a deliberate performance optimization for large topology datasets.

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
| Coordinate projection / CRS | `src/geo/projection.ts`, `src/geo/viewport.ts` |
| Rendering appearance | `src/renderer/canvas-painter.ts` |
| Zoom / pan interactions | `src/core/interactions.ts`, `src/core/drag-pan-handler.ts` |
| Vertex editing | `src/ui/vertex-edit-control.ts` |
| New UI control | Add to `src/ui/`, implement `Control` interface, export from `src/index.ts` |
| Map orchestration | `src/map/map.ts` |
| Feature hit-testing | `src/map/feature-query.ts` |
| New public API | Export from `src/index.ts` |

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

Framework: **Vitest**

```bash
npm test
```

- Test files: `src/**/*.test.ts` (colocated with source)
- Mocking: Use `vi.fn()` for Mapshaper internal APIs
- Private access: Use `Reflect.get(instance, '_prop')` pattern

Current tests cover `src/ui/vertex-edit-control.ts`. Add tests alongside any new module.

---

## Important Constraints

- **Browser-only**: No Node.js runtime APIs at execution time. `src/shim.ts` polyfills any Node module references for the bundle.
- **No server**: All data is fetched client-side via `fetch()`.
- **Mapshaper internals**: The library accesses `mapshaper.internal.*` APIs directly. These are not part of mapshaper's public API — test carefully on mapshaper version upgrades.
- **CanvasKit is experimental**: Do not make CanvasKit the default renderer without profiling. It is slower than Canvas 2D for large topology datasets.
- **iconv-lite shim**: `rollup.config.mjs` aliases `iconv-lite` → `src/types/iconv-shim.ts` for browser compatibility. Do not remove this alias.
