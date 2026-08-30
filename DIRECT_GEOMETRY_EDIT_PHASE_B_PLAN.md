# Direct Geometry Edit Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `reshapeSelected` and `splitSelected` from whole-dataset replacement (`insertCutPoints` on a `copyDataset` working copy + `DatasetReplaceSelectionCommand` barrier) to in-place reversible commands, unlocking stable multi-level undo/redo with topology linkage preserved.

**Architecture:** Spec: `DIRECT_GEOMETRY_EDIT_PHASE_B_DESIGN.md` (latest commit). Legacy geometry functions run **unchanged** on a bounded mini dataset (candidate features + features sharing their arcs, full-arc copies, live-aligned sparse `shapes` arrays, plus a **sentinel provenance layer**: one polyline shape `[[arcId]]` per copied arc). mapshaper's `remapDividedArcs` / `buildTopology` remap the sentinel layer together with real layers, so after any cutting/rebuild the sentinel shapes give the exact ordered piece lineage of every original mini arc — for BOTH the `insertCutPoints` path and the `addIntersectionCuts(rebuild_topology)` path (spike-verified 2026-08-30, see facts below). The translator first builds a **reverse owner map** `postArcId → [{original arc, sign}]` from the sentinels (lineage entries can be negative after dedup merges), then assigns live ids deterministically: singleton lineage + unique owner + orientation-adjusted coordinates equal to the live source arc → keep the live id; multi-owner post arcs (dedup convergence) append exactly once and every owner's references translate to the same new id (legacy merge parity); everything else appends in sentinel order. Reshape commits one `PathGeometryPatchCommand` per source wrapped in a `CompositeCommand` (single history entry); split commits a new `SplitFeaturesCommand`. Planners are read-only against LIVE data; commands do/undo via append/truncate only.

**Tech Stack:** TypeScript, Vitest (`pnpm exec vitest run <file>`), mapshaper data structures, Phase A infrastructure (`PathGeometryPatchCommand`, `appendArcsCompat`/`truncateArcsCompat`, `_runPreparedEditCommand`).

**Verified spike facts (2026-08-30, `node -e` against `mapshaper.internal`):**
- `insertCutPoints(points, arcs)` returns `Uint32Array map` where pieces of original arc `i` are the contiguous id range `[map[i], (i+1 < map.length ? map[i+1] : arcs.size()) - 1]`; the divided collection is REPACKED (an undivided arc after a divided one still shifts id). Confirmed: arcs [2,3,2]-vertex, cut arc 1 → map `{0:0, 1:1, 2:3}`, size 3→4, untouched arc 2 moved to slot 3.
- Sentinel layer `[[0]],[[1]],…` through `insertCutPoints` + `remapDividedArcs` → `[[[0]],[[1,2]],[[3]]]` (exact ordered lineage).
- `addIntersectionCuts(dataset, {rebuild_topology:true})` runs `arcs.flatten()` + snap/dedup/cut loop + `buildTopology` + `cleanShapes` + `cleanArcReferences` (mapshaper.js:17024-17065). Sentinels survive all of it: square + cutter → sentinels `[[[0,1,2]],[[3]],[[4]],[[5]],[[6,7,8]]]`. `cleanShapes` does NOT drop single-arc sentinel shapes; `cleanArcReferences` removes nothing in the mini (sentinels reference every arc) — harmless for scratch.
- **Dedup convergence + negative lineage (spike C):** live arcs `[(0,0),(1,0)]` ×2 (same direction) + 1 reversed duplicate `[(1,0),(0,0)]` + cutter `[(0.5,-1),(0.5,1)]` through `addIntersectionCuts` → sentinels `[[[0,1]],[[0,1]],[[-2,-1]]]`, cutter `[[[2,3]]]`, 4 post arcs (pieces `(0,0)-(0.5,0)`, `(0.5,0)-(1,0)`, cutter halves). Consequences: (a) multiple sentinels can claim the SAME post id (dedup merge) — reuse-by-coordinate requires a UNIQUE owner, else append once and map every owner to the same new live id; (b) lineage refs can be NEGATIVE (reversed duplicates) — sign must participate in the reuse comparison and shape-level translation keeps per-reference signs.
- Consequence of snapping: coordinates snapped/flattened by the rebuild path no longer equal live originals; those arcs fail the untouched check and append — geometrically identical to legacy (which snapped the same way on the working copy), just slightly more orphan arcs.

## Global Constraints

- NEVER import `mapshaper` outside `src/adapter/mapshaper-adapter.ts` (AGENTS.md hard rule). New `createArcCollection` lives in the adapter; ops tests may import mapshaper for fixtures (existing test precedent: `mapshaper-adapter-arcs.test.ts:154`).
- Legacy geometry functions (`reshape-selected-line.ts`, `reshape-selected-polygon.ts`, `split-selected-line.ts`, `split-selected-polygon.ts`) are NOT modified — they run on the mini dataset. All migration logic lives in the orchestrators and the two new `_mini-*` modules.
- Planners MUST be synchronous, pure read-only on LIVE datasets; all live mutation happens inside `command.do()` (mini dataset mutation is fine — it is planner-owned scratch).
- Arc lineage comes ONLY from the sentinel layer (plus build-time `miniToLiveArc`); NEVER byte-match a mini arc against arbitrary live arcs to infer identity. The untouched check compares a mini arc against its own provenance source only, with orientation from the sentinel ref sign.
- A post-op mini arc id maps to exactly ONE live id; a multi-owner post arc (dedup convergence) appends ONE live arc shared by every owner's translated reference.
- No `cleanArcReferences` on the live path; orphan arcs are expected (export compacts a copy).
- `invalidatesPriorCommands` stays absent on the new commands — no history barrier.
- Commands clone shape snapshots at construction (PathGeometryPatchCommand precedent).
- Tests: `pnpm exec vitest run <file>`; type gate: `pnpm typecheck`. Commit after every task with conventional-commit messages. Run gates with bare `pnpm`/`pnpm exec`, NOT `rtk pnpm` (rtk shim resolves global tsc 7.0.2 — false failures).
- Feature refs use canonical layer ids via `getLayerId(layer, index)` (`src/source/layer-utils.ts`).

---

### Task 1: Adapter `createArcCollection` + mini-dataset builder (with sentinel layer)

**Files:**
- Modify: `src/adapter/mapshaper-adapter.ts` (interface near `appendArcs` ~line 206; implementation near `appendArcs` impl ~line 703)
- Create: `src/map/ops/_mini-dataset.ts`
- Test: `src/map/ops/_mini-dataset.test.ts` (create)
- Reference: `src/adapter/mapshaper-adapter-arcs.test.ts:153-157` (real `mapshaper.internal.ArcCollection` construction precedent)

**Interfaces:**
- Produces (Tasks 3,4,7,8 consume):
```ts
// src/adapter/mapshaper-adapter.ts — on MapshaperAdapter
/** Create a standalone ArcCollection holding the supplied arcs (ids 0..n-1). */
createArcCollection(arcsToAppend: AppendedArc[]): ArcCollection;

// src/map/ops/_mini-dataset.ts
export interface MiniDataset {
  /** Scratch dataset: mini arcs + live-aligned layers + trailing sentinel layer. */
  dataset: MapshaperDataset;
  /** Same object as dataset.arcs — convenience. */
  arcs: ArcCollection;
  /** miniArcId → liveArcId for every arc present at build time (provenance). */
  miniToLiveArc: readonly number[];
  /** layerIndex → featureIds present in mini (candidates ∪ arc sharers). */
  included: ReadonlyMap<number, ReadonlySet<number>>;
  /** Index of the sentinel layer in dataset.layers (= live layers.length). */
  sentinelLayerIndex: number;
}
export function buildMiniDataset(opts: {
  dataset: MapshaperDataset; // LIVE, read-only
  /** layerIndex → geometric candidate featureIds. Sharers are added internally. */
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  adapter: MapshaperAdapter;
}): MiniDataset;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/map/ops/_mini-dataset.test.ts
import { describe, expect, it } from 'vitest';
import mapshaper from 'mapshaper';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { buildMiniDataset } from './_mini-dataset';

function liveDataset(): MapshaperDataset {
  // f0 references arcs 0,1; f1 shares arc 1 (reversed) and adds arc 2; f2 detached.
  const arcs = new mapshaper.internal.ArcCollection(
    new Int32Array([3, 3, 3]),
    new Float64Array([0, 1, 1, /**/ 1, 2, 2, /**/ 0, 0, 1]),
    new Float64Array([0, 0, 1, /**/ 0, 0, 1, /**/ 2, 3, 3]),
  );
  const layer: PathLayer = {
    geometry_type: 'polygon',
    shapes: [[[0, 1]], [[-2, 1]], [[0]]] as PathShape[],
  } as unknown as PathLayer;
  return { arcs, layers: [layer] } as unknown as MapshaperDataset;
}

describe('buildMiniDataset', () => {
  const adapter = getDefaultMapshaperAdapter();

  it('copies candidate arcs with provenance and translates shapes', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]),
      adapter,
    });
    expect(mini.miniToLiveArc).toEqual([0]);
    expect(mini.included.get(0)).toEqual(new Set([2]));
    expect(mini.arcs.size()).toBe(1);
    const shapes = (mini.dataset.layers[0] as PathLayer).shapes!;
    expect(shapes.length).toBe(3); // live-aligned sparse array
    expect(shapes[0]).toBeNull();
    expect(shapes[1]).toBeNull();
    expect(shapes[2]).toEqual([[0]]);
  });

  it('expands candidates to features sharing candidate arcs', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // f1 shares arc 1 → included with its other arc (2) copied too
    expect(mini.included.get(0)).toEqual(new Set([0, 1]));
    expect(mini.miniToLiveArc).toEqual([0, 1, 2]);
    const shapes = (mini.dataset.layers[0] as PathLayer).shapes!;
    expect(shapes[0]).toEqual([[0, 1]]);
    expect(shapes[1]).toEqual([[-2, 1]]); // signed direction preserved in mini ids
    expect(shapes[2]).toBeNull();
  });

  it('appends a sentinel layer with one [[arcId]] shape per copied arc', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    expect(mini.sentinelLayerIndex).toBe(1); // live had 1 layer
    const sentinel = mini.dataset.layers[1] as PathLayer;
    expect(sentinel.geometry_type).toBe('polyline');
    expect(sentinel.shapes).toEqual([[[0]], [[1]], [[2]]]);
  });

  it('does not alias live vertex buffers (copies are independent)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]),
      adapter,
    });
    const liveXx = live.arcs!.getVertexData().xx;
    const miniXx = mini.arcs.getVertexData().xx;
    expect(miniXx).not.toBe(liveXx);
    expect(Array.from(miniXx)).toEqual([0, 0, 1]);
  });

  it('keeps legacy geometry functions away from the sentinel layer', () => {
    // Sentinel layer is only reachable by explicit index; the path-layer loops
    // in reshape/split receive candidate ids and never target it. This test
    // pins the contract: sentinel index === live layers.length (trailing).
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]),
      adapter,
    });
    expect(mini.dataset.layers.length).toBe(live.layers.length + 1);
    expect(mini.dataset.layers[mini.sentinelLayerIndex]).toBe(
      mini.dataset.layers[mini.dataset.layers.length - 1],
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/_mini-dataset.test.ts`
Expected: FAIL — `createArcCollection` / `buildMiniDataset` do not exist.

