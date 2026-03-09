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

`emap` is a modern, topology-oriented map rendering and editing engine built around `mapshaper` data structures and `Canvas`.

**Core Technical Stack**:

- Renderers: Direct HTML5 API (`CanvasPainter`) and WASM Skia (`CanvasKitPainter`).
- Data Parser / Projector: `mapshaper`, `fflate` for unzipping shapefiles.
- Build System: Rollup with Typescript configuration. Bundle is output to `dist/emap.js` and `dist/emap-dev.js`.

**Project Structure**:

- `src/map/map.ts`: The `Emap` core engine which manages multiple sources, interactive events, UI controls, and triggers render loops.
- `src/source/`: Data loading layer (e.g. `TopologySource.fromUrl()`) which handles GeoJSON, TopoJSON, and ZIP Shapefile downloads, simplification, caching.
- `src/renderer/`: Hardware/software drawing execution using specific painters.
- `src/core/` / `src/geo/`: Interactive modules (Wheel, Drag) and spatial projection/viewport calculations.
- `src/ui/`: Built-in map overlays and UI control abstractions.
- `test/examples/`: Quick HTML playgrounds covering vertex-editing, GeoJSON loading features to manually test build results.

**Guidance for AI changes**:

- Changes to map data loading or projections usually lie in `src/source/topology-source.ts` and `src/geo/projection.ts`.
- Changes to user interactions (panning, modifying points) interact tightly with `map.ts` (EventDispatcher), `src/core/*`, and `src/renderer/` methods. Let rendering run in the `render()` loop and defer DOM updates logically.
