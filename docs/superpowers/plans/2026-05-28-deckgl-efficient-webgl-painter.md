# Deck.gl-Inspired WebGL Painter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the optional luma.gl-backed WebGL renderer so it keeps `emap`'s topology-first behavior while adopting deck.gl's efficient point, line, and polygon rendering patterns.

**Architecture:** Do not wrap deck.gl at runtime. Keep `Painter` as the public renderer contract and keep Mapshaper `ArcCollection` as the data/editing source of truth. Borrow deck.gl's internal strategy: shared primitives plus instancing for fixed-size points, tessellated/cached attributes for variable-size paths and polygons, retained luma.gl `Model`/`Buffer` objects, and uniform-only updates for pan, zoom, style scale, transform, and pixel ratio.

**Tech Stack:** TypeScript, Vitest, luma.gl `Device`/`Model`/`Geometry`/`Buffer`, WebGL2, Mapshaper `ArcCollection`, existing `AffineTransform`, existing `CorePainter` and `EditPainter`.

---

## Research Summary

Local references inspected:

- `src/renderer/painter.ts`: `CorePainter` + `EditPainter` are the required surface.
- `src/renderer/webgl-painter.ts`: current implementation creates short-lived models and buffers per draw call.
- `src/renderer/webgl/geometry.ts`: current conversion helpers rebuild `Float32Array` geometry from Mapshaper iterators.
- `src/map/map.ts`: render loop already passes `DisplayArcs.getScaledArcs(pixelSize)` into painter methods.
- `/Users/zhang/code/emap-reference/deck.gl/modules/layers/src/scatterplot-layer/scatterplot-layer.ts`: points are instanced quads with per-instance position/radius/color attributes.
- `/Users/zhang/code/emap-reference/deck.gl/modules/layers/src/path-layer/path-layer.ts` and `path-tesselator.ts`: paths are tessellated into packed attributes and drawn with instanced segment context.
- `/Users/zhang/code/emap-reference/deck.gl/modules/layers/src/solid-polygon-layer/polygon-tesselator.ts`: polygons are normalized/tessellated once and drawn from retained position/index attributes.
- `/Users/zhang/code/emap-reference/luma.gl/modules/engine/src/model/model.ts` and `geometry/gpu-geometry.ts`: luma `Model` owns pipeline state; `Buffer`/`Geometry` hold retained GPU data.

Official docs checked:

- deck.gl layer attributes: fixed primitives use instanced attributes; variable primitives require tessellation.
- deck.gl performance guide: avoid data changes and rebuilds; prefer binary/typed-array data.
- luma.gl `Model`: owns shaders, geometry, attributes, bindings, and draw calls.
- luma.gl `Buffer`: immutable-size GPU buffers with vertex/index/uniform usage flags.

## Non-Goals

- Do not add `@deck.gl/*` as runtime dependencies for this renderer.
- Do not replace `ArcCollection`, `TopologySource`, or Mapshaper edit commands.
- Do not move selection, snapping, shared-node movement, shared-edge split, or topology mutation into GPU code.
- Do not change Canvas 2D default behavior.
- Do not rely on browser `gl.lineWidth` for styled lines.

## File Structure