- [ ] **Step 3: Implement `createArcCollection` in the adapter**

Interface (after the `truncateArcs?` declaration, ~line 217):

```ts
  /** Create a standalone ArcCollection holding the supplied arcs (ids 0..n-1). */
  createArcCollection(arcsToAppend: AppendedArc[]): ArcCollection;
```

Implementation (next to `appendArcs`; `appendArcs` on an empty collection is the degenerate case of its existing concatenation):

```ts
  createArcCollection(arcsToAppend: AppendedArc[]): ArcCollection {
    const arcs = new mapshaper.internal.ArcCollection(
      new Int32Array(0),
      new Float64Array(0),
      new Float64Array(0),
    );
    if (arcsToAppend.length > 0) this.appendArcs(arcs, arcsToAppend);
    return arcs;
  }
```

- [ ] **Step 4: Implement `buildMiniDataset`**

```ts
// src/map/ops/_mini-dataset.ts
import type { ArcCollection, MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import type { AppendedArc, MapshaperAdapter } from '../../adapter/mapshaper-adapter';

export interface MiniDataset {
  dataset: MapshaperDataset;
  arcs: ArcCollection;
  miniToLiveArc: readonly number[];
  included: ReadonlyMap<number, ReadonlySet<number>>;
  sentinelLayerIndex: number;
}

function unsigned(id: number): number {
  return id < 0 ? -id - 1 : id;
}

/** Copy arc coordinates out of a live ArcCollection as an AppendedArc. */
export function snapshotLiveArc(arcs: ArcCollection, arcId: number): AppendedArc {
  const data = arcs.getVertexData();
  const start = data.ii[arcId]!;
  const end = start + data.nn[arcId]!;
  return {
    xx: data.xx.slice(start, end),
    yy: data.yy.slice(start, end),
    zz: data.zz ? data.zz.slice(start, end) : null,
  };
}

export function buildMiniDataset(opts: {
  dataset: MapshaperDataset;
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  adapter: MapshaperAdapter;
}): MiniDataset {
  const { dataset, candidates, adapter } = opts;
  const liveArcs = dataset.arcs;
  if (!liveArcs) throw new Error('buildMiniDataset requires path geometry');

  // 1. Expand candidates: any feature sharing an arc with a candidate joins
  //    (one hop — topology linkage only breaks where an arc is actually cut,
  //    and cuts only land on candidate arcs).
  const included = new Map<number, Set<number>>();
  for (const [layerIndex, ids] of candidates) included.set(layerIndex, new Set(ids));
  const candidateArcs = new Set<number>();
  for (const [layerIndex, ids] of candidates) {
    const layer = dataset.layers[layerIndex] as PathLayer;
    for (const featureId of ids) {
      const shape = layer.shapes?.[featureId] as PathShape | null;
      if (!shape) continue;
      for (const part of shape) for (const ref of part) candidateArcs.add(unsigned(ref));
    }
  }
  for (let layerIndex = 0; layerIndex < dataset.layers.length; layerIndex++) {
    const layer = dataset.layers[layerIndex];
    if (!isPathLayer(layer) || !layer.shapes) continue;
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      const shares = shape.some((part) => part.some((ref) => candidateArcs.has(unsigned(ref))));
      if (!shares) continue;
      let set = included.get(layerIndex);
      if (!set) included.set(layerIndex, (set = new Set()));
      set.add(featureId);
    }
  }

  // 2. Collect every arc referenced by included features; assign mini ids in
  //    ascending live-id order (deterministic).
  const liveIds = new Set<number>();
  for (const [layerIndex, ids] of included) {
    const layer = dataset.layers[layerIndex] as PathLayer;
    for (const featureId of ids) {
      const shape = layer.shapes![featureId] as PathShape;
      for (const part of shape) for (const ref of part) liveIds.add(unsigned(ref));
    }
  }
  const sorted = [...liveIds].sort((a, b) => a - b);
  const liveToMini = new Map<number, number>();
  const copies: AppendedArc[] = [];
  sorted.forEach((liveId, miniId) => {
    liveToMini.set(liveId, miniId);
    copies.push(snapshotLiveArc(liveArcs, liveId));
  });
  const arcs = adapter.createArcCollection(copies);

  // 3. Layers: same length as live; path layers get sparse translated shapes,
  //    other layers pass through by reference (geometry fns skip them).
  const layers = dataset.layers.map((layer, layerIndex) => {
    const ids = included.get(layerIndex);
    if (!ids || !isPathLayer(layer) || !layer.shapes) return layer;
    const shapes: (PathShape | null)[] = new Array(layer.shapes.length).fill(null);
    for (const featureId of ids) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      shapes[featureId] = shape.map((part) =>
        part.map((ref) => {
          const miniId = liveToMini.get(unsigned(ref))!;
          return ref < 0 ? -miniId - 1 : miniId;
        }),
      );
    }
    return { ...layer, shapes, data: undefined };
  });

  // 4. Sentinel provenance layer: one single-arc polyline shape per copied
  //    arc. remapDividedArcs / buildTopology remap it together with real
  //    layers, yielding exact post-op lineage per original mini arc.
  const sentinelLayerIndex = layers.length;
  const sentinelLayer = {
    geometry_type: 'polyline',
    shapes: sorted.map((_, miniId) => [[miniId]]),
  } as unknown as PathLayer;

  return {
    dataset: { ...dataset, arcs, layers: [...layers, sentinelLayer] },
    arcs,
    miniToLiveArc: sorted,
    included,
    sentinelLayerIndex,
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm exec vitest run src/map/ops/_mini-dataset.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/adapter/mapshaper-adapter.ts src/map/ops/_mini-dataset.ts src/map/ops/_mini-dataset.test.ts
git commit -m "feat(ops): mini-dataset builder with sentinel provenance layer"
```

---

### Task 2: Result translator `_mini-translate.ts` (sentinel lineage + owner map)

**Files:**
- Create: `src/map/ops/_mini-translate.ts`
- Test: `src/map/ops/_mini-translate.test.ts` (create)
- Consumes: `MiniDataset`, `snapshotLiveArc` (Task 1); `PathShapePatch` from `src/edit/commands/path-geometry-patch.ts:13-19`

