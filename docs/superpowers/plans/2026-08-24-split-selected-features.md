# Split Selected Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add QGIS-compatible splitting of selected polyline features by a point or line and selected polygon features by a line, with duplicated attributes, deterministic IDs, final-result selection, drawing interaction, and atomic undo/redo.

**Architecture:** A new `map.ops.splitSelected()` validates the current same-source/same-layer selection and mutates a runner-owned dataset copy. Focused mapshaper adapter primitives node cutter intersections, split polyline paths, and build per-feature polygon mosaics; a selection-aware dataset replacement commits geometry and selection as one history entry. A new `map.splitFeature` handler captures a transient point or polyline sketch and delegates all geometry work to the coordinate API.

**Tech Stack:** TypeScript 5, Vitest 4, mapshaper 0.6.113 topology internals behind `MapshaperAdapter`, HTML5 Canvas edit overlay, existing `EditHistory` and operation runner.

## Global Constraints

- No new runtime dependency and no GeoJSON round-trip in production geometry code.
- Direct `mapshaper` imports remain confined to `src/adapter/mapshaper-adapter.ts`.
- The operation requires a non-empty selection from one source and one layer.
- Point cutters apply only to `polyline`; polygon targets require a polyline cutter.
- Off-line API points are rejected; only arithmetic epsilon is allowed, never user-visible projection tolerance.
- The largest result by planar length or area retains every original target index; additional results append after all pre-existing features in deterministic order.
- Every result owns a shallow copy of the original record; selected-but-unsplit targets remain selected.
- One successful call produces one dataset replacement, one history item, one final selection transition, and no surviving temporary layer or arc.
- Polygon output must cover the original feature without gaps or overlaps; invalid input geometry is rejected rather than repaired.
- The interactive cutter is transient; right click completes a polyline cutter, Escape cancels it, and success keeps the handler enabled.
- Before modifying any existing function, class, or method, run GitNexus upstream impact analysis and warn before HIGH or CRITICAL changes.
- Every shell command uses the repository-required `rtk` prefix.

---

## File Structure

### New files

- `src/edit/commands/dataset-replace-selection.ts` — one undoable dataset-and-selection replacement.
- `src/edit/commands/dataset-replace-selection.test.ts` — command do/undo/publish contract.
- `src/adapter/mapshaper-feature-split.test.ts` — real mapshaper tests for cut insertion and filtered mosaics.
- `src/map/ops/split-selected-line.ts` — selected-polyline point/line splitting.
- `src/map/ops/split-selected-line.test.ts` — point, line, multipart, and degeneracy contracts.
- `src/map/ops/split-selected-polygon.ts` — selected-polygon cutter-line mosaic splitting.
- `src/map/ops/split-selected-polygon.test.ts` — mosaic, hole, multipart, coverage, and rejection contracts.
- `src/map/ops/split-selected-error.ts` — typed geometry-validation failure translated to `Err.validation`.
- `src/map/ops/split-selected-geometry.ts` — common piece replacement, attributes, IDs, cleanup, and result mapping.
- `src/map/ops/split-selected.ts` — selection validation and prepared-mutation dispatch.
- `src/map/ops/split-selected.test.ts` — public validation, real geometry, attributes, IDs, events, and history.
- `src/map/split-selected.test-d.ts` — exported API type contract.
- `src/core/handlers/split-feature.ts` — point/polyline cutter capture handler.
- `src/core/handlers/split-feature.test.ts` — handler pointer, snapping, completion, cancellation, and failure tests.
- `packages/examples/examples/split-features/index.html` — runnable interactive demonstration.
- `test/examples/split-features.test.ts` — example wiring contract.

### Modified files

- `src/adapter/mapshaper-adapter.ts` — expose only the topology primitives required by split geometry.
- `src/map/ops/_context.ts` — add prepared dataset mutation interface.
- `src/map/ops/_runner.ts` — commit a shape-count mutation with explicit final selection and payload.
- `src/map/mapshaper-ops.ts` — wire `splitSelected()` and the prepared mutation runner.
- `src/map/types.ts` — public cutter, operation result, and handler option types.
- `src/map/edit-state-store.ts` — add mutually exclusive `split` edit mode while reusing draw state.
- `src/renderer/edit-overlay-renderer.ts` — render the drawing overlay in split mode.
- `src/core/handlers/edit-handler-host.ts` — expose selection and the narrow split operation to the handler.
- `src/core/handlers/selection-handler-host.ts` — expose `getSelection()`.
- `src/map/map.ts` — construct/register/expose the split handler and block pan during split capture.
- `src/index.ts` — export new public types and handler.
- `src/map/ops/_runner.test.ts` — prepared mutation and one-transition selection tests.
- `src/map/edit-state-store.test.ts` — split-mode draw-state lifetime.
- `src/renderer/edit-overlay-renderer.test.ts` — split overlay rendering.
- `src/map/handler-registry.test.ts` — split handler registration and mode exclusivity.
- `docs-meta/examples.ts` — register the runnable example; preserve unrelated user edits already present in this file.
- `packages/docs/docs/data/operations.md` — Chinese coordinate API and handler usage.
- `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/operations.md` — matching English documentation.
- `CHANGELOG.md` — unreleased feature entry.

---

### Task 1: Atomic Dataset and Selection Replacement