- Modify `src/renderer/webgl-painter.ts`: turn the current per-call renderer into a retained-model painter that still implements all `Painter` methods.
- Modify `src/renderer/webgl/geometry.ts`: split pure conversion helpers into point, line, polygon, and overlay builders.
- Create `src/renderer/webgl/models.ts`: owns reusable luma `Model` creation for point, line, polygon/stencil, and overlay passes.
- Create `src/renderer/webgl/cache.ts`: caches CPU typed arrays and GPU buffers by source arcs, render kind, filter identity, and topology revision.
- Create `src/renderer/webgl/shaders.ts`: stores GLSL shader sources for position transform, instanced circles, screen-space line expansion, and stencil/fill passes.
- Create `src/renderer/webgl/frame.ts`: computes per-frame uniforms from `AffineTransform`, viewport size, pixel ratio, and style values.
- Create `src/renderer/webgl/cache.test.ts`: verifies revision-based cache reuse and invalidation.
- Modify `src/renderer/webgl/geometry.test.ts`: add line segment, polygon ring, reversed arc, and edit overlay cases.
- Modify `src/renderer/webgl-painter.test.ts`: assert full `Painter` parity and retained model reuse.
- Modify `src/map/map.ts`: call optional WebGL cache invalidation hooks when topology sources mark display arcs dirty.
- Modify `src/source/display-arcs.ts` and `src/source/topology-source.ts`: expose a render revision counter without changing `ArcCollection`.
- Modify docs in `README.md`: document `renderer: 'webgl'`, Canvas fallback, topology guarantees, and known performance/correctness boundaries.

## Core Design

### 1. Keep `Painter` as the Compatibility Boundary

`WebGLPainter` must continue to implement:

```ts
export type Painter = EditPainter;
```

It may expose extra optional methods for cache invalidation, but callers must still be able to treat it as a plain `Painter`:

```ts
export interface WebGLCacheInvalidator {
  invalidateArcs(arcs: ArcCollection): void;
  invalidateAll(): void;
}
```

Canvas does not implement this optional interface. `map.ts` should detect it with a local type guard before calling it.

### 2. Use deck.gl's Fixed vs Variable Primitive Split

Points are fixed primitive rendering:

- Reuse one unit quad model.
- Upload point coordinates as an instanced `instancePositions` buffer.
- Use uniforms for transform, viewport size, radius, color, and pixel ratio.
- Update only uniforms during pan/zoom.

Lines and polygons are variable primitive rendering:

- Convert `ArcCollection` into packed typed arrays once per topology revision.
- Keep arc-to-segment/ring metadata so layer filters do not re-walk every shape from scratch.
- Use retained luma buffers where capacity is sufficient.
- Recreate buffers only when topology revision, active LOD arc collection, or selected filter scope changes.

### 3. Topology Stays in Mapshaper

The render path must be:

```txt
Mapshaper ArcCollection
  -> DisplayArcs.getScaledArcs(pixelSize)
  -> WebGL derived typed arrays and GPU buffers
  -> luma.gl Model.draw()
```

The edit path remains:

```txt
pointer/edit handler
  -> Mapshaper topology API / existing edit command
  -> DisplayArcs.markDirty()
  -> WebGL cache invalidation
  -> next render rebuilds derived buffers
```

This preserves shared-node movement and shared-edge splitting because the GPU buffers are never authoritative.

## Task 1: Add Render Revision Plumbing

**Files:**
- Modify: `src/source/display-arcs.ts`
- Modify: `src/source/topology-source.ts`
- Modify: `src/map/map.ts`
- Test: `src/source/display-arcs.test.ts`
- Test: `src/source/topology-source.test.ts`

- [ ] **Step 1: Add failing tests for revision changes**

Add tests asserting:

```ts
const source = new TopologySource('x');
const before = source.getRenderRevision();
source.markDisplayArcsDirty();
expect(source.getRenderRevision()).toBe(before + 1);
```

Also assert `setData(...)` and dataset replacement increment revision.

- [ ] **Step 2: Implement revision counters**

Add a private counter to `TopologySource`:

```ts
private _renderRevision = 0;

getRenderRevision(): number {
  return this._renderRevision;
}

private _bumpRenderRevision(): void {
  this._renderRevision++;
}
```

Call `_bumpRenderRevision()` after topology-affecting changes and when `DisplayArcs.markDirty()` is invoked through the source.

- [ ] **Step 3: Invalidate WebGL cache from the map layer**

In `map.ts`, after topology mutations or source dirty calls already happen, call:

```ts
function invalidatePainterArcs(painter: Painter, arcs: ArcCollection | null): void {
  if (!arcs) return;
  const maybe = painter as Painter & Partial<WebGLCacheInvalidator>;
  maybe.invalidateArcs?.(arcs);
}
```

Keep this helper near renderer plumbing, not in edit command files.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/source/display-arcs.test.ts src/source/topology-source.test.ts
npm run typecheck
```

Expected: PASS.

## Task 2: Introduce WebGL Frame and Model Units

**Files:**
- Create: `src/renderer/webgl/frame.ts`
- Create: `src/renderer/webgl/models.ts`
- Create: `src/renderer/webgl/shaders.ts`
- Modify: `src/renderer/webgl-painter.ts`
- Test: `src/renderer/webgl-painter.test.ts`

- [ ] **Step 1: Extract frame uniforms**

Create:

```ts
export interface WebGLFrameState {
  matrix: Float32Array;
  viewportSize: [number, number];
  pixelRatio: number;
}

export function makeFrameState(
  transform: AffineTransform,
  width: number,
  height: number,
  pixelRatio: number,
): WebGLFrameState;
```

The matrix must preserve the existing `_matrix()` behavior.

- [ ] **Step 2: Add retained model owners**

Create model wrappers:

```ts
export interface WebGLDrawable {
  draw(renderPass: RenderPass): void;
  destroy(): void;
}

export class PointQuadModel implements WebGLDrawable {}
export class LineSegmentModel implements WebGLDrawable {}
export class PolygonFillModel implements WebGLDrawable {}
export class SolidColorModel implements WebGLDrawable {}
```

Each class owns one luma `Model` and exposes methods to update uniforms and replace buffers.

- [ ] **Step 3: Update painter lifecycle**

`WebGLPainter` should create model owners lazily, reuse them across draw calls, and destroy them only on painter destruction or context loss. Do not create and destroy a luma `Model` inside every `drawPoints`, `drawArcs`, or `drawPolygonFill` call.

- [ ] **Step 4: Verify retained reuse**

Update `webgl-painter.test.ts` so two consecutive `drawPoints(...)` calls with the same model type create one model and issue two draws.

Run:

```bash
npm run test:run -- src/renderer/webgl-painter.test.ts
```

Expected: PASS.

## Task 3: Rebuild Points as Scatterplot-Style Instanced Quads

**Files:**
- Modify: `src/renderer/webgl/geometry.ts`
- Modify: `src/renderer/webgl/shaders.ts`
- Modify: `src/renderer/webgl/models.ts`
- Modify: `src/renderer/webgl-painter.ts`
- Test: `src/renderer/webgl/geometry.test.ts`
- Test: `src/renderer/webgl-painter.test.ts`

- [ ] **Step 1: Keep point conversion as instance data**

Ensure `buildPointGeometry(shapes)` returns only point centers:

```ts
{
  positions: Float32Array; // [x0, y0, x1, y1, ...]
  vertexCount: number;    // point count
}
```

- [ ] **Step 2: Use one shared quad**

Keep:

```ts
[-1, -1, 1, -1, -1, 1, 1, 1]
```

as the per-vertex geometry and upload point centers as `instancePositions`.

- [ ] **Step 3: Match Canvas point semantics**

The fragment shader must discard pixels outside the unit circle and apply antialiasing with `fwidth`. Radius must use `style.radius * pixelRatio`, matching Canvas visual size.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts src/renderer/webgl-painter.test.ts
```

Expected: tests confirm instance count, radius scaling, viewport uniform, and no Canvas 2D usage.

## Task 4: Rework Lines as PathLayer-Style Segment Attributes

**Files:**
- Modify: `src/renderer/webgl/geometry.ts`
- Modify: `src/renderer/webgl/shaders.ts`
- Modify: `src/renderer/webgl/models.ts`
- Modify: `src/renderer/webgl/cache.ts`
- Modify: `src/renderer/webgl-painter.ts`
- Test: `src/renderer/webgl/geometry.test.ts`
- Test: `src/renderer/webgl/cache.test.ts`