**Interfaces:**
- Produces (Tasks 3,4,7,8 consume):
```ts
// src/map/ops/_mini-translate.ts
export interface MiniTranslation {
  /** Arcs to append onto the live collection, in live id order. */
  appendedArcs: AppendedArc[];
  /** Patches for every included feature whose translated shape differs from live. */
  shapePatches: PathShapePatch[];
  /** post-op miniArcId → liveArcId for EVERY post-op mini arc (sentinel lineage + appends). */
  miniToLiveFinal: readonly number[];
}
/** Returns null when lineage is broken (missing/nulled sentinel or unmappable reference). */
export function translateMiniDataset(opts: {
  mini: MiniDataset;       // AFTER the legacy geometry function ran on it
  liveDataset: MapshaperDataset;
  liveArcCount: number;    // live arcs.size() captured at plan start
  liveLayers: readonly MapshaperLayer[]; // live layers (for patch layer refs)
}): MiniTranslation | null;
/** Translate one mini-space shape to live arc ids. Throws on unmappable refs (call after null-check). */
export function translateShapeFromMini(translation: MiniTranslation, shape: PathShape): PathShape;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/map/ops/_mini-translate.test.ts
import { describe, expect, it } from 'vitest';
import mapshaper from 'mapshaper';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { buildMiniDataset } from './_mini-dataset';
import { translateMiniDataset, translateShapeFromMini } from './_mini-translate';

// f0 = [[0,1]], f1 = [[-2,1]] sharing arc 1; arc 3 unreferenced by any shape.
function liveDataset(): MapshaperDataset {
  const arcs = new mapshaper.internal.ArcCollection(
    new Int32Array([2, 2, 2, 2]),
    new Float64Array([0, 1, /**/ 1, 2, /**/ 2, 3, /**/ 3, 0]),
    new Float64Array([0, 0, /**/ 0, 0, /**/ 0, 0, /**/ 0, 0]),
  );
  const layer: PathLayer = {
    geometry_type: 'polygon',
    shapes: [[[0, 1]], [[-2, 1]]] as PathShape[],
  } as unknown as PathLayer;
  return { arcs, layers: [layer] } as unknown as MapshaperDataset;
}

describe('translateMiniDataset', () => {
  const adapter = getDefaultMapshaperAdapter();

  it('keeps live ids for untouched arcs and produces no patch when nothing changed', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toEqual([]);
    expect(translation!.shapePatches).toEqual([]);
    expect(translation!.miniToLiveFinal).toEqual([0, 1, 2]);
  });

  it('appends a mini-only arc (no sentinel) and rewrites the referencing shape', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Simulate a legacy reshape outcome: append one replacement arc (mini id 3,
    // no sentinel) and point feature 0's shape at it.
    adapter.appendArc(mini.arcs, [[5, 5], [6, 6]]);
    const miniLayer = mini.dataset.layers[0] as PathLayer;
    miniLayer.shapes![0] = [[3, 1]];
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([5, 6]);
    expect(translation!.miniToLiveFinal).toEqual([0, 1, 2, 4]);
    expect(translation!.shapePatches).toEqual([
      {
        layer: live.layers[0],
        featureId: 0,
        before: [[0, 1]],
        after: [[4, 1]],
      },
    ]);
  });

  // Contract test: spike A (2026-08-30) — sentinel lineage through insertCutPoints.
  it('resolves divided-arc lineage via the sentinel layer (insertCutPoints path)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]), // arcs 0,1,2 copied; f1 shares arc 1
      adapter,
    });
    // Cut mini arc 1 (live arc 1) at its midpoint. Flat vertex index of mini
    // arc 1 vertex 0 is ii[1] = 2.
    adapter.insertCutPoints(mini.dataset, [{ x: 1.5, y: 0, i: 2 }]);
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    // Live arc 1 was divided into 2 pieces → both append (live ids 4,5).
    // Mini arcs 0 and 2 are untouched → keep live ids 0 and 2.
    // Sentinel lineage: arc0→[0], arc1→[1,2], arc2→[3] →
    //   miniToLiveFinal over post-op mini ids [0,1,2,3] = [0, 4, 5, 2].
    expect(translation!.miniToLiveFinal).toEqual([0, 4, 5, 2]);
    expect(translation!.appendedArcs).toHaveLength(2);
    // Both the target and the SHARER reference the same new piece ids (linkage).
    const f0 = translation!.shapePatches.find((p) => p.featureId === 0);
    const f1 = translation!.shapePatches.find((p) => p.featureId === 1);
    expect(f0?.after).toEqual([[0, 4, 5]]);
    expect(f1?.after).toEqual([[-5, 4]]); // shared span: same piece ids, directions preserved
  });

  // Contract test: spike C (2026-08-30) — dedup convergence + negative lineage.
  // Fixture verified verbatim against mapshaper.internal.addIntersectionCuts:
  //   live arcs L0=L1=[(0,0),(1,0)] (same direction), L2=[(1,0),(0,0)] (reverse),
  //   cutter [(0.5,-1),(0.5,1)] crossing at x=0.5.
  //   post: sentinels [[[0,1]],[[0,1]],[[-2,-1]]], cutter [[[2,3]]], 4 arcs.
  it('merges deduped arcs into ONE appended arc per post id (signs preserved)', () => {
    const arcs = new mapshaper.internal.ArcCollection(
      new Int32Array([2, 2, 2]),
      new Float64Array([0, 1, /**/ 0, 1, /**/ 1, 0]),
      new Float64Array([0, 0, /**/ 0, 0, /**/ 0, 0]),
    );
    const layer: PathLayer = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[1]], [[2]]] as PathShape[], // f0,f1 identical; f2 reversed
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0, 1, 2])]]),
      adapter,
    });
    // Simulate the legacy split path: append the cutter arc (mini id 3, no
    // sentinel), then run the rebuild cut on the mini.
    adapter.appendArc(mini.arcs, [[0.5, -1], [0.5, 1]]);
    adapter.addIntersectionCuts(mini.dataset, { rebuild_topology: true });
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    // Dedup merged L0/L1/L2 → pieces p0,p1 shared by all three sentinels
    // (multi-owner) → append once each: live ids 3,4. Cutter pieces → 5,6.
    expect(translation!.miniToLiveFinal).toEqual([3, 4, 5, 6]);
    expect(translation!.appendedArcs).toHaveLength(4);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([0, 0.5]);
    expect(Array.from(translation!.appendedArcs[1]!.xx)).toEqual([0.5, 1]);
    // All three features converge on the same new ids; f2 reversed.
    const afterByFeature = new Map(
      translation!.shapePatches.map((p) => [p.featureId, p.after]),
    );
    expect(afterByFeature.get(0)).toEqual([[3, 4]]);
    expect(afterByFeature.get(1)).toEqual([[3, 4]]);
    expect(afterByFeature.get(2)).toEqual([[-5, -4]]);
  });

  it('fails cleanly when a sentinel shape is nulled (degenerate arc cleaned)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    (mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer).shapes![1] = null;
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).toBeNull();
  });
});
```

Calibration note for the implementer: tests 3 and 4 assert exact ids derived from the 2026-08-30 spikes; if a fixture detail shifts an id, re-derive from an actual run — the invariants that MUST hold regardless: `miniToLiveFinal` covers every post-op mini arc exactly once; multi-owner post arcs append exactly once; untouched arcs reuse their live ids; sharer/target patches reference identical piece ids with correct signs.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/_mini-translate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the translator**