**Files:**
- Create: `src/edit/commands/dataset-replace-selection.ts`
- Create: `src/edit/commands/dataset-replace-selection.test.ts`
- Modify: `src/map/ops/_context.ts:41-67`
- Modify: `src/map/ops/_runner.ts:50-57,69-111,291-347,477-499`
- Modify: `src/map/mapshaper-ops.ts:117-133`
- Modify: `src/map/ops/_test-helpers.ts:17-55`
- Test: `src/map/ops/_runner.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PreparedDatasetMutationResult<T> {
  value: T;
  selection: FeatureRef[];
}

export type RunPreparedDatasetMutation = <T>(
  sourceId: string,
  label: string | ((value: T) => string),
  mutate: (
    working: MapshaperDataset,
    original: MapshaperDataset,
  ) => PreparedDatasetMutationResult<T> | OpResult<T> | Promise<PreparedDatasetMutationResult<T> | OpResult<T>>,
) => Promise<OpResult<T>>;
```

- Produces internal `DatasetReplaceSelectionCommand`, which restores `{dataset, selection}` together on `do()` and `undo()` and publishes one source data event plus the stored selection diff.
- Later tasks consume `OpContext.runPreparedDatasetMutation`.

- [ ] **Step 1: Run impact analysis before editing runner and command boundaries**

Use GitNexus upstream impact on `_runPreparedDatasetCommandParsed`, `runDatasetMutation`, `commitDatasetReplace`, `DatasetReplaceCommand`, and `MapshaperOps._ctx`. If any result is HIGH or CRITICAL, report it before touching files.

- [ ] **Step 2: Write the failing selection-aware command tests**

Cover exact dataset and selection transitions:

```ts
it('undo and redo restore dataset and selection together', () => {
  const originalSelection = selection.getAll();
  const beforeSelection = selection.snapshot();
  const afterSelection = [
    { source: 's', layer: 'roads', id: 0 },
    { source: 's', layer: 'roads', id: 1 },
  ];
  const command = new DatasetReplaceSelectionCommand({
    source,
    before,
    after,
    label: 'Split 1 feature',
    selection,
    beforeSelection,
    afterSelection,
    publishSelection,
  });

  command.do();
  expect(source.setDataset).toHaveBeenLastCalledWith(after, false);
  expect(selection.getAll()).toEqual(afterSelection);

  command.undo();
  expect(source.setDataset).toHaveBeenLastCalledWith(before, false);
  expect(selection.getAll()).toEqual(originalSelection);

  command.publish();
  expect(source.fire).toHaveBeenCalledWith('data', { reason: 'replace' });
  expect(publishSelection).toHaveBeenCalledTimes(1);
});
```

Also prove that `publish()` does not emit `selectionchange` when the last transition produced no diff.

- [ ] **Step 3: Extend runner tests for payload and a single final selection transition**

Add a test which calls the not-yet-existing `_runPreparedDatasetMutation`, mutates the isolated `working` dataset, returns `{ value: { count: 2 }, selection: refs }`, and asserts:

```ts
expect(result).toEqual({ ok: true, value: { count: 2 } });
expect(source.setDataset).toHaveBeenCalledWith(working, false);
expect(host._fireSelectionChange).toHaveBeenCalledTimes(1);
expect(host._selection.getAll()).toEqual(refs);
expect(host._history.push).toHaveBeenCalledWith(expect.any(DatasetReplaceSelectionCommand));
```

Add `['-split-selected', 'shape-count']` to the `inferEffect` table test so the new operation satisfies `COMMAND_EFFECTS` classification.

- [ ] **Step 4: Run the focused tests and confirm the expected failure**

Run:

```bash
rtk vitest run src/edit/commands/dataset-replace-selection.test.ts src/map/ops/_runner.test.ts
```

Expected: FAIL because `DatasetReplaceSelectionCommand`, `_runPreparedDatasetMutation`, and the `split-selected` effect do not exist.

- [ ] **Step 5: Implement the command and generic prepared mutation path**

Implement `DatasetReplaceSelectionCommand` with these invariants:

```ts
class DatasetReplaceSelectionCommand implements EditCommand {
  readonly invalidatesPriorCommands = true;
  readonly label: string;
  private pendingSelectionDiff: SelectionDiff | null = null;

  do(): void {
    asMutableTopologySource(source).setDataset(after, false);
    this.pendingSelectionDiff = selection.apply(afterSelection, 'replace');
  }

  undo(): void {
    asMutableTopologySource(source).setDataset(before, false);
    this.pendingSelectionDiff = selection.restore(beforeSelection);
  }

  publish(): void {
    source.fire?.('data', { reason: 'replace' });
    if (this.pendingSelectionDiff?.changed) publishSelection(this.pendingSelectionDiff);
    this.pendingSelectionDiff = null;
  }
}
```

Add `_runPreparedDatasetMutation<T>()` as a narrow wrapper around the existing queued/stale-checked copy boundary. Its successful commit must:

1. capture the pre-operation selection snapshot;
2. install the returned dataset copy;
3. apply the returned final refs once;
4. push `DatasetReplaceSelectionCommand`;
5. invalidate caches and schedule render once;
6. publish source, history, and the one selection diff;
7. return the callback payload.

Do not change existing CLI command behavior. Add `'split-selected': 'shape-count'` to `COMMAND_EFFECTS`.

- [ ] **Step 6: Wire the new runner into `OpContext` and `MapshaperOps._ctx`**

