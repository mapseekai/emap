# Direct Geometry Edit Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `reshapeSelected` and `splitSelected` from whole-dataset replacement (`insertCutPoints` on a `copyDataset` working copy + `DatasetReplaceSelectionCommand` barrier) to in-place reversible commands, unlocking stable multi-level undo/redo with topology linkage preserved.

**Architecture:** Spec: `DIRECT_GEOMETRY_EDIT_PHASE_B_DESIGN.md` (latest commit). Legacy geometry functions run **unchanged** on a bounded mini dataset containing ONLY the arcs referenced by candidate features (arc-level copy), plus live-aligned sparse layer `shapes` (candidates only; every shape in the mini references copied arcs exclusively — an out-of-range reference would be silently nulled by `remapDividedArcs`, probe-verified) and a trailing **sentinel provenance layer** (one polyline shape `[[arcId]]` per copied arc). Because uncopied arcs are absent from the mini arc table, they CANNOT be cut/snapped/deduped by `addIntersectionCuts` — the soundness invariant is constructive, not approximate. Neighbor features never enter the mini; the translator patches them by **lineage splice** (expanding each modified arc's reference into its translated piece sequence, order- and sign-aware, exactly `remapDividedArcs`' expansion rule). Arc identity comes from the sentinel layer through a **reverse owner map** `postArcId → owner count`: unique owner + singleton positive lineage + forward-equal coordinates → reuse the live id; multi-owner (dedup convergence) → append once and converge every owner on the same new live id (legacy merge parity); negative lineage → ALWAYS append (reuse would invert geometry under sign-preserving translation). Runtime arcs (no sentinel) are appended only when referenced by a translated output shape — candidate mini shapes PLUS explicit `extraShapes` (split's planned piece shapes reference cutter-derived boundary arcs that appear in no mini layer shape; omitting them would leave holes). Reshape commits one `PathGeometryPatchCommand` per source wrapped in a `CompositeCommand` (single history entry); split commits a new `SplitFeaturesCommand`. Planners are read-only against LIVE data; commands do/undo via append/truncate only.

**Tech Stack:** TypeScript, Vitest (`pnpm exec vitest run <file>`), mapshaper data structures, Phase A infrastructure (`PathGeometryPatchCommand`, `appendArcsCompat`/`truncateArcsCompat`, `_runPreparedEditCommand`).

**Verified spike facts (2026-08-30, `node -e` against `mapshaper.internal`):**
- `insertCutPoints(points, arcs)` returns `Uint32Array map` where pieces of original arc `i` are the contiguous id range `[map[i], (i+1 < map.length ? map[i+1] : arcs.size()) - 1]`; the divided collection is REPACKED (an undivided arc after a divided one still shifts id). Confirmed: arcs [2,3,2]-vertex, cut arc 1 → map `{0:0, 1:1, 2:3}`, size 3→4, untouched arc 2 moved to slot 3.
- Sentinel layer `[[0]],[[1]],…` through `insertCutPoints` + `remapDividedArcs` → `[[[0]],[[1,2]],[[3]]]` (exact ordered lineage).
- `addIntersectionCuts(dataset, {rebuild_topology:true})` runs `arcs.flatten()` + snap/dedup/cut loop + `buildTopology` + `cleanShapes` + `cleanArcReferences` (mapshaper.js:17024-17065). Sentinels survive all of it: square + cutter → sentinels `[[[0,1,2]],[[3]],[[4]],[[5]],[[6,7,8]]]`. `cleanShapes` does NOT drop single-arc sentinel shapes; `cleanArcReferences` removes nothing while sentinels reference every arc.
- **Dedup convergence + negative lineage (spike C):** arcs `[(0,0),(1,0)]` ×2 (same direction) + 1 reversed duplicate `[(1,0),(0,0)]` + cutter `[(0.5,-1),(0.5,1)]` → sentinels `[[[0,1]],[[0,1]],[[-2,-1]]]`, cutter `[[[2,3]]]`, 4 post arcs. Consequences: (a) multiple sentinels can claim the SAME post id — reuse requires a UNIQUE owner, else append once and converge; (b) lineage refs can be NEGATIVE — negative lineage must never reuse a live id (sign-preserving translation would invert geometry).
- **Dedup keep-choice + dropped cutter arcs (spike D):** copied arc `[(0,0),(1,0)]` + reversed-duplicate cutter `[(1,0),(0,0)]` → dedup keeps the SMALLER mini id (the copy wins over runtime-appended arcs); sentinel stays `[[0]]` (positive singleton → reuse is exact); cutter layer becomes `[[-1]]`; the dropped duplicate arc is compacted away (size 2→1). Consequences: unique-owner negative singletons are practically unreachable (still handled: append); runtime arcs referenced by no output shape must NOT be appended to live.
- **Out-of-range refs are silently nulled (probe):** a shape referencing an arc id outside the collection survives `remapDividedArcs` but the unknown ref becomes `null` (`[[0,99]]` → `[[0,null]]`). Hence the mini must NEVER hold a shape referencing an uncopied arc — this is why neighbor features are excluded from mini layers and patched by splice instead.
- Snapping consequence: coordinates snapped/flattened by the rebuild path no longer equal live originals; those arcs fail the untouched check and append — geometrically identical to legacy (which snapped the same way on the working copy), just slightly more orphan arcs.

## Global Constraints

- NEVER import `mapshaper` outside `src/adapter/mapshaper-adapter.ts` (AGENTS.md hard rule). New `createArcCollection` lives in the adapter; the NEW ops tests build every ArcCollection fixture through it (`arcsFrom` helper below) and never import mapshaper — legacy test files with direct imports (`feature-create.test.ts`, `vertex-move.test.ts`, …) are grandfathered, not precedent.
- Legacy geometry functions (`reshape-selected-line.ts`, `reshape-selected-polygon.ts`, `split-selected-line.ts`, `split-selected-polygon.ts`) are NOT modified — they run on the mini dataset. All migration logic lives in the orchestrators and the two new `_mini-*` modules.
- Planners MUST be synchronous, pure read-only on LIVE datasets; all live mutation happens inside `command.do()` (mini dataset mutation is fine — it is planner-owned scratch).
- **Soundness invariant:** the mini arc table contains ONLY arcs referenced by candidate features (+ runtime arcs the legacy function itself appends). Nothing outside the table can be modified by `insertCutPoints`/`addIntersectionCuts`/`buildTopology`/`cleanShapes`/`cleanArcReferences`.
- Arc lineage comes ONLY from the sentinel layer (plus build-time `miniToLiveArc`); NEVER byte-match a mini arc against arbitrary live arcs to infer identity. The untouched check compares a mini arc against its own provenance source, forward, and only for a positive singleton lineage with a unique owner.
- Every appended live arc stores its mini post-arc coordinates verbatim (forward) — therefore unsigned id mapping + per-reference sign preservation is exact in every case. Reuse is forbidden for negative lineage.
- A post-op mini arc id maps to at most ONE live id; multi-owner post arcs append ONE live arc shared by every owner's translated reference. Leftover (unsentinelled) arcs are appended only when referenced by candidate mini shapes or caller-supplied `extraShapes`; `miniToLiveFinal` may contain holes — translating a reference into a hole is a hard failure (broken lineage).
- No `cleanArcReferences` on the live path; orphan arcs are expected (export compacts a copy).
- `invalidatesPriorCommands` stays absent on the new commands — no history barrier.
- Commands clone shape snapshots at construction (PathGeometryPatchCommand precedent).
- Tests: `pnpm exec vitest run <file>`; type gate: `pnpm typecheck`. Commit after every task with conventional-commit messages. Run gates with bare `pnpm`/`pnpm exec`, NOT `rtk pnpm` (rtk shim resolves global tsc 7.0.2 — false failures).
- Feature refs use canonical layer ids via `getLayerId(layer, index)` (`src/source/layer-utils.ts`).

---

### Task 1: Adapter `createArcCollection` + mini-dataset builder (arc-level copy + sentinel layer)

**Files:**
- Modify: `src/adapter/mapshaper-adapter.ts` (interface near `appendArcs` ~line 206; implementation near `appendArcs` impl ~line 703)
- Create: `src/map/ops/_mini-dataset.ts`
- Test: `src/map/ops/_mini-dataset.test.ts` (create)
- Reference: `src/adapter/mapshaper-adapter-arcs.test.ts:153-157` (adapter-side ArcCollection patterns — note that file lives INSIDE the adapter boundary; ops tests build fixtures via `createArcCollection` instead)

**Interfaces:**
- Produces (Tasks 3,4,7,8 consume):
```ts
// src/adapter/mapshaper-adapter.ts — on MapshaperAdapter
/** Create a standalone ArcCollection holding the supplied arcs (ids 0..n-1). */
createArcCollection(arcsToAppend: AppendedArc[]): ArcCollection;

// src/map/ops/_mini-dataset.ts
export interface FeatureAt {
  layerIndex: number;
  featureId: number;
}
export interface MiniDataset {
  /** Scratch dataset: mini arcs + live-aligned candidate-only layers + trailing sentinel layer. */
  dataset: MapshaperDataset;
  /** Same object as dataset.arcs — convenience. */
  arcs: ArcCollection;
  /** miniArcId → liveArcId for every arc present at build time (provenance). */
  miniToLiveArc: readonly number[];
  /** Echo of the input candidates (layerIndex → featureIds). */
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  /** liveArcId → every live feature referencing it (copied arcs only; for splice translation). */
  referencers: ReadonlyMap<number, readonly FeatureAt[]>;
  /** Index of the sentinel layer in dataset.layers (= live layers.length). */
  sentinelLayerIndex: number;
}
export function buildMiniDataset(opts: {
  dataset: MapshaperDataset; // LIVE, read-only
  /** layerIndex → geometric candidate featureIds. */
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  adapter: MapshaperAdapter;
}): MiniDataset;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/map/ops/_mini-dataset.test.ts
import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { ArcCollection, MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { buildMiniDataset } from './_mini-dataset';

// Fixtures build ArcCollection through the adapter — ops tests never import
// mapshaper directly (AGENTS.md hard rule).
function arcsFrom(pointsPerArc: [number, number][][]): ArcCollection {
  return getDefaultMapshaperAdapter().createArcCollection(
    pointsPerArc.map((pts) => ({
      xx: Float64Array.from(pts.map((p) => p[0])),
      yy: Float64Array.from(pts.map((p) => p[1])),
      zz: null,
    })),
  );
}

function liveDataset(): MapshaperDataset {
  // f0 references arcs 0,1; f1 references arc 1 (twice: reversed + forward);
  // f2 references arc 0; arc 2 is unreferenced.
  const arcs = arcsFrom([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[9, 9], [9, 9]],
  ]);
  const layer: PathLayer = {
    geometry_type: 'polygon',
    shapes: [[[0, 1]], [[-2, 1]], [[0]]] as PathShape[],
  } as unknown as PathLayer;
  return { arcs, layers: [layer] } as unknown as MapshaperDataset;
}

describe('buildMiniDataset', () => {
  const adapter = getDefaultMapshaperAdapter();

  it('copies only candidate-referenced arcs, with provenance and sparse translated shapes', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([2])]]), // f2 references arc 0 only
      adapter,
    });
    expect(mini.miniToLiveArc).toEqual([0]); // arc 1 (not referenced by f2) NOT copied
    expect(mini.candidates.get(0)).toEqual(new Set([2]));
    expect(mini.arcs.size()).toBe(1);
    const shapes = (mini.dataset.layers[0] as PathLayer).shapes!;
    expect(shapes.length).toBe(3); // live-aligned sparse array
    expect(shapes[0]).toBeNull();
    expect(shapes[1]).toBeNull();
    expect(shapes[2]).toEqual([[0]]);
  });

  it('indexes live referencers of copied arcs for splice translation', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]), // f0 references arcs 0,1
      adapter,
    });
    expect(mini.miniToLiveArc).toEqual([0, 1]); // arc 2 unreferenced → not copied
    expect(mini.referencers.get(0)).toEqual([
      { layerIndex: 0, featureId: 0 },
      { layerIndex: 0, featureId: 2 },
    ]);
    expect(mini.referencers.get(1)).toEqual([
      { layerIndex: 0, featureId: 0 },
      { layerIndex: 0, featureId: 1 },
    ]);
    // Neighbor features do NOT enter the mini: only candidate shapes are present.
    const shapes = (mini.dataset.layers[0] as PathLayer).shapes!;
    expect(shapes[0]).toEqual([[0, 1]]);
    expect(shapes[1]).toBeNull(); // f1 references arc 1 but is NOT a candidate
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
    expect(sentinel.shapes).toEqual([[[0]], [[1]]]);
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
    expect(Array.from(miniXx)).toEqual([0, 1]);
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

  it('never aliases a no-candidate path layer; live layers survive a mini rebuild', () => {
    // layer 0 holds the candidate (references arc 0); layer 1 has NO
    // candidates and its shapes reference live arc ids that are OUT OF RANGE
    // in the mini arc table (mini copies arc 0 only).
    const arcs = arcsFrom([
      [[0, 0], [1, 0]],
      [[1, 0], [2, 0]],
      [[5, 5], [6, 5]],
    ]);
    const layer0 = { geometry_type: 'polyline', shapes: [[[0]]] } as unknown as PathLayer;
    const layer1 = { geometry_type: 'polyline', shapes: [[[1]], [[2]]] } as unknown as PathLayer;
    const live = { arcs, layers: [layer0, layer1] } as unknown as MapshaperDataset;
    const liveShapes1 = layer1.shapes;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // No-candidate path layers are CLONED with live-length all-null shapes —
    // addIntersectionCuts/remapDividedArcs/cleanShapes rewrite every path
    // layer in place, so passing the live layer through would corrupt it.
    const miniLayer1 = mini.dataset.layers[1] as PathLayer;
    expect(miniLayer1).not.toBe(layer1);
    expect(miniLayer1.shapes).toEqual([null, null]);
    adapter.addIntersectionCuts(mini.dataset, { rebuild_topology: true });
    expect(layer1.shapes).toBe(liveShapes1);
    expect(layer1.shapes).toEqual([[[1]], [[2]]]);
    expect((live.layers[0] as PathLayer).shapes).toEqual([[[0]]]);
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

export interface FeatureAt {
  layerIndex: number;
  featureId: number;
}
export interface MiniDataset {
  dataset: MapshaperDataset;
  arcs: ArcCollection;
  miniToLiveArc: readonly number[];
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  referencers: ReadonlyMap<number, readonly FeatureAt[]>;
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

  // 1. Arc-level copy set: exactly the arcs referenced by candidate features.
  //    Soundness invariant: arcs outside the mini table cannot be cut, snapped,
  //    or deduped — so nothing else may enter. Neighbor features are patched
  //    later by lineage splice (see _mini-translate.ts), never via mini shapes.
  const liveIds = new Set<number>();
  for (const [layerIndex, ids] of candidates) {
    const layer = dataset.layers[layerIndex] as PathLayer;
    for (const featureId of ids) {
      const shape = layer.shapes?.[featureId] as PathShape | null;
      if (!shape) continue;
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

  // 2. Referencers index: every live feature referencing a copied arc (one
  //    pass over all path layers).
  const referencers = new Map<number, FeatureAt[]>();
  for (const liveId of sorted) referencers.set(liveId, []);
  for (let layerIndex = 0; layerIndex < dataset.layers.length; layerIndex++) {
    const layer = dataset.layers[layerIndex];
    if (!isPathLayer(layer) || !layer.shapes) continue;
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      const seen = new Set<number>();
      for (const part of shape) {
        for (const ref of part) seen.add(unsigned(ref));
      }
      for (const liveId of seen) {
        referencers.get(liveId)?.push({ layerIndex, featureId });
      }
    }
  }

  // 3. Layers: same length as live. EVERY path layer with a shapes array is
  //    cloned with a live-length all-null shapes array, filling candidate
  //    slots only — addIntersectionCuts/remapDividedArcs/cleanShapes rewrite
  //    every path layer in place, so passing a live path layer through would
  //    alias its real shapes into the mini (in-place corruption + out-of-range
  //    refs nulled). Only non-path layers (or shapeless ones) pass through.
  const layers = dataset.layers.map((layer, layerIndex) => {
    if (!isPathLayer(layer) || !layer.shapes) return layer;
    const ids = candidates.get(layerIndex);
    const shapes: (PathShape | null)[] = new Array(layer.shapes.length).fill(null);
    if (ids) {
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
    candidates,
    referencers,
    sentinelLayerIndex,
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm exec vitest run src/map/ops/_mini-dataset.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/adapter/mapshaper-adapter.ts src/map/ops/_mini-dataset.ts src/map/ops/_mini-dataset.test.ts
git commit -m "feat(ops): mini-dataset builder with arc-level copy and sentinel provenance"
```

---

### Task 2: Result translator `_mini-translate.ts` (owner map + positive-only reuse + splice)

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
  /** Patches for candidates (translated mini shapes) and spliced neighbors. */
  shapePatches: PathShapePatch[];
  /**
   * post-op miniArcId → liveArcId. Holes (undefined) are legal for runtime
   * arcs referenced by no output shape/lineage (e.g. discarded cutter
   * pieces) — they are never appended. Translating a ref into a hole throws.
   */
  miniToLiveFinal: readonly (number | undefined)[];
}
/**
 * Returns null when lineage is broken (missing/nulled sentinel).
 * `extraShapes`: planned output shapes (mini ids) that live outside the mini
 * layers — split's targetAfterShapes/appendedShapes reference cutter-derived
 * boundary arcs appearing in no candidate layer shape; passing them lets the
 * reference-collection phase map those arcs. Omit for reshape (candidate
 * shapes are authoritative).
 */
