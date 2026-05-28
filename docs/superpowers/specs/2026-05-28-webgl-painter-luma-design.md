# WebGL Painter with luma.gl Design

> **Status:** Approved for phased design direction (brainstorm artifact).
> Scope approved on 2026-05-28: build WebGL painter in phases, start with
> standalone painter parity and Canvas fallback, then add performance caches,
> then integrate MapLibre Custom Layer rendering.

## 1. Problem and Goal

`emap` currently renders through Canvas 2D only. `Emap` owns one canvas,
constructs `CanvasPainter` directly, and the render loop talks to the
`Painter` interface. This keeps the engine simple, but it limits large topology
rendering: Canvas path construction and draw order force expensive top-layer
batching, especially for polygon fills and multi-layer datasets.

The goal is to add an optional WebGL renderer backed by luma.gl while preserving
the existing topology-first architecture:

- `ArcCollection` remains the data and editing source of truth.
- Editing operations continue to use Mapshaper APIs through
  `MapshaperAdapter`.
- Canvas 2D remains the default renderer.
- WebGL can be selected with a renderer option and falls back to Canvas when
  unavailable.
- MapLibre integration uses a later Custom Layer path that can share the
  MapLibre WebGL context.

## 2. Existing Boundaries

### 2.1 Painter surface

`src/renderer/painter.ts` defines `Painter = EditPainter`. A WebGL painter must
implement the full edit-aware surface:

- `drawPaths(shapes, style, arcs)`
- `drawArcs(arcs, style, filter?)`
- `drawPoints(shapes, style)`
- `drawPolygonFill(shapes, arcs, fillColor, filter?, opacity?)`
- `drawVertexDots(shapes, arcs, style)`
- `drawDrawingOverlay(state)`
- `clear()`
- `resize(width, height)`
- `setTransform(transform)`
- `setPixelRatio(ratio)`

The existing `EditOverlayRenderer` already depends only on `EditPainter`, so
edit overlays can remain painter-agnostic.

### 2.2 Render loop

`src/map/map.ts` currently constructs `new CanvasPainter(this._canvas)` in the
`Emap` constructor. `_renderImpl()` then sets the current `AffineTransform`,
clears, renders layers, renders highlights, and renders edit overlays.

This is the correct insertion point for a renderer factory. The render loop
should continue to depend on `Painter`, not on concrete renderer classes.

### 2.3 Topology and LOD

`TopologySource` exposes Mapshaper arcs and a `DisplayArcs` wrapper. The render
loop asks `DisplayArcs.getScaledArcs(pixelSize)` for the appropriate
`ArcCollection` and uses viewport arc filters. WebGL conversion must happen
after this point: the renderer receives an `ArcCollection` and builds GPU-ready
typed arrays from it.

`DisplayArcs.markDirty()` already represents topology edits that invalidate
derived arc data. WebGL cache invalidation should align with this model rather
than introducing a second editing data path.

## 3. Phased Architecture

### Phase 1: Standalone WebGL painter parity

Add a renderer option and a WebGL painter that draws into `emap`'s own canvas.

Public API:

```ts
export type RendererType = 'canvas' | 'webgl' | 'auto';

export interface MapOptions {
  container: string | HTMLElement;
  renderer?: RendererType;
  // existing options unchanged
}
```

Behavior:

- Omitted `renderer` means `'canvas'`.
- `'canvas'` always constructs `CanvasPainter`.
- `'webgl'` attempts `WebGLPainter`; if initialization fails, it falls back to
  `CanvasPainter` and logs a warning.
- `'auto'` attempts `WebGLPainter` first and falls back to `CanvasPainter`.
- `getPainter()` still returns the active `Painter`.

Files:

- Add `src/renderer/webgl-painter.ts`.
- Add `src/renderer/painter-factory.ts`.
- Modify `src/map/types.ts` to add `RendererType` and `MapOptions.renderer`.
- Modify `src/map/map.ts` to call the factory instead of `new CanvasPainter`.
- Export `WebGLPainter` and `RendererType` from `src/index.ts`.

Rendering scope:

- Lines: convert arcs to polyline vertex buffers, draw with luma.gl `Model`
  and `Geometry`. Phase 1 may accept browser/WebGL line-width limitations only
  if tests and docs call this out. The preferred implementation expands lines
  into triangle geometry so line width, joins, and caps are controlled by emap.
- Points: convert normalized point shapes into point or quad geometry with
  style uniforms.
- Polygon fills: use shape-aware iteration (`getShapeIter`) so reversed arcs
  keep correct winding. Fill rendering must preserve Canvas `evenodd`
  semantics. If stencil fill is required for correctness, implement it in
  Phase 1 before claiming polygon parity.
- Edit overlays: implement vertex dots, hover square/circle affordances,
  drawing overlay segments, rubber-band lines, placed vertices, and snap
  indicator.
- Transform: convert `AffineTransform` plus pixel ratio into shader uniforms.

Phase 1 success criteria:

- Canvas remains default and existing behavior is unchanged.
- `renderer: 'webgl'` creates a WebGL painter when supported.
- WebGL painter implements the complete `Painter` interface.
- Initialization failure falls back to Canvas.
- Existing Canvas tests continue to pass.
- New unit tests cover factory fallback and WebGL geometry conversion helpers.

### Phase 2: Geometry cache and performance work

Add explicit conversion and cache units. This phase is where WebGL should start
outperforming Canvas for large datasets.

Files:

- Add `src/renderer/webgl/arc-geometry-cache.ts`.
- Add `src/renderer/webgl/shape-geometry-builder.ts`.
- Add `src/renderer/webgl/style-uniforms.ts`.
- Add focused tests beside each file.

Responsibilities:

- Convert Mapshaper `Float64Array` vertex data and iterators into WebGL
  `Float32Array` buffers.
- Preserve topology indexing in cache metadata while exposing contiguous
  buffers to luma.gl.
- Cache by active `ArcCollection` identity, style class, filter generation, and
  geometry kind.
- Support viewport filters and dirty arc filters without mutating
  `ArcCollection`.
- Invalidate or rebuild cache entries when the active `ArcCollection` changes,
  arc count changes, or dirty edits require a rebuild.
- Keep editing operations on Mapshaper data structures. GPU buffers are derived
  render artifacts only.

Performance benchmarks:

- Add benchmark fixtures under `test/examples` or a dedicated benchmark helper.
- Compare Canvas and WebGL frame time for line-heavy, polygon-heavy, and mixed
  multi-layer datasets.
- Track cold conversion cost separately from warm cached draw cost.

Phase 2 success criteria:

- Warm WebGL redraws avoid rebuilding unchanged buffers.
- Dirty edits rebuild only affected cache scopes where practical.
- Benchmark documentation records Canvas vs WebGL results and known limits.

### Phase 3: MapLibre Custom Layer integration

Current `BasemapControl` owns an independent MapLibre map behind the emap
canvas. That is compatible with Phase 1 and Phase 2, but it does not share a GL
context. Shared-context rendering requires a separate MapLibre custom layer
path.

Design:

- Add a MapLibre custom layer adapter that owns or delegates a `WebGLPainter`
  configured against the WebGL context passed to `onAdd(map, gl)`.
- Use MapLibre's render callback matrix for projection when rendering inside
  the MapLibre frame.
- Use `renderingMode: '3d'` only when depth-buffer ordering is required for
  multi-layer interleaving; otherwise prefer `'2d'`.
- Handle `webglcontextlost` and `webglcontextrestored`.
- Keep `BasemapControl` usable in its current independent-map mode.
- Add an opt-in integration path rather than changing default basemap behavior.

References:

- MapLibre CustomLayerInterface: custom layers render into the map GL context,
  receive the GL context in `onAdd`, and receive the map projection matrix in
  `render`.
- luma.gl `Model`: owns shaders, geometry, pipeline state, and draw calls.
- luma.gl `Geometry`: stores CPU typed-array attributes and optional indices.
- luma.gl WebGL `Device`: can attach to or create a WebGL context, but WebGL
  devices render to the canvas/context they are created with.

Phase 3 success criteria:

- emap can render as a MapLibre custom layer.
- The custom layer shares MapLibre's WebGL context.
- MapLibre matrix transforms are used instead of emap's canvas transform when
  in custom layer mode.
- Existing `BasemapControl` behavior remains compatible.

## 4. Shader and Geometry Strategy

### Lines

The implementation should prefer CPU-expanded line quads over relying on
`gl.lineWidth`, because browser WebGL line-width support is inconsistent. The
line builder should output triangles with per-vertex side/segment metadata and
style uniforms for width, color, cap, and join behavior.

### Points

Point rendering can start with instanced quads or point sprites. Instanced
quads are preferred if luma.gl setup is straightforward because they give
consistent radius and hover styling across browsers.

### Polygons

Polygon fill must match Canvas `fill('evenodd')`. A stencil-based fill path is
the most direct WebGL equivalent for arbitrary polygon rings and holes. If the
first implementation uses triangulation instead, it must prove evenodd behavior
for reversed arcs and holes before it is accepted.

### Edit overlays

Edit overlay rendering should use the same painter methods as Canvas. The map
and handlers should not learn whether the active renderer is Canvas or WebGL.

## 5. Error Handling

Renderer creation is the only place that should decide fallback:

```ts
try {
  return new WebGLPainter(canvas, options);
} catch (error) {
  console.warn('emap: WebGL renderer unavailable, falling back to Canvas 2D', error);
  return new CanvasPainter(canvas);
}
```

Rendering failures after construction should not silently switch renderers
inside a frame. If runtime context loss is detected, the WebGL painter should
release resources and ask the map to recreate or fall back on the next render
cycle. The first implementation may document runtime context-loss fallback as a
Phase 3 requirement if standalone WebGL tests cannot simulate it reliably.

## 6. Testing Plan

Unit tests:

- `painter-factory.test.ts`: default Canvas, explicit Canvas, WebGL fallback,
  and `auto` fallback.
- `webgl-geometry-builder.test.ts`: arc conversion, reversed arc handling,
  point shape normalization, polygon shape iteration, viewport filter handling.
- `webgl-style-uniforms.test.ts`: color parsing, opacity multiplication,
  pixel-ratio-scaled sizes.

Integration tests:

- `Emap` constructs Canvas by default.
- `renderer: 'webgl'` uses WebGL when a test double factory succeeds.
- Edit overlay calls work through `EditOverlayRenderer` with a WebGL painter
  test double.

Manual/benchmark tests:

- Render line, fill, circle, highlight, vertex edit, and draw overlay examples
  in Canvas and WebGL modes.
- Compare cold and warm frame time on large line and polygon datasets.

Verification commands:

```bash
npm run typecheck
npm run test:run
npm run build
```

## 7. Scope Decisions

In scope for the first implementation plan:

- Phase 1.
- The smallest geometry conversion helpers needed to keep Phase 1 testable.
- API docs for `renderer`.
- Tests for fallback and conversion correctness.

Out of scope for the first implementation plan:

- Full benchmark suite.
- MapLibre Custom Layer integration.
- Multi-layer depth-buffer interleaving.
- GPU picking.
- Symbol placement.
- Replacing Mapshaper topology or editing APIs.

These are intentionally deferred so the first WebGL branch can land a small,
reviewable renderer boundary before taking on performance and MapLibre context
sharing.