Add `runPreparedDatasetMutation` to `OpContext`; wire it to `_runPreparedDatasetMutationShared(this._emap, ...)`. Update every test fixture constructing `OpContext` to supply a typed stub returning `OK` until it needs the callback.

- [ ] **Step 7: Run focused tests**

Run:

```bash
rtk vitest run src/edit/commands/dataset-replace-selection.test.ts src/map/ops/_runner.test.ts src/map/ops/merge-selected.test.ts
```

Expected: PASS; existing prepared parsed commands still clear selection according to their effect, while only prepared mutations install explicit selection.

- [ ] **Step 8: Review scope and commit**

Run GitNexus `detect_changes({scope: "all"})`, verify only runner/history flows are affected, then:

```bash
rtk git add src/edit/commands/dataset-replace-selection.ts src/edit/commands/dataset-replace-selection.test.ts src/map/ops/_context.ts src/map/ops/_runner.ts src/map/ops/_runner.test.ts src/map/ops/_test-helpers.ts src/map/mapshaper-ops.ts src/map/ops/merge-selected.test.ts
rtk git commit -m "feat: commit dataset and selection atomically"
```

---

### Task 2: Mapshaper Feature-Split Primitives

**Files:**
- Modify: `src/adapter/mapshaper-adapter.ts:59-63, interface MapshaperAdapter, DefaultMapshaperAdapter`
- Create: `src/adapter/mapshaper-feature-split.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ArcCutPoint { x: number; y: number; i: number }

interface MapshaperAdapter {
  insertCutPoints(dataset: MapshaperDataset, points: ArcCutPoint[]): void;
  buildPolygonMosaic(arcs: ArcCollection, arcIds: ReadonlySet<number>): PathShape[];
  getShapeArea(shape: PathShape, arcs: ArcCollection): number;
  getShapePerimeter(shape: PathShape, arcs: ArcCollection): number;
  getShapeAnchor(shape: PathShape, arcs: ArcCollection): [number, number] | null;
  cleanArcReferences(dataset: MapshaperDataset): void;
}
```

- `insertCutPoints()` must call mapshaper `insertCutPoints()` and immediately `remapDividedArcs()` so every path remains coherent.
- `buildPolygonMosaic()` must construct a fresh `NodeCollection`, apply an absolute-arc-ID filter, and return cloned mosaic shapes because `buildPolygonMosaic()` mutates node state.

- [ ] **Step 1: Run impact analysis for adapter methods**

Check upstream impact for `MapshaperAdapter`, `DefaultMapshaperAdapter.addIntersectionCuts`, and `getDefaultMapshaperAdapter`. Warn on HIGH/CRITICAL before editing.

- [ ] **Step 2: Write failing real-mapshaper primitive tests**

Create a square boundary and a horizontal cutter through `adapter.runImport()`. Assert:

```ts
adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });
const arcIds = new Set(
  [...boundaryShape, ...cutterShape]
    .flat()
    .map((id) => (id < 0 ? ~id : id)),
);
const tiles = adapter.buildPolygonMosaic(dataset.arcs!, arcIds);
expect(tiles).toHaveLength(2);
expect(tiles.reduce((sum, tile) => sum + adapter.getShapeArea(tile, dataset.arcs!), 0)).toBeCloseTo(100, 10);
```

Create a two-vertex line, insert `{x: 5, y: 0, i: segmentStartVertexId}`, and assert the original shape is remapped to two arcs with a shared endpoint at `[5, 0]`.

Verify `cleanArcReferences()` removes a deleted temporary cutter layer's unused arcs while exported target geometry remains coordinate-equivalent.

- [ ] **Step 3: Run tests and confirm failure**

```bash
rtk vitest run src/adapter/mapshaper-feature-split.test.ts
```

Expected: FAIL because the six adapter methods are missing.

- [ ] **Step 4: Implement thin wrappers only**

Use installed mapshaper internals directly only inside `mapshaper-adapter.ts`:

```ts
insertCutPoints(dataset, points): void {
  const map = mapshaper.internal.insertCutPoints(points, dataset.arcs);
  mapshaper.internal.remapDividedArcs(dataset, map);
}

buildPolygonMosaic(arcs, arcIds): PathShape[] {
  const nodes = new mapshaper.internal.NodeCollection(arcs);
  nodes.setArcFilter((id: number) => arcIds.has(id < 0 ? ~id : id));
  return mapshaper.internal.buildPolygonMosaic(nodes).mosaic.map(
    (shape: number[][]) => shape.map((part) => part.slice()),
  );
}
```

Wrap `geom.getShapeArea`, `geom.getShapePerimeter`, `internal.findAnchorPoint`, and `internal.cleanArcReferences`. Normalize adapter return values to project-owned arrays/types so no mapshaper-private class escapes.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
rtk vitest run src/adapter/mapshaper-feature-split.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Detect scope and commit**

```bash
rtk git add src/adapter/mapshaper-adapter.ts src/adapter/mapshaper-feature-split.test.ts
rtk git commit -m "feat: expose mapshaper split primitives"
```

Run GitNexus `detect_changes` immediately before the commit and verify adapter consumers are the only affected flows.

---

### Task 3: Selected Polyline Geometry Splitter

**Files:**
- Create: `src/map/ops/split-selected-line.ts`
- Create: `src/map/ops/split-selected-line.test.ts`
- Create: `src/map/ops/split-selected-error.ts`
- Modify: `src/map/types.ts` — add internal/public cutter types used by tests

**Interfaces:**
- Consumes adapter primitives from Task 2.
- Produces:

```ts
export interface SplitPieces {
  featureId: number;
  pieces: PathShape[];
}

export interface PolylineSplitOutcome {
  pieces: SplitPieces[];
  pointOnSelectedPath: boolean;
}

export class SplitGeometryValidationError extends Error {
  constructor(
    readonly field: 'cutter' | 'geometry',
    readonly reason: string,
  ) {
    super(reason);
  }
}

export function splitSelectedPolylines(
  dataset: MapshaperDataset,
  layerIndex: number,
  selectedIds: ReadonlySet<number>,
  cutter: SplitCutter,
  adapter: MapshaperAdapter,
): PolylineSplitOutcome;
```

- Return entries only for targets producing at least two non-zero pieces; selected no-op targets are omitted. For a point cutter, `pointOnSelectedPath` distinguishes an off-path validation error from an on-path endpoint/no-op cut.

- [ ] **Step 1: Run impact analysis on path and arc helpers**

Check `ArcCollection`, `MapshaperAdapter.forEachSegmentInShape`, and any reused shape helper before editing their contracts.

- [ ] **Step 2: Write failing point-cutter tests**

Use real mapshaper imports for a line `[0,0] → [10,0]`. Cover:

```ts
const result = splitSelectedPolylines(
  dataset,
  0,
  new Set([0]),
  { type: 'point', coordinates: [5, 0] },
  adapter,
);
expect(result.pointOnSelectedPath).toBe(true);
expect(result.pieces).toHaveLength(1);
expect(result.pieces[0].pieces).toHaveLength(2);
replaceFixtureShapeWithPieces(dataset.layers[0], result.pieces[0].pieces);
expect(exportLineCoordinates(dataset)).toEqual([
  [[0, 0], [5, 0]],
  [[5, 0], [10, 0]],
]);
```

Define `replaceFixtureShapeWithPieces()` in the test to replace the one fixture shape and duplicate its record. Define `exportLineCoordinates()` by calling `adapter.exportFileContent(dataset, { format: 'geojson' })` and reading the resulting LineString coordinates; production code must not use this conversion.

Also assert:

- existing interior vertex splits;
- `[0,0]` and `[10,0]` are no-ops;
- `[5,0.001]` is rejected as off-path;
- the arithmetic epsilon accepts a computed intersection such as `0.1 + 0.2` against `0.3` but not a visible offset;
- multipart paths split only the touched part and yield independent non-empty features.

- [ ] **Step 3: Write failing line-cutter tests**

Cover one crossing, three distinct crossings, duplicate cutter intersections at one coordinate, target-endpoint contact, tangent contact, and collinear overlap. Assert exact exported coordinates and absence of zero-length fragments.

- [ ] **Step 4: Run tests and confirm failure**

```bash
rtk vitest run src/map/ops/split-selected-line.test.ts
```

Expected: FAIL because `splitSelectedPolylines` does not exist.

- [ ] **Step 5: Implement exact point matching and arc cutting**

For a point cutter:

1. walk only selected shapes with `forEachSegmentInShape`;
2. compute the closest point on each segment;
3. accept only when squared distance is at most
   `Math.pow(Math.max(1, abs(x), abs(y), abs(ax), abs(ay), abs(bx), abs(by)) * Number.EPSILON * 64, 2)`;
4. reject target path endpoints;
5. deduplicate `{x,y,i}` cut points;
6. call `adapter.insertCutPoints(dataset, cutPoints)` once.

Do not project the user coordinate onto the segment before the acceptance check. After acceptance, use the exact closest coordinate for the inserted topological node.

- [ ] **Step 6: Implement cutter-line noding and path partitioning**

Append one temporary cutter arc/layer with `appendEmptyArc`/`appendVertex`, run `addIntersectionCuts({no_snap: true, rebuild_topology: true})`, and derive cut coordinates from endpoints shared between remapped cutter arcs and target arcs. Partition signed arc sequences at those internal coordinates. Deduplicate coordinate keys using exact post-noding coordinates, not rounded display strings.

Return each uninterrupted path as one `PathShape`; discard fragments whose `adapter.getShapePerimeter()` is zero.

- [ ] **Step 7: Run tests and typecheck**