```ts
// src/map/ops/_mini-translate.ts
import type { AppendedArc } from '../../adapter/mapshaper-adapter';
import type {
  MapshaperLayer,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import type { PathShapePatch } from '../../edit/commands/path-geometry-patch';
import { snapshotLiveArc, type MiniDataset } from './_mini-dataset';

export interface MiniTranslation {
  appendedArcs: AppendedArc[];
  shapePatches: PathShapePatch[];
  miniToLiveFinal: readonly number[];
}

function unsigned(id: number): number {
  return id < 0 ? -id - 1 : id;
}

/** Compare a post-op mini arc against its provenance live arc, honoring direction. */
function arcsEqualOriented(post: AppendedArc, live: AppendedArc, sign: 1 | -1): boolean {
  const n = post.xx.length;
  if (n !== live.xx.length) return false;
  for (let i = 0; i < n; i++) {
    const j = sign === 1 ? i : n - 1 - i;
    if (post.xx[j] !== live.xx[i] || post.yy[j] !== live.yy[i]) return false;
  }
  const pz = post.zz ?? null;
  const lz = live.zz ?? null;
  if ((pz === null) !== (lz === null)) return false;
  if (pz && lz) {
    if (pz.length !== lz.length) return false;
    for (let i = 0; i < pz.length; i++) {
      if (pz[sign === 1 ? i : pz.length - 1 - i] !== lz[i]) return false;
    }
  }
  return true;
}

function sameShape(a: PathShape, b: PathShape): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (pa.length !== pb.length) return false;
    for (let j = 0; j < pa.length; j++) if (pa[j] !== pb[j]) return false;
  }
  return true;
}

export function translateMiniDataset(opts: {
  mini: MiniDataset;
  liveDataset: MapshaperDataset;
  liveArcCount: number;
  liveLayers: readonly MapshaperLayer[];
}): MiniTranslation | null {
  const { mini, liveDataset, liveArcCount, liveLayers } = opts;
  const liveArcs = liveDataset.arcs!;
  const sentinelLayer = mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer;
  const sentinelShapes = sentinelLayer?.shapes;
  if (!sentinelShapes) return null;

  // 1. Parse sentinel lineages (orientation-aware) and build the reverse
  //    owner map. Lineage refs can be negative after dedup merges.
  const lineages: (readonly number[])[] = [];
  const owners = new Map<number, Array<{ original: number; sign: 1 | -1 }>>();
  for (let k = 0; k < mini.miniToLiveArc.length; k++) {
    const sentinel = sentinelShapes[k] as PathShape | null;
    if (!sentinel || sentinel.length !== 1 || sentinel[0]!.length === 0) {
      return null; // degenerate arc cleaned out from under us — refuse to guess
    }
    const lineage = sentinel[0]!;
    lineages.push(lineage);
    for (const ref of lineage) {
      const postId = unsigned(ref);
      const list = owners.get(postId) ?? [];
      list.push({ original: k, sign: ref < 0 ? -1 : 1 });
      owners.set(postId, list);
    }
  }

  // 2. Assign live ids deterministically (sentinel k ascending, lineage order,
  //    then unsentinelled arcs ascending). Each post id maps exactly once.
  const miniToLiveFinal: number[] = new Array(mini.arcs.size());
  const appendedArcs: AppendedArc[] = [];
  const assign = (postId: number): void => {
    if (miniToLiveFinal[postId] !== undefined) return;
    const list = owners.get(postId) ?? [];
    if (list.length === 1) {
      const { original, sign } = list[0]!;
      if (lineages[original]!.length === 1) {
        const liveId = mini.miniToLiveArc[original]!;
        if (
          arcsEqualOriented(
            snapshotLiveArc(mini.arcs, postId),
            snapshotLiveArc(liveArcs, liveId),
            sign,
          )
        ) {
          miniToLiveFinal[postId] = liveId; // untouched — reuse the live id
          return;
        }
      }
    }
    // Divided, snapped, or dedup-merged (multi-owner): append exactly once —
    // every owner translates to the same new id (legacy merge parity).
    miniToLiveFinal[postId] = liveArcCount + appendedArcs.length;
    appendedArcs.push(snapshotLiveArc(mini.arcs, postId));
  };
  for (const lineage of lineages) for (const ref of lineage) assign(unsigned(ref));
  for (let postId = 0; postId < mini.arcs.size(); postId++) {
    if (miniToLiveFinal[postId] === undefined) {
      miniToLiveFinal[postId] = liveArcCount + appendedArcs.length;
      appendedArcs.push(snapshotLiveArc(mini.arcs, postId));
    }
  }

  // 3. Translate + diff every included shape (real layers only).
  const translation: MiniTranslation = { appendedArcs, shapePatches: [], miniToLiveFinal };
  const shapePatches: PathShapePatch[] = [];
  for (const [layerIndex, featureIds] of mini.included) {
    const liveLayer = liveLayers[layerIndex] as PathLayer;
    const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
    for (const featureId of featureIds) {
      const before = liveLayer.shapes?.[featureId] as PathShape | null;
      const miniShape = miniLayer.shapes?.[featureId] as PathShape | null;
      if (!before || !miniShape) continue;
      let after: PathShape;
      try {
        after = translateShapeFromMini(translation, miniShape);
      } catch {
        return null;
      }
      if (!sameShape(before, after)) {
        shapePatches.push({
          layer: liveLayer,
          featureId,
          before: before.map((part) => part.slice()),
          after,
        });
      }
    }
  }
  translation.shapePatches = shapePatches;
  return translation;
}

export function translateShapeFromMini(translation: MiniTranslation, shape: PathShape): PathShape {
  return shape.map((part) =>
    part.map((ref) => {
      const mapped = translation.miniToLiveFinal[unsigned(ref)];
      if (mapped === undefined) throw new Error(`unmappable mini arc ref ${ref}`);
      return ref < 0 ? -mapped - 1 : mapped;
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run src/map/ops/_mini-translate.test.ts`
Expected: PASS (5 tests). If a contract fixture's exact ids differ, re-derive from an actual spike run — the invariants in the Step 1 calibration note must hold exactly.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/_mini-translate.ts src/map/ops/_mini-translate.test.ts
git commit -m "feat(ops): mini result translator with owner-map dedup handling"
```

---

### Task 3: Reshape polyline path planner

**Files:**
- Create: `src/map/ops/_reshape-plan.ts` (per-source planner shared by line/polygon)
- Modify: `src/map/ops/reshape-selected.ts` (ONLY the `validatePolylineFeature` extraction — see below)
- Test: `src/map/ops/_reshape-plan.test.ts` (create); `src/map/ops/reshape-selected-line.test.ts` (must pass UNCHANGED)
- Consumes: `buildMiniDataset`/`translateMiniDataset` (Tasks 1-2); `reshapeSelectedPolylines` (unchanged)

**Interfaces:**
- Produces (Tasks 4-5 consume):
```ts
// src/map/ops/_reshape-plan.ts
/** bbox of the drawn line, expanded by a contact-epsilon-scaled margin. */
export function reshapeLineBounds(line: readonly Coordinate[]): {
  minX: number; minY: number; maxX: number; maxY: number;
};
/** feature bbox (any part arc) intersects bounds ⇒ possible contact. */
export function shapeIntersectsBounds(
  shape: PathShape, arcs: ArcCollection, bounds: ReturnType<typeof reshapeLineBounds>,
): boolean;
/** Per-source reshape plan on the LIVE dataset; null = nothing contacted. */
export function planReshapeSource(opts: {
  source: MutableTopologySource;
  sourceId: string;
  dataset: MapshaperDataset;   // LIVE
  line: readonly Coordinate[];
  adapter: MapshaperAdapter;
  selection: Selection;
  publishSelection: (diff: SelectionDiff) => void;
}): { command: PathGeometryPatchCommand; reshapedCount: number } | 'invalid' | null;
```

- [ ] **Step 1: Write the failing planner tests**

```ts
// src/map/ops/_reshape-plan.test.ts
import { describe, expect, it } from 'vitest';
import { planReshapeSource } from './_reshape-plan';
// Fixtures: real datasets via mapshaper.internal.ArcCollection + PathLayer
// (mirror _mini-dataset.test.ts); source stub mirrors src/map/ops/_test-helpers.ts.