export function translateMiniDataset(opts: {
  mini: MiniDataset;       // AFTER the legacy geometry function ran on it
  liveDataset: MapshaperDataset;
  liveArcCount: number;    // live arcs.size() captured at plan start
  liveLayers: readonly MapshaperLayer[]; // live layers (for patch layer refs)
  extraShapes?: readonly PathShape[];
}): MiniTranslation | null;
/** Translate one mini-space shape to live arc ids. Throws on unmappable refs (call after null-check). */
export function translateShapeFromMini(translation: MiniTranslation, shape: PathShape): PathShape;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/map/ops/_mini-translate.test.ts
import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { ArcCollection, MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { buildMiniDataset } from './_mini-dataset';
import { translateMiniDataset, translateShapeFromMini } from './_mini-translate';

// Fixtures build ArcCollection through the adapter — ops tests never import
// mapshaper directly (AGENTS.md hard rule).
function arcsFrom(pointsPerArc: [number, number][][]): ArcCollection {
  return getDefaultMapshaperAdapter().createArcCollection(
    pointsPerArc.map((pts) => ({
      xx: Float64Array.from(pts.map((p) => p[0])),
      yy: Float64Array.from(pts.map((p) => p[1])),
      zz: null,
    })),
  );
}

// f0 = [[0,1]] (candidate); f1 = [[-2]] references ~arc1 (neighbor, NOT copied
// as a shape); f2 = [[2]] references arc 2 (untouched by everything).
function liveDataset(): MapshaperDataset {
  const arcs = arcsFrom([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[9, 9], [9, 9]],
  ]);
  const layer: PathLayer = {
    geometry_type: 'polyline',
    shapes: [[[0, 1]], [[-2]], [[2]]] as PathShape[],
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
    expect(translation!.miniToLiveFinal).toEqual([0, 1]);
  });

  it('appends a mini-only arc (no sentinel) only when referenced by an output shape', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Simulate a legacy reshape outcome: append replacement arc (mini id 2,
    // no sentinel) and point the candidate's shape at it. Also append an
    // UNREFERENCED arc (mini id 3, e.g. a discarded cutter piece).
    adapter.appendArc(mini.arcs, [[5, 5], [6, 6]]);
    adapter.appendArc(mini.arcs, [[7, 7], [8, 8]]);
    const miniLayer = mini.dataset.layers[0] as PathLayer;
    miniLayer.shapes![0] = [[2, 1]];
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toHaveLength(1); // arc 3 NOT appended
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([5, 6]);
    expect(translation!.miniToLiveFinal).toEqual([0, 1, 3, undefined]);
    expect(translation!.shapePatches).toEqual([
      {
        layer: live.layers[0],
        featureId: 0,
        before: [[0, 1]],
        after: [[3, 1]],
      },
    ]);
  });

  it('maps arcs referenced ONLY by extraShapes (split planned piece shapes)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Append a runtime arc (mini id 2, no sentinel) referenced by NO candidate
    // layer shape — only by the planned split output shape passed as extraShapes.
    adapter.appendArc(mini.arcs, [[5, 5], [6, 6]]);
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
      extraShapes: [[[2]]],
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(translation!.miniToLiveFinal).toEqual([0, 1, 3]);
    // …and the same call WITHOUT extraShapes leaves the arc unmapped, so
    // translating the planned shape throws (regression guard for Task 7).
    const translation2 = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(() => translateShapeFromMini(translation2!, [[[0]][0] ? [[2]] : []])).toThrow();
  });

  // Contract test: spike A (2026-08-30) — sentinel lineage through insertCutPoints,
  // with the neighbor patched by lineage SPLICE (it never enters the mini).
  it('resolves divided-arc lineage and splices the non-candidate neighbor', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]), // copies arcs 0,1
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
    // Sentinel lineage: arc0→[0] (reuse live 0), arc1→[1,2] (append → 3,4).
    expect(translation!.miniToLiveFinal).toEqual([0, 3, 4]);
    expect(translation!.appendedArcs).toHaveLength(2);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([1, 1.5]);
    expect(Array.from(translation!.appendedArcs[1]!.xx)).toEqual([1.5, 2]);
    // Candidate f0: mini shape [[0,1,2]] → [[0,3,4]].
    // Neighbor f1 (never in mini): live [[-2]] (~arc1) → reversed+flipped
    // lineage expansion [~4, ~3] = [[-5, -4]]. Same piece ids — linkage.
    const byFeature = new Map(translation!.shapePatches.map((p) => [p.featureId, p]));
    expect(byFeature.get(0)?.after).toEqual([[0, 3, 4]]);
    expect(byFeature.get(1)?.after).toEqual([[-5, -4]]);
    expect(byFeature.has(2)).toBe(false); // arc 2 untouched → no patch
  });

  // Contract test: spike C (2026-08-30) — dedup convergence + negative lineage.
  // Fixture verified verbatim against mapshaper.internal.addIntersectionCuts:
  //   live L0=L1=[(0,0),(1,0)], L2=[(1,0),(0,0)], cutter [(0.5,-1),(0.5,1)].
  //   post: sentinels [[[0,1]],[[0,1]],[[-2,-1]]], cutter [[[2,3]]].
  it('merges deduped arcs into ONE appended arc per post id (signs preserved)', () => {
    const arcs = arcsFrom([
      [[0, 0], [1, 0]],
      [[0, 0], [1, 0]],
      [[1, 0], [0, 0]],
    ]);
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
    // (multi-owner) → appended once each: live ids 3,4. Cutter pieces (mini
    // ids 2,3) are referenced only by the discarded cutter layer → NOT appended.
    expect(translation!.miniToLiveFinal.slice(0, 2)).toEqual([3, 4]);
    expect(translation!.appendedArcs).toHaveLength(2);
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

  // Contract test: spike D (2026-08-30) — dedup keeps the copied arc over a
  // reversed-duplicate cutter; reuse stays exact; dropped arc not appended.
  it('reuses the live id when dedup keeps the copied arc (positive singleton)', () => {
    const arcs = arcsFrom([[[0, 0], [1, 0]]]);
    const layer: PathLayer = {
      geometry_type: 'polyline',
      shapes: [[[0]]] as PathShape[],
    } as unknown as PathLayer;
    const live = { arcs, layers: [layer] } as unknown as MapshaperDataset;
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Append a reversed-duplicate cutter arc (mini id 1) and run the rebuild.
    adapter.appendArc(mini.arcs, [[1, 0], [0, 0]]);
    adapter.addIntersectionCuts(mini.dataset, { rebuild_topology: true });
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    expect(translation!.appendedArcs).toEqual([]);
    expect(translation!.shapePatches).toEqual([]);
    expect(translation!.miniToLiveFinal).toEqual([0]);
  });

  it('never reuses a live id for a NEGATIVE singleton lineage (would invert geometry)', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Simulate a dedup merge of copied arc 0 into a reversed-identical runtime
    // arc: overwrite mini arc 0's coordinates with the reverse of live arc 0
    // and flip the sentinel to [[-1]] (~arc0). (Practically unreachable after
    // spike D — dedup keeps the copy — but the rule must hold regardless.)
    adapter.truncateArcs!(mini.arcs, 0);
    adapter.appendArc(mini.arcs, [[1, 0], [0, 0]]); // reverse of live arc 0
    (mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer).shapes![0] = [[-1]];
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    // Negative singleton → append (live id 3), NOT reuse (0). Candidate f0's
    // mini shape [[0]] translates to [[3]] with geometry == original arc 0.
    expect(translation!.miniToLiveFinal).toEqual([3, undefined]);
    expect(translation!.appendedArcs).toHaveLength(1);
    expect(Array.from(translation!.appendedArcs[0]!.xx)).toEqual([1, 0]);
    const f0 = translation!.shapePatches.find((p) => p.featureId === 0);
    expect(f0?.after).toEqual([[3]]);
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

Calibration note for the implementer: the contract tests assert exact ids derived from the 2026-08-30 spikes; if a fixture detail shifts an id, re-derive from an actual run — the invariants that MUST hold regardless: every output-referenced post id maps exactly once (candidate shapes, extraShapes, and lineage entries combined); multi-owner post arcs append exactly once; negative lineage never reuses; untouched arcs reuse their live ids; neighbor and candidate patches reference identical piece ids with correct signs.

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
  miniToLiveFinal: readonly (number | undefined)[];
}

function unsigned(id: number): number {
  return id < 0 ? -id - 1 : id;
}

/** Bitwise-complement a mapshaper arc reference (flip traversal direction). */
function flipRef(ref: number): number {
  return -ref - 1;
}

/** Forward coordinate equality (xy + zz-nullness + zz) between two arc snapshots. */
function arcsEqualForward(a: AppendedArc, b: AppendedArc): boolean {
  const n = a.xx.length;
  if (n !== b.xx.length) return false;
  for (let i = 0; i < n; i++) {
    if (a.xx[i] !== b.xx[i] || a.yy[i] !== b.yy[i]) return false;
  }
  const az = a.zz ?? null;
  const bz = b.zz ?? null;
  if ((az === null) !== (bz === null)) return false;
  if (az && bz) {
    if (az.length !== bz.length) return false;
    for (let i = 0; i < az.length; i++) if (az[i] !== bz[i]) return false;
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
  extraShapes?: readonly PathShape[];
}): MiniTranslation | null {
  const { mini, liveDataset, liveArcCount, liveLayers, extraShapes } = opts;
  const liveArcs = liveDataset.arcs!;
  const sentinelLayer = mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer;
  const sentinelShapes = sentinelLayer?.shapes;
  if (!sentinelShapes) return null;

  // 1. Parse sentinel lineages (sign kept per entry) and count owners per
  //    post id. Lineage refs can be negative after dedup merges.
  const lineages: (readonly number[])[] = [];
  const ownerCount = new Map<number, number>();
  for (let k = 0; k < mini.miniToLiveArc.length; k++) {
    const sentinel = sentinelShapes[k] as PathShape | null;
    if (!sentinel || sentinel.length !== 1 || sentinel[0]!.length === 0) {
      return null; // degenerate arc cleaned out from under us — refuse to guess
    }
    const lineage = sentinel[0]!;
    lineages.push(lineage);
    for (const ref of lineage) {
      const postId = unsigned(ref);
      ownerCount.set(postId, (ownerCount.get(postId) ?? 0) + 1);
    }
  }

  // 2. Assign live ids for sentinel-covered arcs (deterministic: sentinel k
  //    ascending, lineage order). Each post id maps at most once.
  const miniToLiveFinal: (number | undefined)[] = new Array(mini.arcs.size());
  const appendedArcs: AppendedArc[] = [];
  const assignAppend = (postId: number): void => {
    miniToLiveFinal[postId] = liveArcCount + appendedArcs.length;
    appendedArcs.push(snapshotLiveArc(mini.arcs, postId));
  };
  for (let k = 0; k < lineages.length; k++) {
    const lineage = lineages[k]!;
    for (const ref of lineage) {
      const postId = unsigned(ref);
      if (miniToLiveFinal[postId] !== undefined) continue;
      // Reuse is exact ONLY for a positive singleton lineage with a unique
      // owner and forward-identical coordinates. A negative singleton means
      // reverse(coords(p)) == coords(L): reusing L would translate ~p → ~L,
      // inverting the geometry — append instead (every appended arc stores
      // its mini coordinates forward, so sign preservation stays exact).
      if (ownerCount.get(postId) === 1 && lineage.length === 1 && ref >= 0) {
        const liveId = mini.miniToLiveArc[k]!;
        if (
          arcsEqualForward(
            snapshotLiveArc(mini.arcs, postId),
            snapshotLiveArc(liveArcs, liveId),
          )
        ) {
          miniToLiveFinal[postId] = liveId;
          continue;
        }
      }
      assignAppend(postId);
    }
  }

  // 3. Runtime arcs (no sentinel) are appended ONLY when referenced by an
  //    output shape: candidate mini layer shapes OR caller-supplied
  //    extraShapes (split's planned piece shapes reference cutter-derived
  //    boundary arcs that appear in no layer shape). Discarded cutter pieces
  //    stay unmapped (holes) and never reach live.
  const referenced = new Set<number>();
  const collectRefs = (shape: PathShape): void => {
    for (const part of shape) for (const ref of part) referenced.add(unsigned(ref));
  };
  for (const [layerIndex, ids] of mini.candidates) {
    const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
    for (const featureId of ids) {
      const shape = miniLayer.shapes?.[featureId] as PathShape | null;
      if (shape) collectRefs(shape);
    }
  }
  for (const shape of extraShapes ?? []) collectRefs(shape);
  const pending = [...referenced]
    .filter((postId) => miniToLiveFinal[postId] === undefined)
    .sort((a, b) => a - b);
  for (const postId of pending) assignAppend(postId);

  const translation: MiniTranslation = { appendedArcs, shapePatches: [], miniToLiveFinal };

  // 4. Candidate stage: translate mini shapes, diff against live.
  const shapePatches: PathShapePatch[] = [];
  for (const [layerIndex, featureIds] of mini.candidates) {
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

  // 5. Splice stage: non-candidate live features referencing a MODIFIED copied
  //    arc get the translated lineage spliced into their live shape — order-
  //    and sign-aware, exactly remapDividedArcs' expansion rule:
  //      +L → translated lineage sequence
  //      ~L → reversed sequence with every ref flipped
  const translatedLineages = lineages.map((lineage) =>
    lineage.map((ref) => {
      const mapped = miniToLiveFinal[unsigned(ref)];
      if (mapped === undefined) throw new Error(`unmappable lineage ref ${ref}`);
      return ref < 0 ? flipRef(mapped) : mapped;
    }),
  );
  const spliceByFeature = new Map<
    string,
    { layerIndex: number; featureId: number; after: PathShape }
  >();
  for (let k = 0; k < mini.miniToLiveArc.length; k++) {
    const liveId = mini.miniToLiveArc[k]!;
    const seq = translatedLineages[k]!;
    if (seq.length === 1 && seq[0] === liveId) continue; // identity — untouched
    for (const at of mini.referencers.get(liveId) ?? []) {
      if (mini.candidates.get(at.layerIndex)?.has(at.featureId)) continue; // candidate stage owns it
      const key = `${at.layerIndex}:${at.featureId}`;
      let entry = spliceByFeature.get(key);
      if (!entry) {
        const liveLayer = liveLayers[at.layerIndex] as PathLayer;
        const before = liveLayer.shapes?.[at.featureId] as PathShape | null;
        if (!before) continue;
        entry = {
          layerIndex: at.layerIndex,
          featureId: at.featureId,
          after: before.map((part) => part.slice()),
        };
        spliceByFeature.set(key, entry);
      }
      entry.after = entry.after.map((part) => {
        const out: number[] = [];
        for (const ref of part) {
          if (unsigned(ref) !== liveId) {
            out.push(ref);
          } else if (ref >= 0) {
            out.push(...seq);
          } else {
            for (let i = seq.length - 1; i >= 0; i--) out.push(flipRef(seq[i]!));
          }
        }
        return out;
      });
    }
  }
  for (const { layerIndex, featureId, after } of spliceByFeature.values()) {
    const liveLayer = liveLayers[layerIndex] as PathLayer;
    const before = liveLayer.shapes![featureId] as PathShape;
    if (!sameShape(before, after)) {
      shapePatches.push({
        layer: liveLayer,
        featureId,
        before: before.map((part) => part.slice()),
        after,
      });
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
      return ref < 0 ? flipRef(mapped) : mapped;
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run src/map/ops/_mini-translate.test.ts`
Expected: PASS (8 tests). If a contract fixture's exact ids differ, re-derive from an actual spike run — the invariants in the Step 1 calibration note must hold exactly.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/_mini-translate.ts src/map/ops/_mini-translate.test.ts
git commit -m "feat(ops): mini result translator with owner map, positive-only reuse, lineage splice"
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

  it('patches a non-candidate neighbor sharing a cut arc (topology linkage via splice)', () => {
    // two polygons sharing an edge; the drawn line contacts only f0.
    // The neighbor f1 NEVER enters the mini — its patch is produced by
    // lineage splice (translator stage 5).
    // expect: shapePatches contains f1 with its shared span rewritten to the
    //   SAME piece ids f0's cut span uses; the uncut shared span keeps ONE
    //   arc id referenced by BOTH features.
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

  // 2. Mini dataset (candidate arcs only — neighbors are handled by splice in
  //    the translator) + legacy geometry, unchanged.
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

  // 3. Translate mini results to live instructions (candidates translated,
  //    neighbors spliced). No extraShapes: candidate shapes are authoritative.
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
  /** Spliced-neighbor patches + split targets' largest-piece after shapes. */
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
      // extraShapes is REQUIRED: planned piece shapes reference cutter-derived
      // boundary arcs (polygon split) that appear in no mini layer shape —
      // without them those arcs stay unmapped and translation would fail.
      const translation = translateMiniDataset({
        mini,
        liveDataset: planned,
        liveArcCount: arcs.size(),
        liveLayers: planned.layers,
        extraShapes: [
          ...plan.targetAfterShapes.map((t) => t.shape),
          ...plan.appendedShapes,
        ],
      });
      if (!translation) return Err.validation('geometry', 'split result translation failed');

      // Merge: translator patches cover candidates (translated) AND neighbors
      // (spliced); target patches (largest piece) win by featureId — a target's
      // own translated shape was produced before the largest-piece choice.
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

Both cutter paths (point via `insertCutPoints`, polyline via `addIntersectionCuts`) translate through the SAME sentinel-lineage translator — no path-specific handling. Note: on the polyline-cutter path the rebuild may snap/flatten coordinates (legacy did the same on the working copy); affected arcs simply fail the untouched check and append — geometrically identical to legacy. Cutter segments referenced by no output shape never reach live (referenced-only append rule, with `extraShapes` covering the boundary arcs that DO make it into pieces).

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
Expected: PASS unchanged. The mosaic/noding now runs on the mini dataset; failures here mean the mini is missing candidate context arcs (holes, multipolygon parts) — fix `buildMiniDataset` candidate arc collection, not the geometry.

- [ ] **Step 2: Add polygon-specific migration tests**

```ts
// appended to src/map/ops/split-selected.integration.test.ts
it('polygon split undo restores feature table and shared boundary ids', () => {
  // two adjacent polygons; split one with a polyline cutter.
  // after do: target has largest piece + appended feature; the neighbor shares
  //   the uncut boundary arc id with the pieces' boundary where untouched;
  // after undo: exact original shapes/arc count/records.
});

it('cutter-derived boundary arcs of split pieces reach live exactly once', () => {
  // polygon split; the pieces' shared cut boundary is a cutter-derived arc.
  // assert: it is appended ONCE and referenced (with opposite signs) by both
  // pieces; undo removes it (arcs.size() back to original).
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

- [ ] **Step 2: Topology linkage + soundness proofs**

```ts
it('vertex edit on the uncut shared span after reshape moves both features', async () => {
  // adjacent polygons sharing an edge; reshape f0 across the shared edge;
  // then move a vertex on the remaining shared span via VertexMoveCommand;
  // assert BOTH features' geometry changed and they still reference the same
  // arc id for that span.
});

it('a cutter geometrically crossing an UNRELATED arc leaves it and its features untouched', () => {
  // selected polyline split; the cutter line also crosses a detached,
  // unselected polyline whose arcs are NOT candidate-referenced.
  // assert: the unrelated feature's shape references the SAME arc ids after
  // the split (legacy would have re-noded them — documented deviation ①);
  // its coordinates are byte-identical.
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
it('discarded cutter pieces never reach the live arc table', () => {
  // polyline-cutter split: appended arc count == referenced new arcs only.
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
- **Type consistency:** `MiniDataset.miniToLiveArc` / `candidates` / `referencers` / `sentinelLayerIndex` (Task 1) consumed verbatim in Task 2; `MiniTranslation` (`appendedArcs`, `shapePatches`, `miniToLiveFinal` with holes), `extraShapes`, and `translateShapeFromMini` defined in Task 2 and consumed in Tasks 3/7; `planSplitPieces` field names used identically in the Task 7 orchestrator code; `RunPreparedEditCommandMany` (Task 5) matches its `_context.ts` type.
- **Lineage mechanism (final):** spike-verified for both cutting paths plus dedup convergence and dedup keep-choice (header facts). Reuse is exact because it is restricted to positive singleton lineages with a unique owner and forward-identical coordinates; every appended arc stores mini coordinates forward, so unsigned mapping + sign preservation is exact everywhere; multi-owner post arcs append once and converge (legacy merge parity); neighbor linkage comes from lineage splice over the build-time referencers index, never from remap side effects on mini shapes; uncopied arcs are constructively unmodifiable; split's planned piece shapes reach the translator via `extraShapes` so cutter-derived boundary arcs are mapped exactly once.
- **Known calibration points (flagged for implementers):** Task 2 contract fixtures assert exact ids derived from the 2026-08-30 spikes — re-derive from an actual run if a fixture detail shifts; Task 9 Step 5 is an explicit check-or-fix gate.