```bash
rtk vitest run src/map/ops/split-selected-line.test.ts src/adapter/mapshaper-feature-split.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Detect scope and commit**

```bash
rtk git add src/map/types.ts src/map/ops/split-selected-error.ts src/map/ops/split-selected-line.ts src/map/ops/split-selected-line.test.ts
rtk git commit -m "feat: split selected polylines"
```

Run GitNexus `detect_changes` before committing.

---

### Task 4: Selected Polygon Geometry Splitter

**Files:**
- Create: `src/map/ops/split-selected-polygon.ts`
- Create: `src/map/ops/split-selected-polygon.test.ts`

**Interfaces:**
- Consumes `SplitPieces`, adapter mosaic/area/anchor helpers, and a polyline `SplitCutter`.
- Produces:

```ts
export function splitSelectedPolygons(
  dataset: MapshaperDataset,
  layerIndex: number,
  selectedIds: ReadonlySet<number>,
  cutter: Extract<SplitCutter, { type: 'polyline' }>,
  adapter: MapshaperAdapter,
): SplitPieces[];
```

- [ ] **Step 1: Run impact analysis on polygon topology helpers**

Check `MapshaperAdapter.addIntersectionCuts`, `testPointInPolygon`, and the target `MapshaperLayer` usage before editing.

- [ ] **Step 2: Write failing successful-split tests**

Use real polygons and exported GeoJSON assertions:

- square `[0,0]-[10,10]` cut by `[-1,5]-[11,5]` yields two area-50 polygons;
- a zig-zag cutter entering/exiting twice yields more than two results;
- a polygon with a hole preserves total area and the hole topology;
- a MultiPolygon returns independent connected output features;
- overlapping selected polygons are each split against their own original coverage, not against each other's boundaries.

For every case, define `dissolvePieces()` in the test by placing the returned pieces in a temporary polygon layer and calling `adapter.runOnDatasetParsed([{ name: 'dissolve2', options: {} }], dataset)`. Assert both conservation and non-overlap:

```ts
expect(sumResultArea).toBeCloseTo(originalArea, 10);
expect(exportCanonicalGeometry(await dissolvePieces(pieces))).toEqual(
  exportCanonicalGeometry(original),
);
```

`exportCanonicalGeometry()` normalizes ring start positions and polygon order only; it must not round coordinates or hide gaps. Equality after `dissolve2`, together with summed result area equaling original area, fails when pieces overlap or leave gaps.

- [ ] **Step 3: Write failing rejection tests**

Cover a tangent, a single-point touch, cutter along the boundary, and a cutter entirely inside without reaching two boundary points; each returns no `SplitPieces`. A self-intersecting or coverage-defective selected polygon must throw `SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid')`. Every case leaves the selected shape count unchanged.

- [ ] **Step 4: Run tests and confirm failure**

```bash
rtk vitest run src/map/ops/split-selected-polygon.test.ts
```

Expected: FAIL because `splitSelectedPolygons` does not exist.

- [ ] **Step 5: Implement per-feature filtered mosaic construction**

Append one temporary cutter layer and call `addIntersectionCuts({no_snap: true, rebuild_topology: true})`. For each selected feature independently:

1. collect absolute boundary arc IDs from its remapped shape;
2. collect absolute cutter arc IDs from the remapped temporary layer;
3. count distinct shared endpoints between boundary and cutter sets; skip when fewer than two;
4. call `buildPolygonMosaic(arcs, new Set([...boundaryIds, ...cutterIds]))` using a fresh node view;
5. retain a tile only when its anchor is inside the original remapped polygon;
6. discard zero-area tiles;
7. require at least two tiles;
8. compare summed tile area with original area using
   `tolerance = Math.max(originalArea * 1e-10, Number.EPSILON * 1024)`;
9. throw `new SplitGeometryValidationError('geometry', 'polygon split failed coverage validation')` if coverage exceeds tolerance.

Because mosaic tiles are indivisible and disjoint, each retained tile is one connected output feature and cutter arcs remain boundaries between results.

- [ ] **Step 6: Run tests and typecheck**

```bash
rtk vitest run src/map/ops/split-selected-polygon.test.ts src/adapter/mapshaper-feature-split.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Detect scope and commit**

```bash
rtk git add src/map/ops/split-selected-polygon.ts src/map/ops/split-selected-polygon.test.ts
rtk git commit -m "feat: split selected polygons"
```

Run GitNexus `detect_changes` before committing.

---

### Task 5: Public `splitSelected` Operation

**Files:**
- Create: `src/map/ops/split-selected-geometry.ts`
- Create: `src/map/ops/split-selected.ts`
- Create: `src/map/ops/split-selected.test.ts`
- Create: `src/map/split-selected.test-d.ts`
- Modify: `src/map/types.ts:202-216` and selection-driven option area
- Modify: `src/map/mapshaper-ops.ts:20-100,117-133,253-258`
- Modify: `src/index.ts` type export list

**Interfaces:**
- Consumes line/polygon splitters and `OpContext.runPreparedDatasetMutation`.
- Produces the approved public contract:

```ts
export type SplitCutter =
  | { type: 'point'; coordinates: [number, number] }
  | { type: 'polyline'; coordinates: Array<[number, number]> };

export interface SplitSelectedOptions { cutter: SplitCutter }
export interface SplitSelectedResult {
  splitTargetCount: number;
  resultFeatures: FeatureRef[];
}
```

```ts
MapshaperOps.splitSelected(options: SplitSelectedOptions): Promise<OpResult<SplitSelectedResult>>;
```

- [ ] **Step 1: Run impact analysis for the public facade and types**

Check upstream impact on `MapshaperOps`, `FeatureRef`, `OpResult`, and `src/index.ts` exports. Warn before HIGH/CRITICAL edits.

- [ ] **Step 2: Write failing validation and type tests**

In `split-selected.test.ts`, assert no prepared mutation dispatch for:

- empty selection;
- cross-source or cross-layer selection;
- missing layer/shape;
- point target geometry;
- point cutter on polygon;
- NaN/Infinity coordinates;
- fewer than two distinct polyline coordinates.

In `split-selected.test-d.ts`:

```ts
map.ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } });
map.ops.splitSelected({ cutter: { type: 'polyline', coordinates: [[0, 0], [10, 10]] } });
// @ts-expect-error polygon is not a cutter type
map.ops.splitSelected({ cutter: { type: 'polygon', coordinates: [] } });
// @ts-expect-error point coordinate needs two numbers
map.ops.splitSelected({ cutter: { type: 'point', coordinates: [1] } });
```

- [ ] **Step 3: Write failing high-level behavior tests**

Using a real imported dataset and a bare Emap host, verify:

- one selected line splits at a point and returns two refs;
- a cutter splits some selected targets while selected non-intersecting targets remain unchanged and selected;
- largest piece retains the original ID;
- every additional piece is appended after all pre-existing features in deterministic target/geometry order;
- every original selected and unselected feature retains its numeric ID;
- every piece has equal values but `records[0] !== records[1]`;
- no-data-table layers remain without data;
- successful result has the actual `splitTargetCount`;
- no effective cut returns validation and commits nothing;
- invalid or coverage-defective selected geometry returns `Err.validation('geometry', ...)` and commits nothing;
- temporary cutter layers/arcs do not survive export;
- one history/selection/data event is emitted;
- undo restores original dataset and selection, redo restores split dataset and final refs.

- [ ] **Step 4: Run tests and confirm failure**

```bash
rtk vitest run src/map/ops/split-selected.test.ts
rtk npm run typecheck
```

Expected: FAIL because the public operation and exports are absent.

- [ ] **Step 5: Implement common feature replacement**

`split-selected-geometry.ts` must process the target layer once in original index order. For each actually split target:

```ts
const ordered = pieces
  .map((shape, order) => ({
    shape,
    order,
    size: geometryType === 'polygon'
      ? adapter.getShapeArea(shape, arcs)
      : adapter.getShapePerimeter(shape, arcs),
  }))
  .sort((a, b) => b.size - a.size || a.order - b.order);