describe('planReshapeSource', () => {
  it('plans a polyline reshape with appended replacement arc and no live mutation', () => {
    // live dataset with one polyline feature; drawn line crossing it twice.
    // expect: plan not null/'invalid'; reshapedCount === 1;
    //   live arcs.size() unchanged after PLANNING (read-only);
    //   command.do() grows arcs by exactly the appended count;
    //   command.undo() restores arcs.size() and original coordinates exactly.
  });

  it('patches a non-candidate neighbor sharing a cut arc (topology linkage)', () => {
    // two polygons sharing an edge; the drawn line contacts only f0.
    // expect: shapePatches contains f1 with its shared span rewritten to the
    //   SAME piece ids f0's untouched shared span uses; uncut shared span keeps
    //   ONE arc id referenced by BOTH features.
  });

  it('returns null when the line contacts nothing', () => {
    // drawn line far away from every feature → null, no command constructed.
  });

  it('returns "invalid" when the legacy validator rejects a candidate', () => {
    // degenerate candidate geometry (e.g. self-conflicting clipped line) →
    // 'invalid'; live dataset untouched.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/_reshape-plan.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the planner**

```ts
// src/map/ops/_reshape-plan.ts
import { type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { PathGeometryPatchCommand } from '../../edit/commands/path-geometry-patch';
import type { MutableTopologySource } from '../../source/source';
import type { Selection, SelectionDiff } from '../selection';
import type { ArcCollection, MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { SplitGeometryValidationError } from './split-selected-error';
import { normalizeConsecutiveCoordinates, type Coordinate } from './geometry-2d';
import { reshapeSelectedPolylines } from './reshape-selected-line';
import { reshapeSelectedPolygon } from './reshape-selected-polygon';
import { buildMiniDataset } from './_mini-dataset';
import { translateMiniDataset } from './_mini-translate';

const BBOX_MARGIN = Number.EPSILON * 64;

export function reshapeLineBounds(line: readonly Coordinate[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of line) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const margin = BBOX_MARGIN * Math.max(1, Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

export function shapeIntersectsBounds(
  shape: PathShape,
  arcs: ArcCollection,
  bounds: ReturnType<typeof reshapeLineBounds>,
): boolean {
  const data = arcs.getVertexData();
  const bb = data.bb; // per-arc [xmin, ymin, xmax, ymax] when present
  for (const part of shape) {
    for (const ref of part) {
      const arcId = ref < 0 ? -ref - 1 : ref;
      if (bb) {
        const x0 = bb[arcId * 4]!, y0 = bb[arcId * 4 + 1]!;
        const x1 = bb[arcId * 4 + 2]!, y1 = bb[arcId * 4 + 3]!;
        if (x1 >= bounds.minX && x0 <= bounds.maxX && y1 >= bounds.minY && y0 <= bounds.maxY) {
          return true;
        }
        continue;
      }
      const start = data.ii[arcId]!;
      const end = start + data.nn[arcId]!;
      for (let v = start; v < end; v++) {
        const x = data.xx[v]!, y = data.yy[v]!;
        if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) return true;
      }
    }
  }
  return false;
}

export function planReshapeSource(opts: {
  source: MutableTopologySource;
  sourceId: string;
  dataset: MapshaperDataset;
  line: readonly Coordinate[];
  adapter: MapshaperAdapter;
  selection: Selection;
  publishSelection: (diff: SelectionDiff) => void;
}): { command: PathGeometryPatchCommand; reshapedCount: number } | 'invalid' | null {
  const { source, dataset, adapter, selection, publishSelection } = opts;
  const line = normalizeConsecutiveCoordinates(opts.line);
  const arcs = dataset.arcs;
  if (!arcs) return null;
  const bounds = reshapeLineBounds(line);

  // 1. Candidates per path layer (bbox prefilter). Polyline candidates are
  //    validated on live first (legacy skips invalid features non-fatally).
  const candidates = new Map<number, Set<number>>();
  for (let layerIndex = 0; layerIndex < dataset.layers.length; layerIndex++) {
    const layer = dataset.layers[layerIndex];
    if (!isPathLayer(layer) || !layer.shapes) continue;
    if (layer.geometry_type !== 'polygon' && layer.geometry_type !== 'polyline') continue;
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape || !shapeIntersectsBounds(shape, arcs, bounds)) continue;
      if (layer.geometry_type === 'polyline') {
        try {
          validatePolylineFeatureShape(shape, arcs); // extracted in this task
        } catch (error) {
          if (error instanceof SplitGeometryValidationError) continue;
          throw error;
        }
      }
      let set = candidates.get(layerIndex);
      if (!set) candidates.set(layerIndex, (set = new Set()));
      set.add(featureId);
    }
  }
  if (candidates.size === 0) return null;

  // 2. Mini dataset + legacy geometry, unchanged.
  const mini = buildMiniDataset({ dataset, candidates, adapter });
  let reshapedCount = 0;
  try {
    for (const [layerIndex, ids] of candidates) {
      const liveLayer = dataset.layers[layerIndex] as PathLayer;
      const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
      if (liveLayer.geometry_type === 'polygon') {
        for (const featureId of ids) {
          let shape: PathShape | null = null;
          try {
            shape = reshapeSelectedPolygon(mini.dataset, layerIndex, featureId, line, adapter);
          } catch (error) {
            if (!(error instanceof SplitGeometryValidationError)) throw error;
          }
          if (!shape) continue;
          miniLayer.shapes!.splice(featureId, 1, shape);
          reshapedCount += 1;
        }
      } else {
        const reshaped = reshapeSelectedPolylines(mini.dataset, layerIndex, ids, line, adapter);
        for (const { featureId, shape } of reshaped) {
          miniLayer.shapes!.splice(featureId, 1, shape);
          reshapedCount += 1;
        }
      }
    }
  } catch (error) {
    if (error instanceof SplitGeometryValidationError) return 'invalid';
    throw error;
  }
  if (reshapedCount === 0) return null;

  // 3. Translate mini results to live instructions.
  const translation = translateMiniDataset({
    mini,
    liveDataset: dataset,
    liveArcCount: arcs.size(),
    liveLayers: dataset.layers,
  });
  if (!translation) return 'invalid';

  return {
    reshapedCount,
    command: new PathGeometryPatchCommand({
      source,
      shapePatches: translation.shapePatches,
      originalArcCount: arcs.size(),
      appendedArcs: translation.appendedArcs,
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: selection.getAll(),
      publishSelection,
      label: `Reshape ${reshapedCount} feature${reshapedCount === 1 ? '' : 's'}`,
    }),
  };
}
```

`validatePolylineFeatureShape`: extract the per-shape body of `validatePolylineFeature` (`reshape-selected.ts:34-60`) into an exported helper; the legacy wrapper keeps calling it. Pure extraction, no behavior change — the ONLY allowed legacy-file modification in this task.

- [ ] **Step 4: Run planner tests + existing polyline reshape tests**

Run: `pnpm exec vitest run src/map/ops/_reshape-plan.test.ts src/map/ops/reshape-selected-line.test.ts`
Expected: planner tests PASS; `reshape-selected-line.test.ts` PASSES UNCHANGED.

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/_reshape-plan.ts src/map/ops/_reshape-plan.test.ts src/map/ops/reshape-selected.ts
git commit -m "feat(ops): per-source reshape planner on mini dataset"
```

---

### Task 4: Reshape orchestrator migration (per-source direct path)

**Files:**
- Modify: `src/map/ops/reshape-selected.ts:70-163` (replace `runPreparedDatasetMutation` with direct-runner dispatch)
- Test: `src/map/ops/reshape-selected.test.ts` (behavioral — update barrier-era undo assertions to multi-level expectations)
- Test: `src/map/ops/reshape-selected-polygon.test.ts` (must pass UNCHANGED)

**Interfaces:**
- Consumes: `planReshapeSource` (Task 3), `ctx.runPreparedEditCommand` (Phase A).

- [ ] **Step 1: Update the orchestrator**

Replace the per-source `ctx.runPreparedDatasetMutation(...)` block in `reshapeSelected` with:

```ts
export async function reshapeSelected(
  ctx: OpContext,
  options: ReshapeSelectedOptions,
): Promise<OpResult<ReshapeSelectedResult>> {
  const line: unknown = options.line;
  if (!isReshapeLine(line)) return Err.validation('line', 'line coordinates are invalid');
  const normalizedLine = normalizeConsecutiveCoordinates(line as Coordinate[]);
  const adapter = getDefaultMapshaperAdapter();
  let reshapedCount = 0;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(
      sourceId,
      'Reshape features',
      (planned, mutableSource) => {
        if (planned !== dataset) return Err.staleOperation(sourceId, 'Reshape features');
        const plan = planReshapeSource({
          source: mutableSource,
          sourceId,
          dataset: planned,
          line: normalizedLine,
          adapter,
          selection: ctx.host._selection,
          publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
        });
        if (plan === null) return Err.validation('line', 'did not reshape any feature');
        if (plan === 'invalid') return Err.validation('geometry', 'path geometry is invalid');
        return {
          value: { reshapedCount: plan.reshapedCount },
          affectedSourceIds: [sourceId],
          command: plan.command,
        };
      },
    );
    if (result.ok) {
      reshapedCount += result.value.reshapedCount;
      continue;
    }
    if (result.error.kind !== 'validation') return result;
  }
  if (reshapedCount === 0) return Err.validation('line', 'did not reshape any feature');
  return okValue({ reshapedCount });
}
```

Note: this keeps per-source history entries for now; Task 5 replaces the loop with a single multi-source entry.

- [ ] **Step 2: Update behavioral expectations in `reshape-selected.test.ts`**

The existing undo assertions pin barrier behavior. Update to the new contract:
- `reshape → reshape → undo → undo` now restores BOTH edits (multi-level), not "only the last one";
- geometry after each undo matches the pre-op state exactly;
- `dataset.arcs.size()` returns to its original value after the final undo;
- remove `DatasetReplaceSelectionCommand` assertions for reshape; assert `historychange` fires once per op;
- the stale-prepared-dataset case now trips the runner's editVersion guard (rename the test accordingly).

Polygon/line geometry test files MUST pass unmodified.

- [ ] **Step 3: Run the full reshape test set**

Run: `pnpm exec vitest run src/map/ops/reshape-selected.test.ts src/map/ops/reshape-selected-line.test.ts src/map/ops/reshape-selected-polygon.test.ts src/core/handlers/reshape-feature.test.ts`
Expected: PASS. Any geometric regression ⇒ fix the translator/planner, NOT the legacy geometry files.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/reshape-selected.ts src/map/ops/reshape-selected.test.ts
git commit -m "feat(ops): migrate reshapeSelected to direct patch commands"
```

---

### Task 5: Multi-source single-entry runner + reshape composite

**Files:**
- Modify: `src/map/ops/_runner.ts` (add `_runPreparedEditCommandMany` beside `_runPreparedEditCommand` at line 319; refactor `enqueueSourceOperation` at 174-197)
- Modify: `src/map/ops/_context.ts` (add `RunPreparedEditCommandMany` type + `OpContext` field)
- Modify: `src/map/mapshaper-ops.ts` (wire the new runner into `OpContext`)
- Modify: `src/map/ops/reshape-selected.ts` (replace the per-source loop with one multi-source call)
- Test: `src/map/ops/reshape-selected.test.ts` (multi-source single-entry case)

**Interfaces:**
- Produces:
```ts
// src/map/ops/_context.ts
export type RunPreparedEditCommandMany = <T>(
  sourceIds: readonly string[],
  label: string,
  plan: (
    sourceId: string,
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T> | null, // null = source not contacted
) => Promise<OpResult<T[]>>;
```

- [ ] **Step 1: Write the failing test**

```ts
// appended to src/map/ops/reshape-selected.test.ts
it('commits a multi-source reshape as ONE history entry', async () => {
  // host with TWO sources, each holding one polyline contacted by the line
  const result = await ops.reshapeSelected({ line: LINE_CROSSING_BOTH_SOURCES });
  expect(result.ok).toBe(true);
  // one undo restores both sources
  await map.undo();
  expect(sourceA_polylineCoords()).toEqual(ORIGINAL_A);
  expect(sourceB_polylineCoords()).toEqual(ORIGINAL_B);
  // one redo re-applies both
  await map.redo();
  expect(sourceA_polylineCoords()).toEqual(RESHAPED_A);
  expect(sourceB_polylineCoords()).toEqual(RESHAPED_B);
});
```

(Use the file's existing host/fixture builders; add a second source to the fixture.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/reshape-selected.test.ts -t "ONE history entry"`
Expected: FAIL — `runPreparedEditCommandMany` is not on the context.

- [ ] **Step 3: Implement the multi-source queue + runner**

Refactor `enqueueSourceOperation` (`_runner.ts:174-197`) into a multi-id variant and delegate:

```ts
function enqueueMultiSourceOperation<T>(
  host: EmapHostInternal,
  sourceIds: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  let queues = operationQueues.get(host);
  if (!queues) {
    queues = new Map();
    operationQueues.set(host, queues);
  }
  const uniqueIds = [...new Set(sourceIds)];
  const previous = uniqueIds.map((id) => queues!.get(id) ?? Promise.resolve());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  for (const id of uniqueIds) queues.set(id, gate);
  return Promise.all(previous.map((p) => p.catch(() => undefined)))
    .then(run)
    .finally(() => {
      release();
      for (const id of uniqueIds) if (queues!.get(id) === gate) queues!.delete(id);
    });
}

function enqueueSourceOperation<T>(
  host: EmapHostInternal,
  sourceId: string,
  run: () => Promise<T>,
): Promise<T> {
  return enqueueMultiSourceOperation(host, [sourceId], run);
}
```

Then add the runner beside `_runPreparedEditCommand`:

```ts
export function _runPreparedEditCommandMany<T>(
  host: EmapHostInternal,
  sourceIds: readonly string[],
  label: string,
  plan: (
    sourceId: string,
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T> | null,
): Promise<OpResult<T[]>> {
  const transaction = host._activeTransaction ?? null;
  const run = async (): Promise<OpResult<T[]>> => {
    if (host._removed) return Err.hostRemoved();
    // 1. Resolve + snapshot identity for every source.
    const entries: Array<{
      sourceId: string;
      source: MutableTopologySource;
      dataset: MapshaperDataset;
      editVersion: number;
    }> = [];
    for (const sourceId of sourceIds) {
      const source = host._sources.get(sourceId);
      const dataset = source?.getDataset();
      if (!source || !dataset) return Err.notFound('source', sourceId);
      entries.push({
        sourceId,
        source: source as unknown as MutableTopologySource,
        dataset,
        editVersion: dataset.editVersion ?? 0,
      });
    }
    // 2. Plan every source (read-only).
    const planned: Array<{ entry: (typeof entries)[number]; edit: PreparedDirectEdit<T> }> = [];
    const values: T[] = [];
    let validationFailure: OpResult<T> | null = null;
    for (const entry of entries) {
      let edit: PreparedDirectEdit<T> | OpResult<T> | null;
      try {
        edit = plan(entry.sourceId, entry.dataset, entry.source);
      } catch (err) {
        if (host._removed) return Err.hostRemoved();
        host.fire('error', { error: err });
        return Err.mapshaper(err, { operation: label });
      }
      if (edit === null) continue;
      if ('ok' in edit) {
        if (edit.ok === false && edit.error.kind === 'validation') {
          validationFailure ??= edit; // per-source validation tolerated
          continue;
        }
        return edit as OpResult<T[]>;
      }
      planned.push({ entry, edit });
      values.push(edit.value);
    }
    if (planned.length === 0) {
      return (validationFailure as OpResult<T[]>) ?? Err.validation('geometry', label);
    }
    // 3. Stale guard for every source.
    for (const { entry } of planned) {
      if (
        host._sources.get(entry.sourceId) !== entry.source ||
        entry.source.getDataset() !== entry.dataset ||
        (entry.dataset.editVersion ?? 0) !== entry.editVersion ||
        host._activeTransaction !== transaction ||
        (transaction !== null && !transaction.isOpen)
      ) {
        return Err.staleOperation(entry.sourceId, label);
      }
      transaction?._captureFirstTouch(entry.sourceId, entry.dataset);
    }
    // 4. Commit: single composite, single history entry.
    const command =
      planned.length === 1
        ? planned[0]!.edit.command
        : new CompositeCommand(planned.map((p) => p.edit.command), label);
    try {
      command.do();
    } catch (err) {
      try { command.undo(); } catch { /* best effort */ }
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, { operation: label });
    }
    host._history.push(command);
    (command as { publish?: () => void }).publish?.();
    if (!host._history.isCapturing()) host._fireHistoryChange();
    return okValue(values);
  };
  return enqueueMultiSourceOperation(host, sourceIds, run);
}
```

- [ ] **Step 4: Switch the orchestrator to one multi-source call**

In `reshape-selected.ts`, replace the `for (const [sourceId, source] of ctx.host._sources)` loop with:

```ts
  const sourceIds = [...ctx.host._sources.keys()].filter(
    (id) => !!ctx.host._sources.get(id)?.getDataset()?.arcs,
  );
  if (sourceIds.length === 0) return Err.validation('line', 'did not reshape any feature');
  const result = await ctx.runPreparedEditCommandMany(
    sourceIds,
    'Reshape features',
    (sourceId, planned, mutableSource) => {
      const dataset = ctx.host._sources.get(sourceId)?.getDataset();
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Reshape features');
      const plan = planReshapeSource({
        source: mutableSource,
        sourceId,
        dataset: planned,
        line: normalizedLine,
        adapter,
        selection: ctx.host._selection,
        publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
      });
      if (plan === null) return null; // source not contacted
      if (plan === 'invalid') return Err.validation('geometry', 'path geometry is invalid');
      return {
        value: { reshapedCount: plan.reshapedCount },
        affectedSourceIds: [sourceId],
        command: plan.command,
      };
    },
  );
  if (!result.ok) {
    if (result.error.kind === 'validation') {
      return Err.validation('line', 'did not reshape any feature');
    }
    return result;
  }
  const reshapedCount = result.value.reduce((sum, v) => sum + v.reshapedCount, 0);
  if (reshapedCount === 0) return Err.validation('line', 'did not reshape any feature');
  return okValue({ reshapedCount });
```

- [ ] **Step 5: Wire `OpContext`**

Add `runPreparedEditCommandMany: RunPreparedEditCommandMany` to `OpContext` in `_context.ts` and bind it in `mapshaper-ops.ts` next to the existing `runPreparedEditCommand` wiring (partial-apply `_runPreparedEditCommandMany(host, ...)` the same way).

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run src/map/ops/reshape-selected.test.ts src/map/ops/_runner.test.ts`
Expected: PASS, including the multi-source single-entry test and Phase A runner tests unchanged.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/_runner.ts src/map/ops/_context.ts src/map/mapshaper-ops.ts src/map/ops/reshape-selected.ts src/map/ops/reshape-selected.test.ts
git commit -m "feat(ops): multi-source single-entry reshape via composite command"
```

---

### Task 6: `SplitFeaturesCommand`

**Files:**
- Create: `src/edit/commands/split-features.ts`
- Test: `src/edit/commands/split-features.test.ts`
- Reference: `src/edit/commands/path-geometry-patch.ts:62-125` (mirror structure/publish/assertions — read the full file before writing), `src/edit/commands/feature-delete.ts` (record-array handling)

**Interfaces:**
- Produces (Tasks 7-8 consume):
```ts
export interface SplitFeaturesCommandOptions {
  source: TopologySource;
  /** Sharer patches + split targets' largest-piece after shapes. */
  shapePatches: PathShapePatch[];
  originalArcCount: number;
  appendedArcs: AppendedArc[];
  /** Target layer (split is single-source/single-layer). */
  layer: MapshaperLayer;
  appendedShapes: PathShape[];
  appendedRecords: (Record<string, unknown> | null)[];
  /** layer.shapes.length before the split — undo truncation point. */
  originalFeatureCount: number;
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
  adapter?: MapshaperAdapter;
}
export class SplitFeaturesCommand implements EditCommand { /* do/undo/publish */ }
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/edit/commands/split-features.test.ts
describe('SplitFeaturesCommand', () => {
  it('do appends arcs/features, patches shapes, replaces selection', () => {
    // layer with 2 features; command patches f0's shape and appends one feature.
    // expect shapes.length 2 → 3; appended record is a NEW object with equal
    // content; arcs.size grows by appendedArcs.length; selection === afterSelection.
  });

  it('undo restores shapes, records, arcs and selection exactly', () => {
    // after undo: shapes.length === originalFeatureCount; f0 shape deep-equals
    // the original; records truncated; arcs.size() back; selection restored.
  });

  it('redo reproduces identical arc ids and feature contents', () => {
    // do → undo → do; full shape table + arc vertex data after redo deep-equal
    // the state after the first do (arc ids stable).
  });

  it('asserts when the arc count drifted before redo', () => {
    // do → undo → externally append an arc → redo must throw (bypass guard).
  });
});
```

Fixtures: mock `ArcCollection` from `feature-create.test.ts:7-28`; layer stub with `data.getRecords()`; selection stub mirroring `path-geometry-patch.test.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/edit/commands/split-features.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the command**

Structure (read `path-geometry-patch.ts` in full and mirror its exact publish/selection semantics):

```ts
// src/edit/commands/split-features.ts
export class SplitFeaturesCommand implements EditCommand {
  readonly label: string;
  private readonly adapter: MapshaperAdapter;
  private readonly opts: SplitFeaturesCommandOptions;

  constructor(opts: SplitFeaturesCommandOptions) {
    this.label = opts.label;
    this.adapter = opts.adapter ?? getDefaultMapshaperAdapter();
    // Clone snapshots: callers reuse their arrays after construction.
    this.opts = {
      ...opts,
      shapePatches: opts.shapePatches.map((p) => ({
        layer: p.layer,
        featureId: p.featureId,
        before: p.before.map((part) => part.slice()),
        after: p.after.map((part) => part.slice()),
      })),
      appendedShapes: opts.appendedShapes.map((shape) => shape.map((part) => part.slice())),
      appendedRecords: opts.appendedRecords.map((r) => (r === null ? null : { ...r })),
    };
  }

  do(): void {
    const { opts } = this;
    const arcs = opts.source.getDataset()?.arcs;
    if (!arcs) throw new Error('SplitFeaturesCommand: source has no arcs');
    if (arcs.size() !== opts.originalArcCount) {
      throw new Error('SplitFeaturesCommand: arc collection drifted');
    }
    appendArcsCompat(this.adapter, arcs, opts.appendedArcs);
    for (const patch of opts.shapePatches) {
      (patch.layer as PathLayer).shapes![patch.featureId] = patch.after.map((part) => part.slice());
    }
    const layer = opts.layer as PathLayer;
    layer.shapes!.push(...opts.appendedShapes.map((shape) => shape.map((part) => part.slice())));
    const records = layer.data?.getRecords?.();
    if (records) records.push(...opts.appendedRecords.map((r) => (r === null ? null : { ...r })));
    opts.selection.apply(opts.afterSelection, 'replace'); // match PathGeometryPatchCommand exactly
    markSourceChanged(opts.source);
  }

  undo(): void {
    const { opts } = this;
    const arcs = opts.source.getDataset()?.arcs;
    if (!arcs) throw new Error('SplitFeaturesCommand: source has no arcs');
    // Selection restore first — mirror PathGeometryPatchCommand.undo exactly.
    const layer = opts.layer as PathLayer;
    layer.shapes!.length = opts.originalFeatureCount;
    const records = layer.data?.getRecords?.();
    if (records) records.length = opts.originalFeatureCount;
    for (const patch of opts.shapePatches) {
      (patch.layer as PathLayer).shapes![patch.featureId] = patch.before.map((part) => part.slice());
    }
    truncateArcsCompat(this.adapter, arcs, opts.originalArcCount);
    markSourceChanged(opts.source);
  }

  publish(): void {
    // Mirror PathGeometryPatchCommand.publish exactly: source 'data' (reason
    // 'edit') + selection diff publish.
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run src/edit/commands/split-features.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/edit/commands/split-features.ts src/edit/commands/split-features.test.ts
git commit -m "feat(edit): SplitFeaturesCommand for in-place feature splits"
```

---

### Task 7: Split polyline migration (point + polyline cutters)

**Files:**
- Modify: `src/map/ops/split-selected-geometry.ts` (replace `applySplitPieces` with a pure planner variant; delete the legacy function — clean cutover)
- Modify: `src/map/ops/split-selected.ts:128-192` (dispatch via `runPreparedEditCommand`)
- Test: `src/map/ops/split-selected-line.test.ts`, `src/map/ops/split-selected.test.ts`, `src/map/ops/split-selected.integration.test.ts` (update barrier-era undo expectations)
- Consumes: Tasks 1-2 (mini builder/translator), Task 6 (`SplitFeaturesCommand`)

**Interfaces:**
- Produces:
```ts
// src/map/ops/split-selected-geometry.ts
export interface SplitPiecesPlan {
  /** Per split target: the largest piece as the target's after shape (mini ids). */
  targetAfterShapes: Array<{ featureId: number; shape: PathShape }>;
  /** Remaining pieces in legacy append order (mini ids). */
  appendedShapes: PathShape[];
  /** appendedShapes[i] clones the record of this feature id. */
  appendedRecordSource: number[];
  resultFeatures: FeatureRef[];
  splitTargetCount: number;
}
export function planSplitPieces(opts: {
  layer: PathLayer;              // MINI layer, post-split shapes present
  selectedIds: ReadonlySet<number>;
  piecesByFeature: ReadonlyArray<SplitPieces>;
  arcs: ArcCollection;           // MINI arcs
  adapter: MapshaperAdapter;
  sourceId: string;
  layerId: string;
}): SplitPiecesPlan;
```

- [ ] **Step 1: Write the failing planner tests**

```ts
// src/map/ops/split-selected-geometry.test.ts (extend if present, else create)
describe('planSplitPieces', () => {
  it('keeps the largest piece at the original id and appends the rest in order', () => {
    // two-piece split of f0 (areas 10 and 4): f0 after = area-10 piece;
    // appendedShapes = [area-4 piece]; resultFeatures = [f0, appended id];
    // appendedRecordSource = [0].
  });
  it('preserves unsplit selected ids in resultFeatures', () => { /* ... */ });
  it('produces deterministic append order for multi-target splits', () => { /* ... */ });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/split-selected-geometry.test.ts -t planSplitPieces`
Expected: FAIL — `planSplitPieces` does not exist.

- [ ] **Step 3: Implement `planSplitPieces`**

Port the ordering/materialization logic from `applySplitPieces` (`split-selected-geometry.ts:42-90`) into the pure planner: same largest-piece sort (`adapter.getShapeArea`/`getShapePerimeter` on the MINI arcs), same append order (target order then splitter output order), same resultFeatures construction. Differences from the legacy body:
- no `shapes`/`records` mutation (return data instead);
- no temporary-layer splicing (temp layers die with the mini);
- NO `cleanArcReferences`;
- record cloning is deferred to the orchestrator via `appendedRecordSource`.

Then delete `applySplitPieces` (clean cutover — run `lsp references` on it first to confirm the orchestrator was its only caller).

- [ ] **Step 4: Switch the orchestrator**

Replace the `runPreparedDatasetMutation` call in `split-selected.ts` with:

```ts
  return ctx.runPreparedEditCommand(sourceId, 'Split selected features', (planned, mutableSource) => {
    if (planned !== callTimeDataset) return Err.staleOperation(sourceId, 'Split selected features');
    const liveLayer = ctx.host.layers.resolveInLayers(planned.layers, layerId);
    if (!liveLayer || !isPathLayer(liveLayer) || !liveLayer.shapes) {
      return Err.staleOperation(sourceId, 'Split selected features');
    }
    const liveLayerIndex = planned.layers.indexOf(liveLayer);
    if (liveLayerIndex === -1) return Err.staleOperation(sourceId, 'Split selected features');
    const arcs = planned.arcs;
    if (!arcs) return Err.validation('geometry', 'selected polyline geometry is invalid');
    try {
      if (liveLayer.geometry_type === 'polyline') {
        validateSelectedPolylines(liveLayer, selectedIds, arcs); // live, read-only
      }
      const mini = buildMiniDataset({
        dataset: planned,
        candidates: new Map([[liveLayerIndex, selectedIds]]),
        adapter,
      });
      let pieces;
      if (liveLayer.geometry_type === 'polygon') {
        if (cutter.type !== 'polyline') {
          return Err.validation('cutter', 'point cutters can only split polyline features');
        }
        pieces = splitSelectedPolygons(mini.dataset, liveLayerIndex, selectedIds, cutter, adapter);
      } else {
        const outcome = splitSelectedPolylines(mini.dataset, liveLayerIndex, selectedIds, cutter, adapter);
        if (cutter.type === 'point' && !outcome.pointOnSelectedPath) {
          throw new SplitGeometryValidationError('cutter', 'point is not on any selected line');
        }
        pieces = outcome.pieces;
      }
      if (pieces.length === 0) return Err.validation('cutter', 'did not split any selected feature');
      const plan = planSplitPieces({
        layer: mini.dataset.layers[liveLayerIndex] as PathLayer,
        selectedIds,
        piecesByFeature: pieces,
        arcs: mini.arcs,
        adapter,
        sourceId,
        layerId,
      });
      const translation = translateMiniDataset({
        mini,
        liveDataset: planned,
        liveArcCount: arcs.size(),
        liveLayers: planned.layers,
      });
      if (!translation) return Err.validation('geometry', 'split result translation failed');

      // Merge: translator patches cover sharers; target patches (largest piece)
      // win by featureId — a target's shape may also have been remapped in-mini.
      const patchByFeature = new Map<number, PathShapePatch>();
      for (const p of translation.shapePatches) patchByFeature.set(p.featureId, p);
      for (const { featureId, shape } of plan.targetAfterShapes) {
        patchByFeature.set(featureId, {
          layer: liveLayer,
          featureId,
          before: (liveLayer.shapes![featureId] as PathShape).map((part) => part.slice()),
          after: translateShapeFromMini(translation, shape),
        });
      }
      const liveRecords = (liveLayer as PathLayer).data?.getRecords?.();
      const appendedRecords = plan.appendedRecordSource.map((sourceFeatureId) =>
        liveRecords ? { ...(liveRecords[sourceFeatureId] ?? {}) } : null,
      );
      const command = new SplitFeaturesCommand({
        source: mutableSource,
        shapePatches: [...patchByFeature.values()],
        originalArcCount: arcs.size(),
        appendedArcs: translation.appendedArcs,
        layer: liveLayer,
        appendedShapes: plan.appendedShapes.map((shape) => translateShapeFromMini(translation, shape)),
        appendedRecords,
        originalFeatureCount: liveLayer.shapes!.length,
        selection: ctx.host._selection,
        beforeSelection: ctx.host._selection.snapshot(),
        afterSelection: plan.resultFeatures,
        publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
        label: `Split ${plan.splitTargetCount} feature${plan.splitTargetCount === 1 ? '' : 's'}`,
      });
      return {
        value: { splitTargetCount: plan.splitTargetCount, resultFeatures: plan.resultFeatures },
        affectedSourceIds: [sourceId],
        command,
      };
    } catch (error) {
      if (error instanceof SplitGeometryValidationError) {
        return Err.validation(error.field, error.reason);
      }
      throw error;
    }
  });
```

Both cutter paths (point via `insertCutPoints`, polyline via `addIntersectionCuts`) translate through the SAME sentinel-lineage translator — no path-specific handling. Note: on the polyline-cutter path the rebuild may snap/flatten coordinates (legacy did the same on the working copy); affected arcs simply fail the untouched check and append — geometrically identical to legacy.

- [ ] **Step 5: Update undo expectations in split tests**

`split-selected.integration.test.ts` pins barrier semantics. Update to multi-level expectations:
- split → split → undo → undo restores both;
- feature count/records/selection restored exactly after undo;
- `arcs.size()` returns to the original value after undo;
- the transaction undo-selection case keeps passing.

- [ ] **Step 6: Run the full split test set**

Run: `pnpm exec vitest run src/map/ops/split-selected.test.ts src/map/ops/split-selected-line.test.ts src/map/ops/split-selected.integration.test.ts src/map/ops/split-selected-geometry.test.ts src/core/handlers/split-feature.test.ts`
Expected: PASS. Geometric failures ⇒ fix planner/translator, never the legacy geometry files.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/split-selected.ts src/map/ops/split-selected-geometry.ts src/map/ops/split-selected.integration.test.ts
git commit -m "feat(ops): migrate splitSelected polylines to SplitFeaturesCommand"
```

---

### Task 8: Split polygon migration

**Files:**
- Modify: `src/map/ops/split-selected.ts` (polygon branch — already routed in Task 7; this task validates and fixes polygon-specific issues)
- Test: `src/map/ops/split-selected-polygon.test.ts` (must pass UNCHANGED), `src/adapter/mapshaper-feature-split.test.ts` (unchanged — adapter primitives untouched)

**Interfaces:**
- Consumes: everything from Tasks 1-7. No new interfaces.

- [ ] **Step 1: Run polygon tests against the migrated path**

Run: `pnpm exec vitest run src/map/ops/split-selected-polygon.test.ts`
Expected: PASS unchanged. The mosaic/noding now runs on the mini dataset; failures here mean the mini is missing context arcs (holes, multipolygon parts, sharers) — fix `buildMiniDataset` candidate collection, not the geometry.

- [ ] **Step 2: Add polygon-specific migration tests**

```ts
// appended to src/map/ops/split-selected.integration.test.ts
it('polygon split undo restores feature table and shared boundary ids', () => {
  // two adjacent polygons; split one with a polyline cutter.
  // after do: target has largest piece + appended feature; the neighbor shares
  //   the uncut boundary arc id with the pieces' boundary where untouched;
  // after undo: exact original shapes/arc count/records.
});

it('area conservation check still rejects invalid mosaic output on the mini path', () => {
  // reuse an existing rejection fixture from split-selected-polygon.test.ts
  // routed through the op facade (not the geometry function directly).
});
```

- [ ] **Step 3: Run + fix**

Run: `pnpm exec vitest run src/map/ops/split-selected-polygon.test.ts src/map/ops/split-selected.integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/split-selected.ts src/map/ops/split-selected.integration.test.ts
git commit -m "feat(ops): migrate splitSelected polygons to SplitFeaturesCommand"
```

---

### Task 9: Integration hardening, docs, example verification (browser-automated)

**Files:**
- Test: `src/map/ops/reshape-selected.test.ts`, `src/map/ops/split-selected.integration.test.ts` (append integration cases)
- Modify: `CHANGELOG.md` (add Phase B entry)
- Modify: `packages/docs/docs/guides/editing.md` + `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md`
- Verify: `packages/examples/examples/reshape-ring-part/index.html` via **ego-browser** (user-designated tool; read `skill://ego-browser` first)

**Interfaces:** none new.

- [ ] **Step 1: History stack tests**

```ts
it('reshape × 3 → undo × 3 → redo × 3 restores every stage exactly', async () => { /* ... */ });
it('split × 3 → undo × 3 → redo × 3 restores feature tables at every stage', async () => { /* ... */ });
it('mixed ring/reshape/split ops unwind in LIFO order', async () => { /* ... */ });
```

Each stage asserts: full shape table deep-equal, `arcs.size()`, records, selection refs.

- [ ] **Step 2: Topology linkage proof**

```ts
it('vertex edit on the uncut shared span after reshape moves both features', async () => {
  // adjacent polygons sharing an edge; reshape f0 across the shared edge;
  // then move a vertex on the remaining shared span via VertexMoveCommand;
  // assert BOTH features' geometry changed and they still reference the same
  // arc id for that span.
});
```

- [ ] **Step 3: Barrier + transaction interplay**

```ts
it('direct reshape → dataset replacement → undo replacement → undo reshape observes identity safely', async () => {
  // Assert CURRENT barrier behavior (replacement clears prior history).
  // Observation only — do NOT narrow the barrier (Phase D).
});
it('transaction capturing reshape + split commits one entry; rollback leaves no mutation', async () => { /* ... */ });
```

- [ ] **Step 4: Orphan-arc invariants**

```ts
it('live arc table grows monotonically across ops; undo returns to exact originalArcCount', () => { /* ... */ });
it('no cleanArcReferences on the split path', () => {
  // spy on adapter.cleanArcReferences during splitSelected → not called
});
```

- [ ] **Step 5: FeatureQuery/Flatbush invalidation on feature append**

Check the runner's publish path: `source.fire('data', { reason: 'edit' })` → map `_handleSourceData` invalidates shape caches. Verify the FeatureQuery Flatbush index for the target layer is dropped/rebuilt after a split (read `src/map/map.ts` data handler + feature-query cache code). If appends are not covered (Phase A covered deletes), add the invalidation and a test: query a feature added by split immediately after the op returns.

- [ ] **Step 6: Full suite + typecheck**

Run: `pnpm exec vitest run` and `pnpm typecheck`
Expected: full suite PASS, 0 type errors.

- [ ] **Step 7: Example verification via ego-browser**

Serve `packages/examples/examples/reshape-ring-part/` (check the examples README for the static server command) and drive it with ego-browser (visual workflow — the map is a canvas):

1. `useOrCreateTaskSpace('phase B example verification')`, `openOrReuseTab(<example url>)`;
2. perform 3 consecutive reshape ops and 3 split ops via canvas mouse drags (`dragMouse`) on the feature geometry;
3. after each op, screenshot + read the app's undo-history UI/state (via `js()` on the page's exposed map object if available) to confirm one new history entry per op;
4. undo step-by-step (Ctrl/Cmd+Z or the example's undo control), screenshot-verifying geometry restoration at each level; then redo;
5. verify selection/attribute table state matches at each undo level;
6. `completeTaskSpace(task.id, { keep: false })`.

- [ ] **Step 8: Docs + CHANGELOG + commit**

- `editing.md` (both locales): reshape/split are now incremental, multi-level undoable edits; orphan-arc note (exports compact a copy).
- `CHANGELOG.md`: Phase B entry under Unreleased.

```bash
git add -A
git commit -m "test(ops): phase B integration hardening + docs"
```

---

## Self-Review Notes (completed by the author)

- **Spec coverage:** §3.1→Task 1, §3.2→Task 2, §3.3→Task 6, §4.1→Tasks 3-5, §4.2→Task 7, §4.3→Task 8, §4.4→Task 7 Step 3 + Task 9 Step 4, §5→Task 5 + Task 9 Step 5, §6→per-task test steps + Task 9.
- **Type consistency:** `MiniDataset.miniToLiveArc` / `included` / `sentinelLayerIndex` (Task 1) consumed verbatim in Task 2; `MiniTranslation` (`appendedArcs`, `shapePatches`, `miniToLiveFinal`) and `translateShapeFromMini` defined in Task 2 and consumed in Tasks 3/7; `planSplitPieces` field names used identically in the Task 7 orchestrator code; `RunPreparedEditCommandMany` (Task 5) matches its `_context.ts` type.
- **Lineage mechanism:** spike-verified for both cutting paths plus dedup convergence (see header facts); the translator never infers identity from coordinates across arcs, only per-provenance-slot orientation-adjusted equality for the untouched check; multi-owner post arcs append once and converge on one new live id (legacy merge parity).
- **Known calibration points (flagged for implementers):** Task 2 contract fixtures assert exact ids derived from the 2026-08-30 spikes — re-derive from an actual run if a fixture detail shifts; Task 9 Step 5 is an explicit check-or-fix gate.