- [ ] **Step 1: Add arc segment builder**

Build packed segment records from an `ArcCollection`:

```ts
export interface ArcSegmentGeometry {
  leftPositions: Float32Array;
  startPositions: Float32Array;
  endPositions: Float32Array;
  rightPositions: Float32Array;
  segmentTypes: Uint8Array;
  arcIds: Uint32Array;
  segmentCount: number;
  arcSegmentStarts: Uint32Array;
  arcSegmentCounts: Uint32Array;
}
```

This mirrors deck.gl `PathLayer`'s left/start/end/right segment context, letting the vertex shader expand width in screen space.

- [ ] **Step 2: Preserve arc direction**

For `drawPaths(shapes, style, arcs)`, collect requested arc ids as today. For `drawArcs(arcs, style, filter)`, filter by normalized arc id. The segment builder should never mutate or reorder `ArcCollection`.

- [ ] **Step 3: Expand line width in shader**

The line vertex shader should receive segment context and produce triangle-list vertices for each segment. It must use the frame matrix and viewport size so line width remains in CSS pixels regardless of map units.

- [ ] **Step 4: Keep a CPU-expanded fallback only for overlays**

Editing rubber-band overlays can keep `buildExpandedLineGeometry(...)` because they are tiny and change every pointer move. Dataset lines should use retained segment attributes.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts src/renderer/webgl/cache.test.ts src/renderer/webgl-painter.test.ts
```

Expected: tests cover multi-arc lines, reversed arcs, width scaling under transform, and reuse of cached segment data.

## Task 5: Preserve Polygon Correctness Before Polygon Speed

**Files:**
- Modify: `src/renderer/webgl/geometry.ts`
- Modify: `src/renderer/webgl/shaders.ts`
- Modify: `src/renderer/webgl/models.ts`
- Modify: `src/renderer/webgl/cache.ts`
- Modify: `src/renderer/webgl-painter.ts`
- Test: `src/renderer/webgl/geometry.test.ts`
- Test: `src/renderer/webgl-painter.test.ts`

- [ ] **Step 1: Keep shape-aware ring extraction**

Use `arcs.getShapeIter(part)` for polygon rings. Do not use raw `getArcIter` for polygon fill because reversed arcs and ring boundaries matter.

- [ ] **Step 2: Maintain Canvas even-odd fill semantics**

Primary implementation:

```txt
ring extraction -> stencil toggle pass -> viewport quad color pass
```

Do not claim polygon parity until tests cover:

- one outer ring;
- one hole;
- reversed arc ids;
- multiple parts;
- viewport-filtered rings.

- [ ] **Step 3: Plan optional tessellation acceleration separately**

Deck.gl uses polygon tessellation and indices for fast fills. Add this only after parity if a direct dependency on an earcut-capable package is approved. Until then, prefer correct stencil fill over an incorrect fan triangulation.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts src/renderer/webgl-painter.test.ts
```

Expected: WebGL fill tests prove the same ring selection and even-odd behavior expected by Canvas.

## Task 6: Add Cache Reuse and Invalidation

**Files:**
- Create: `src/renderer/webgl/cache.ts`
- Test: `src/renderer/webgl/cache.test.ts`
- Modify: `src/renderer/webgl-painter.ts`
- Modify: `src/map/map.ts`

- [ ] **Step 1: Cache by arc collection and revision**

Use a `WeakMap<ArcCollection, ArcCacheRecord>`.

Each record stores:

```ts
interface ArcCacheRecord {
  revision: number;
  arcCount: number;
  pointCount: number;
  lineSegments?: ArcSegmentGeometry;
  polygonRings?: PolygonRingGeometry;
  gpuBuffers: Map<string, WebGLBufferRecord>;
}
```

- [ ] **Step 2: Detect stale records conservatively**

Rebuild if:

- `revision` differs;
- `arcs.size()` differs;
- `arcs.getPointCount?.()` differs;
- retained interval changes;
- caller explicitly invalidated the arcs.

If revision is missing, favor correctness and rebuild on each topology edit frame.

- [ ] **Step 3: Keep filters separate from base geometry**

Base geometry cache is per `ArcCollection`. Layer and viewport filters produce derived draw ranges or compact instance buffers. Cache those derived buffers with a small LRU keyed by filter scope when stable; otherwise rebuild the compact buffer from cached base segment data.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/renderer/webgl/cache.test.ts
npm run typecheck
```

Expected: cache tests prove warm redraws skip iterator walks and dirty topology invalidates stale buffers.

## Task 7: Match Edit Overlay Parity

**Files:**
- Modify: `src/renderer/webgl-painter.ts`
- Modify: `src/renderer/webgl/geometry.ts`
- Test: `src/renderer/webgl-painter.test.ts`

- [ ] **Step 1: Vertex dots**

Implement `drawVertexDots` with instanced quads so hover and normal dots match Canvas sizes and colors.

- [ ] **Step 2: Drawing overlay**

Implement `drawDrawingOverlay`:

- placed vertices as point instances;
- rubber-band line as CPU-expanded small overlay geometry;
- polygon closing segment when drawing polygons;
- snap indicator as a larger point instance.

- [ ] **Step 3: Overlay ordering**

Keep the existing order: polygon edit fill first, then vertex dots; drawing overlay line first, then vertices/snap marker.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/renderer/webgl-painter.test.ts src/core/handlers/draw-feature.test.ts src/core/handlers/vertex-edit.test.ts
```

Expected: WebGL painter tests cover overlay method calls and existing handler tests still pass.

## Task 8: Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document behavior**

Document:

- Canvas remains default.
- `renderer: 'webgl'` and `renderer: 'auto'` fallback behavior.
- `ArcCollection` remains the source of truth.
- WebGL buffers are derived render artifacts.
- Polygon fill is correctness-first with stencil; tessellation acceleration is a later optional step.

- [ ] **Step 2: Run standard verification**

Run:

```bash
npm run typecheck
npm run test:run
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run a manual example check**

Start the local example workflow used by this repo and verify:

- Canvas default still renders.
- `renderer: 'webgl'` renders point, line, fill layers.
- vertex edit handles shared-node movement without stale GPU geometry.
- shared-edge split updates line/fill geometry on the next frame.
- draw mode overlay renders vertices, rubber-band lines, and snap marker.

Record the manual browser route and observed result in the final report.

## Acceptance Criteria

- `WebGLPainter` implements every `CorePainter` and `EditPainter` method.
- Point rendering uses retained instanced quads, not per-point CPU circles.
- Dataset line rendering uses retained segment attributes and shader expansion, not per-frame CPU triangle expansion.
- Polygon fill remains shape-aware and even-odd correct.
- `AffineTransform`, viewport size, and pixel ratio are uniforms, so pan/zoom does not rebuild geometry.
- `resize()` updates canvas drawing buffer, luma canvas context, viewport, and frame uniforms.
- `clear()` clears color, depth, and stencil consistently.
- Topology edits mutate Mapshaper data only; WebGL cache is invalidated and rebuilt from `ArcCollection`.
- Canvas remains default and fallback remains available.
- Verification includes typecheck, tests, build, and manual edit/render checks.

## Risks

- Persistent GPU caching is unsafe without a reliable topology revision. Add revision plumbing before enabling long-lived arc buffers.
- Polygon fill speed should not be optimized with naive fan triangulation; that risks incorrect concave polygons and holes.
- Viewport/layer filters may still require compact buffer rebuilds. This is acceptable if base arc iteration is cached and warm redraw avoids full Mapshaper iterator walks.
- Adding true deck.gl-style polygon tessellation may require an approved earcut-capable dependency or a Mapshaper adapter helper.