```

Replace each split target in place with its largest shape, preserving every original array index. Collect the remaining shapes in deterministic target/geometry order and append them only after all pre-existing features. Clone the original record with `{ ...record }` for the retained largest result and every appended result. Preserve unselected/unsplit shapes, records, and numeric IDs. Construct final `FeatureRef`s from original IDs plus the appended output indices.

Remove the temporary layer, call `cleanArcReferences(dataset)`, and return:

```ts
{
  value: { splitTargetCount: piecesByFeature.size, resultFeatures },
  selection: resultFeatures,
}
```

`resultFeatures` also includes selected unsplit targets at their unchanged IDs.

- [ ] **Step 6: Implement validation and dispatch**

`splitSelected(ctx, options)` resolves selection and layer through `LayerRegistry.resolve`, validates the discriminated cutter, then calls:

```ts
return ctx.runPreparedDatasetMutation(
  sourceId,
  (value) => `Split ${value.splitTargetCount} feature${value.splitTargetCount === 1 ? '' : 's'}`,
  (working) => {
    try {
      let pieces: SplitPieces[];
      if (geometryType === 'polygon') {
        pieces = splitSelectedPolygons(...);
      } else {
        const lineOutcome = splitSelectedPolylines(...);
        if (options.cutter.type === 'point' && !lineOutcome.pointOnSelectedPath) {
          return Err.validation('cutter', 'point is not on any selected line');
        }
        pieces = lineOutcome.pieces;
      }
      if (pieces.length === 0) {
        return Err.validation('cutter', 'did not split any selected feature');
      }
      return applySplitPieces(...);
    } catch (error) {
      if (error instanceof SplitGeometryValidationError) {
        return Err.validation(error.field, error.reason);
      }
      throw error;
    }
  },
);
```

Use history label `Split 1 feature` or `Split N features` based on the actual split count. If label must be known only after mutation, let the prepared runner accept `label: string | ((value) => string)` rather than recording the selected count.

- [ ] **Step 7: Wire facade and exports**

Add `MapshaperOps.splitSelected`, export all three public types from `src/index.ts`, and ensure `OpContext` test stubs compile.

- [ ] **Step 8: Run complete core tests**

```bash
rtk vitest run src/map/ops/split-selected.test.ts src/map/ops/split-selected-line.test.ts src/map/ops/split-selected-polygon.test.ts src/map/ops/_runner.test.ts src/edit/commands/dataset-replace-selection.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Detect scope and commit**

```bash
rtk git add src/map/ops/split-selected-geometry.ts src/map/ops/split-selected.ts src/map/ops/split-selected.test.ts src/map/split-selected.test-d.ts src/map/types.ts src/map/mapshaper-ops.ts src/index.ts
rtk git commit -m "feat: add selected feature split operation"
```

Run GitNexus `detect_changes` before committing and verify only the selected-operation, runner, and public API flows changed.

---

### Task 6: Split Edit Mode and Overlay Reuse

**Files:**
- Modify: `src/map/edit-state-store.ts:1-116`
- Modify: `src/map/edit-state-store.test.ts`
- Modify: `src/renderer/edit-overlay-renderer.ts:20-41`
- Modify: `src/renderer/edit-overlay-renderer.test.ts`
- Modify: `src/map/map.ts:378-391,749-754`

**Interfaces:**
- Extends `EditMode` to `'none' | 'vertex' | 'draw' | 'split' | 'measure' | 'transform'`.
- Reuses `EditDrawState`; no second sketch-state type is introduced.

- [ ] **Step 1: Run impact analysis for `EditMode`, `EditStateStore.setMode`, and `EditOverlayRenderer.render`**

Warn before any HIGH/CRITICAL edit.

- [ ] **Step 2: Write failing state and renderer tests**

Add tests proving:

```ts
store.setMode('split');
store.setDraw(drawState);
expect(store.draw).toBe(drawState);
store.setMode('draw');
expect(store.draw).toBeNull(); // changing owner clears the old split sketch
```

And:

```ts
renderer.render('split', null, drawState, null);
expect(painter.drawDrawingOverlay).toHaveBeenCalledWith(drawState);
```

Assert map drag pan is suspended in split mode and restored when leaving it.

- [ ] **Step 3: Run tests and confirm failure**

```bash
rtk vitest run src/map/edit-state-store.test.ts src/renderer/edit-overlay-renderer.test.ts src/map/map.test.ts
```

Expected: FAIL because `split` is not an edit mode and the overlay ignores it.

- [ ] **Step 4: Implement the minimal mode changes**

In `setMode`, draw state belongs to exactly one modal owner; changing between `draw` and `split` must clear it:

```ts
if (mode !== this._mode) {
  if (mode !== 'vertex') this._vertex = null;
  this._draw = null;
  if (mode !== 'measure') this._measurement = null;
}
```

Handlers set fresh draw state after entering their mode. Render drawing overlay for either `draw` or `split`. Update `_syncEditModeDragPan` so `split` blocks pan like `draw` and `vertex`.

- [ ] **Step 5: Run focused tests**

```bash
rtk vitest run src/map/edit-state-store.test.ts src/renderer/edit-overlay-renderer.test.ts src/map/map.test.ts
```

Expected: PASS.

- [ ] **Step 6: Detect scope and commit**

```bash
rtk git add src/map/edit-state-store.ts src/map/edit-state-store.test.ts src/renderer/edit-overlay-renderer.ts src/renderer/edit-overlay-renderer.test.ts src/map/map.ts
rtk git commit -m "feat: add split edit mode"
```

Run GitNexus `detect_changes` first.

---

### Task 7: Interactive `SplitFeatureHandler`

**Files:**
- Create: `src/core/handlers/split-feature.ts`
- Create: `src/core/handlers/split-feature.test.ts`
- Modify: `src/core/handlers/edit-handler-host.ts:1-32`
- Modify: `src/core/handlers/selection-handler-host.ts:1-19`
- Modify: `src/map/map.ts` imports, properties, constructor registration around lines 502-504, getter around lines 1887-1890
- Modify: `src/map/handler-registry.test.ts`
- Modify: `src/map/types.ts` — `SplitFeatureOptions`
- Modify: `src/index.ts` — handler and option exports

**Interfaces:**
- Produces:

```ts
export interface SplitFeatureOptions {
  cutterType: 'point' | 'polyline';
  snapThreshold?: number;
}

export class SplitFeatureHandler implements Handler<SplitFeatureOptions> {
  readonly name = 'splitFeature';
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  setOptions(options: Partial<SplitFeatureOptions>): void;
  getOptions(): Readonly<SplitFeatureOptions>;
  handlePointer(event: NormalizedPointerEvent): HandlerResult;
}
```

- `EditHandlerHost` adds `getSelection()` and `readonly ops: Pick<MapshaperOps, 'splitSelected'>`.
- `Emap` exposes `get splitFeature(): Handler<SplitFeatureOptions>`.

- [ ] **Step 1: Run impact analysis for handler host, map construction, and handler registry**

Check `EditHandlerHost`, `SelectionHandlerHost`, `Emap.constructor`, `Emap.drawFeature`, and `HandlerManager.register` before editing.

- [ ] **Step 2: Write failing handler lifecycle tests**

Test:

- `enable()` rejects empty/mixed selection and point mode on polygon selection;
- enabling sets mode `split` and cursor `crosshair`;
- leaving split mode quietly disables the handler;
- `disable()` clears sketch/listeners and returns mode to `none`;
- ordinary draw and split cannot remain enabled together.

- [ ] **Step 3: Write failing pointer and snapping tests**

Point mode:

```ts
handler.handlePointer(moveNearSelectedLine);
handler.handlePointer(leftClick);
await vi.waitFor(() => expect(splitSelected).toHaveBeenCalledWith({
  cutter: { type: 'point', coordinates: [5, 0] },
}));
```

Assert an unsnapped click does not call the operation. Candidate snapping must iterate only currently selected shapes and use the same pixel-threshold projection pattern as `DrawFeatureHandler`; it must not scan unrelated source arcs.

Polyline mode:

- left clicks append vertices;
- `contextmenu` with fewer than two vertices cancels the incomplete sketch without dispatch;
- `contextmenu` with at least two vertices calls `splitSelected()` once and prevents browser context menu;
- Escape cancels without dispatch;
- repeated completion while a promise is pending is ignored;
- success and failure both clear the finished sketch and keep the handler enabled;
- failure fires the existing generic `error` event with `{ error: result.error }` and does not change selection itself.

- [ ] **Step 4: Run tests and confirm failure**

```bash
rtk vitest run src/core/handlers/split-feature.test.ts src/map/handler-registry.test.ts
```

Expected: FAIL because the handler and map registration do not exist.

- [ ] **Step 5: Implement the handler without geometry duplication**

Use `EditDrawState` for rendering. Point mode supplies only an exactly snapped coordinate. Polyline mode stores clicked map coordinates and optional existing vertex/edge snaps, then calls only:

```ts
await this._map.ops.splitSelected({
  cutter: this._opts.cutterType === 'point'
    ? { type: 'point', coordinates: this._vertices[0] }
    : { type: 'polyline', coordinates: this._vertices.slice() },
});
```

No arc mutation, intersection test, polygonization, or record handling belongs in the handler.

- [ ] **Step 6: Register and export the handler**

