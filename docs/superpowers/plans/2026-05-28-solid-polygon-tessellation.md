# Solid Polygon Tessellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WebGL polygon fill's stencil fan path with a deck.gl `SolidPolygonLayer`-style tessellation path.

**Architecture:** Keep `ArcCollection` and Mapshaper edit APIs as the authoritative topology layer. Convert shape-aware polygon rings into deck-style normalized flat polygon geometry, triangulate with `earcut`, then draw indexed `triangle-list` geometry through retained luma models. Fill remains separate from polygon outlines, which continue through the PathLayer-style `drawArcs` line path.

**Tech Stack:** TypeScript, luma.gl `Model`/`Buffer`, `earcut`, `@math.gl/polygon`, Vitest.

---

### Task 1: Lock Polygon Tessellation Behavior

**Files:**
- Modify: `src/renderer/webgl/geometry.test.ts`
- Modify: `src/renderer/webgl-painter.test.ts`

- [ ] **Step 1: Write failing geometry tests**

Add tests proving polygon rings become SolidPolygonLayer-style typed positions plus triangle indices:

```ts
it('tessellates a polygon ring into indexed triangle geometry', () => {
  const geometry = buildPolygonTessellatedGeometry([[[0]]], makeSquareArcs() as any);
  expect(Array.from(geometry.positions)).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  expect(Array.from(geometry.indices)).toHaveLength(6);
  expect(geometry.vertexCount).toBe(6);
});
```

- [ ] **Step 2: Write failing painter test**

Add a WebGLPainter test proving `drawPolygonFill()` sends indexed triangle geometry to luma instead of stencil draw passes:

```ts
expect(props.shaderKind).toBe('solid');
expect(props.topology).toBe('triangle-list');
expect(props.indices).toBeInstanceOf(Uint32Array);
expect(draw).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Run red tests**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts src/renderer/webgl-painter.test.ts
```

Expected: fail because `buildPolygonTessellatedGeometry` and indexed model props do not exist yet.

### Task 2: Add Tessellation Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install earcut @math.gl/polygon
```

Expected: `package.json` gains runtime dependencies and lockfile updates.

### Task 3: Implement Deck-Style Polygon Geometry

**Files:**
- Modify: `src/renderer/webgl/geometry.ts`

- [ ] **Step 1: Add tessellated geometry type**

Expose:

```ts
export interface WebGLPolygonTessellatedGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}
```

- [ ] **Step 2: Implement shape-aware ring normalization**

Use `arcs.getShapeIter(part)` so reversed arcs and shared topology stay Mapshaper-correct. Preserve the deck.gl data flow: flat ring positions, hole start indices, and one global vertex offset per polygon.

- [ ] **Step 3: Triangulate with earcut**

Call `earcut(flatPositions, holeIndices, 2)` for each polygon, offset returned indices by accumulated vertex count, and return typed arrays.

### Task 4: Draw Indexed Polygons Through luma

**Files:**
- Modify: `src/renderer/webgl/models.ts`
- Modify: `src/renderer/webgl-painter.ts`

- [ ] **Step 1: Add `indices` to retained model props**

Create and update an index buffer with `Buffer.INDEX | Buffer.COPY_DST`.

- [ ] **Step 2: Enable indexed luma draw**

Pass `isIndexed: true` and `indexBuffer`/`indices` equivalent according to the local luma API used in this repo.

- [ ] **Step 3: Replace stencil fill path**

Change `drawPolygonFill()` to call `buildPolygonTessellatedGeometry()` and draw one indexed `triangle-list` model with `u_matrix` and fill color uniforms.

### Task 5: Verify

**Files:**
- No source changes.

- [ ] **Step 1: Run focused tests**

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts src/renderer/webgl-painter.test.ts src/renderer/webgl/models.test.ts
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Run full tests and build**

```bash
npm run test:run
npm run build
```