Construct and register beside `DrawFeatureHandler`; add the getter and public exports. Extend handler registry tests to assert `map.splitFeature` exists, is disabled by default, and mode changes deactivate peer modal editors.

- [ ] **Step 7: Run focused interaction tests and typecheck**

```bash
rtk vitest run src/core/handlers/split-feature.test.ts src/map/handler-registry.test.ts src/map/edit-state-store.test.ts src/renderer/edit-overlay-renderer.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Detect scope and commit**

```bash
rtk git add src/core/handlers/split-feature.ts src/core/handlers/split-feature.test.ts src/core/handlers/edit-handler-host.ts src/core/handlers/selection-handler-host.ts src/map/map.ts src/map/handler-registry.test.ts src/map/types.ts src/index.ts
rtk git commit -m "feat: add interactive split handler"
```

Run GitNexus `detect_changes` before committing.

---

### Task 8: Documentation, Runnable Example, and End-to-End Verification

**Files:**
- Create: `packages/examples/examples/split-features/index.html`
- Create: `test/examples/split-features.test.ts`
- Modify: `docs-meta/examples.ts`
- Modify: `packages/docs/docs/data/operations.md`
- Modify: `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/operations.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes the final `map.ops.splitSelected()` and `map.splitFeature` public APIs.
- Produces no new engine API.

- [ ] **Step 1: Inspect and preserve concurrent user changes**

Before editing `docs-meta/examples.ts`, read its current content and diff. Adapt to existing modifications; do not overwrite the user's pending catalog work. Run impact analysis on `exampleDescriptions` and `examples` before editing those symbols.

- [ ] **Step 2: Write the failing example test**

Create a jsdom test following `test/examples/merge-selected.test.ts`. Execute the module script with a mocked map and assert:

- point/line mode buttons configure `map.splitFeature.setOptions({ cutterType })`;
- enable requires a valid same-layer line/polygon selection;
- polygon selection disables point mode;
- clear/cancel disables the handler;
- status text reports the final selected result count after `selectionchange`;
- the example never calls `drawFeature` or creates a cutter layer.

Run:

```bash
rtk vitest run test/examples/split-features.test.ts
```

Expected: FAIL because the example is absent.

- [ ] **Step 3: Build the runnable example**

Use the existing example runtime helpers, selection controls, and history control. Register both polygon and line fixtures in `docs-meta/examples.ts`, add mode buttons, and let users select targets before enabling the split handler. The example must call the public handler only; it must not reach into `_selection`, `_sources`, or mapshaper internals.

- [ ] **Step 4: Document Chinese and English usage**

Add `SplitSelectedOptions`, `SplitSelectedResult`, `SplitCutter`, and `SplitFeatureOptions` to the API front matter. Document:

```ts
map.select([{ source: 'main', layer: 'roads', id: 4 }]);
const result = await map.ops.splitSelected({
  cutter: { type: 'point', coordinates: [121.5, 31.2] },
});

map.splitFeature.setOptions({ cutterType: 'polyline' });
map.splitFeature.enable();
```

State the same-source/layer selection requirement, point-on-line rule, largest-result ID rule, duplicated attributes, right-click completion, final-result selection, and atomic undo behavior in both languages.

- [ ] **Step 5: Add changelog entry**

Under the current unreleased section, add one bullet describing point/line polyline splitting, line polygon splitting, attribute duplication, result selection, and the new handler. Do not claim Z/M, curves, provider split policies, or cross-layer topology.

- [ ] **Step 6: Run focused and project verification**

```bash
rtk vitest run src/edit/commands/dataset-replace-selection.test.ts src/adapter/mapshaper-feature-split.test.ts src/map/ops/split-selected-line.test.ts src/map/ops/split-selected-polygon.test.ts src/map/ops/split-selected.test.ts src/core/handlers/split-feature.test.ts src/map/edit-state-store.test.ts src/renderer/edit-overlay-renderer.test.ts src/map/handler-registry.test.ts test/examples/split-features.test.ts
rtk npm run typecheck
rtk npm run format:check
rtk npm run build
rtk npm run examples:build
```

Expected: every command exits 0. Fix only failures caused by this feature; preserve unrelated user changes.

- [ ] **Step 7: Browser-drive the actual interaction**

Start the examples dev server through the harness process manager, then open `/examples/split-features/` in Chromium. Exercise both paths:

1. select one line, choose point mode, click its interior, observe two selected line features, undo, and observe the original one-feature selection;
2. select one polygon, choose line mode, left-click a cutter beginning outside, left-click an endpoint outside the opposite side, right-click, observe multiple selected polygons with identical displayed attributes, undo, then redo;
3. draw a tangent/non-crossing polygon cutter and observe an unchanged dataset plus a no-split error;
4. check browser console for uncaught errors.

Capture the observed selection counts and status text. This smoke test, not a source inspection, is the behavioral proof for the interactive surface.

- [ ] **Step 8: Final change-scope review and commit**

Run GitNexus `detect_changes({scope: "all"})`. Confirm expected flows only: selected operation, dataset replacement/history, edit-mode overlay, pointer handler, public exports, example/docs. Then:

```bash
rtk git add packages/examples/examples/split-features/index.html test/examples/split-features.test.ts docs-meta/examples.ts packages/docs/docs/data/operations.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/operations.md CHANGELOG.md
rtk git commit -m "docs: demonstrate selected feature splitting"
```

Do not stage unrelated pre-existing files.
