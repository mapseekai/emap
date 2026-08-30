# Direct Geometry Edit Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `reshapeSelected` and `splitSelected` from whole-dataset replacement (`insertCutPoints` on a `copyDataset` working copy + `DatasetReplaceSelectionCommand` barrier) to in-place reversible commands, unlocking stable multi-level undo/redo with topology linkage preserved.

**Architecture:** Spec: `DIRECT_GEOMETRY_EDIT_PHASE_B_DESIGN.md` (commit `fa10219`). Legacy geometry functions run **unchanged** on a bounded mini dataset (candidate features + features sharing their arcs, full-arc copies, live-aligned sparse `shapes` arrays); a translator maps mini results back to live instructions using per-slot provenance (`miniArcId → liveArcId` recorded at copy time; a mini arc that still equals its source copy keeps the live id, everything else appends deterministically in mini-id order). Reshape commits one `PathGeometryPatchCommand` per source wrapped in a `CompositeCommand` (single history entry); split commits a new `SplitFeaturesCommand` (shape patches + appended arcs + appended features + selection). Planners are read-only against LIVE data; commands do/undo via append/truncate only.

**Tech Stack:** TypeScript, Vitest (`pnpm exec vitest run <file>`), mapshaper data structures, Phase A infrastructure (`PathGeometryPatchCommand`, `appendArcsCompat`/`truncateArcsCompat`, `_runPreparedEditCommand`).

## Global Constraints

- NEVER import `mapshaper` outside `src/adapter/mapshaper-adapter.ts` (AGENTS.md hard rule). New `createArcCollection` lives in the adapter.
- Legacy geometry functions (`reshape-selected-line.ts`, `reshape-selected-polygon.ts`, `split-selected-line.ts`, `split-selected-polygon.ts`) are NOT modified — they run on the mini dataset. All migration logic lives in the orchestrators and the two new `_mini-*` modules.
- Planners MUST be synchronous, pure read-only on LIVE datasets; all mutation happens inside `command.do()` (mini dataset mutation is fine — it is planner-owned scratch).
- NEVER byte-match a scratch arc against arbitrary live arcs to infer identity; provenance comes only from the build-time `miniToLiveArc` slot mapping (per-slot coordinate equality against its own source).
- No `cleanArcReferences` on the live path; orphan arcs are expected (export compacts a copy).
- `invalidatesPriorCommands` stays absent on the new commands — no history barrier.
- Commands clone shape snapshots at construction (PathGeometryPatchCommand precedent).
- Tests: `pnpm exec vitest run <file>`; type gate: `pnpm typecheck`. Commit after every task with conventional-commit messages. Run gates with bare `pnpm`/`pnpm exec`, NOT `rtk pnpm` (rtk shim resolves global tsc 7.0.2 — false failures).
- Feature refs use canonical layer ids via `getLayerId(layer, index)` (`src/source/layer-utils.ts`).

---

### Task 1: Adapter `createArcCollection` + mini-dataset builder

**Files:**
- Modify: `src/adapter/mapshaper-adapter.ts` (interface near `appendArcs` ~line 206; implementation near `appendArcs` impl ~line 703)
- Create: `src/map/ops/_mini-dataset.ts`
- Test: `src/map/ops/_mini-dataset.test.ts` (create)
- Reference: `src/adapter/mapshaper-adapter-arcs.test.ts:153-157` (real `mapshaper.internal.ArcCollection` construction precedent), `src/map/ops/reshape-selected-line.ts:39-62` (arc coordinate reading via `getArcIter`)

**Interfaces:**
- Produces (Tasks 3,4,7,8 consume):
```ts
// src/adapter/mapshaper-adapter.ts — on MapshaperAdapter
/** Create a standalone ArcCollection holding the supplied arcs (ids 0..n-1). */
createArcCollection(arcsToAppend: AppendedArc[]): ArcCollection;

// src/map/ops/_mini-dataset.ts
export interface MiniDataset {
  /** Scratch dataset: mini arcs + layers array aligned with live indexes. */
  dataset: MapshaperDataset;
  /** Same object as dataset.arcs — convenience. */
  arcs: ArcCollection;
  /** miniArcId → liveArcId for every arc present at build time (provenance). */
  miniToLiveArc: readonly number[];
  /** layerIndex → featureIds present in mini (candidates ∪ arc sharers). */
  included: ReadonlyMap<number, ReadonlySet<number>>;
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
  // Two squares sharing arc 1 (the common edge); a detached third square.
  // f0: [[0,1]] (outer ring = arcs 0,1 forward), f1: [[-2,1]] sharing arc 1 reversed.
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
      candidates: new Map([[0, new Set([2])]]), // only the detached square
      adapter,
    });
    // feature 2 references live arc 0 → mini arc 0
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
      candidates: new Map([[0, new Set([0])]]), // f0 references arcs 0,1
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

Implementation (next to `appendArcs`, reusing its concatenation logic; if appendArcs has a private concat helper, share it):

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

Note: `appendArcs` on an empty collection must still work (it already concatenates onto existing arrays; empty start is the degenerate case — cover it in the test above via `mini.arcs` contents assertions).

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

  // 1. Expand candidates: any feature sharing an arc with a candidate joins.
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

  return {
    dataset: { ...dataset, arcs, layers },
    arcs,
    miniToLiveArc: sorted,
    included,
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm exec vitest run src/map/ops/_mini-dataset.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/adapter/mapshaper-adapter.ts src/map/ops/_mini-dataset.ts src/map/ops/_mini-dataset.test.ts
git commit -m "feat(ops): mini-dataset builder with provenance arc copies"
```

---

### Task 2: Result translator `_mini-translate.ts`

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
  /** liveArcId → ordered appended live ids of its pieces (only for divided arcs). */
  piecesByLiveArc: ReadonlyMap<number, readonly number[]>;
}
/** Returns null when any mini arc id referenced by an included shape is unmappable. */
export function translateMiniDataset(opts: {
  mini: MiniDataset;       // AFTER the legacy geometry function ran on it
  liveDataset: MapshaperDataset;
  liveArcCount: number;    // live arcs.size() captured at plan start
  liveLayers: readonly MapshaperLayer[]; // live layers (for patch layer refs)
}): MiniTranslation | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/map/ops/_mini-translate.test.ts
import { describe, expect, it } from 'vitest';
import mapshaper from 'mapshaper';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { buildMiniDataset } from './_mini-dataset';
import { translateMiniDataset } from './_mini-translate';

// One shared edge scenario: f0 = [[0,1]], f1 = [[-2,1]] (both included).
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
    expect(translation!.piecesByLiveArc.size).toBe(0);
  });

  it('appends a mini-only arc and rewrites the referencing shape', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Simulate a legacy reshape outcome: append one replacement arc (mini id 3)
    // and point feature 0's shape at it.
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
    // Patch references the live append id (4) and keeps untouched live arc 1.
    expect(translation!.shapePatches).toEqual([
      {
        layer: live.layers[0],
        featureId: 0,
        before: [[0, 1]],
        after: [[4, 1]],
      },
    ]);
  });

  it('treats a divided provenance slot as appended pieces and records piecesByLiveArc', () => {
    const live = liveDataset();
    const mini = buildMiniDataset({
      dataset: live,
      candidates: new Map([[0, new Set([0])]]),
      adapter,
    });
    // Divide mini arc 1 (live arc 1) at its midpoint via the real machinery.
    adapter.insertCutPoints(mini.dataset, [{ x: 1.5, y: 0, i: 2 }]); // flat vertex idx of arc1 vertex0
    const translation = translateMiniDataset({
      mini,
      liveDataset: live,
      liveArcCount: live.arcs!.size(),
      liveLayers: live.layers,
    });
    expect(translation).not.toBeNull();
    // live arc 1 divided into 2 pieces → both appended; arcs 0,2,3 keep live ids.
    const pieces = translation!.piecesByLiveArc.get(1);
    expect(pieces).toHaveLength(2);
    // Mini shapes were remapped by insertCutPoints; translated patches use piece ids.
        const f0 = translation!.shapePatches.find((p) => p.featureId === 0);
    const f1 = translation!.shapePatches.find((p) => p.featureId === 1);
    expect(f0?.after).toEqual([[0, pieces![0], pieces![1]]]);
    expect(f1?.after).toEqual([[-pieces![0]! - 1, pieces![1]!]]);
  });
});
```

(Implementation note for the third test: the exact flat vertex index passed to `insertCutPoints` must reference a vertex of mini arc 1; adjust the fixture index so the cut lands inside arc 1 — verify with the real run. If `insertCutPoints` requires the point to lie on the segment, use the arc's actual first-segment midpoint.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/_mini-translate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the translator**

```ts
// src/map/ops/_mini-translate.ts
import type { AppendedArc } from '../../adapter/mapshaper-adapter';
import type {
  ArcCollection,
  MapshaperLayer,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import type { PathShapePatch } from '../../edit/commands/path-geometry-patch';
import { snapshotLiveArc, type MiniDataset } from './_mini-dataset';

export interface MiniTranslation {
  appendedArcs: AppendedArc[];
  shapePatches: PathShapePatch[];
  piecesByLiveArc: ReadonlyMap<number, readonly number[]>;
}

function unsigned(id: number): number {
  return id < 0 ? -id - 1 : id;
}

function snapshotMiniArc(arcs: ArcCollection, arcId: number): AppendedArc {
  return snapshotLiveArc(arcs, arcId); // same coordinate-slice mechanics
}

function arcsEqual(a: AppendedArc, b: AppendedArc): boolean {
  if (a.xx.length !== b.xx.length) return false;
  for (let i = 0; i < a.xx.length; i++) {
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
}): MiniTranslation | null {
  const { mini, liveDataset, liveArcCount, liveLayers } = opts;
  const liveArcs = liveDataset.arcs!;

  // 1. Arc mapping, ascending mini id → deterministic append order.
  const finalLiveId: number[] = new Array(mini.arcs.size());
  const appendedArcs: AppendedArc[] = [];
  const appendedFromSlot: number[] = []; // appended live id, indexed by mini slot
  const piecesByLiveArc = new Map<number, number[]>();
  for (let j = 0; j < mini.arcs.size(); j++) {
    const provenanceLive = j < mini.miniToLiveArc.length ? mini.miniToLiveArc[j]! : -1;
    const miniCoords = snapshotMiniArc(mini.arcs, j);
    if (
      provenanceLive >= 0 &&
      arcsEqual(miniCoords, snapshotLiveArc(liveArcs, provenanceLive))
    ) {
      finalLiveId[j] = provenanceLive;
      continue;
    }
    const liveId = liveArcCount + appendedArcs.length;
    finalLiveId[j] = liveId;
    appendedArcs.push(miniCoords);
    appendedFromSlot.push(liveId);
    if (provenanceLive >= 0) {
      let pieces = piecesByLiveArc.get(provenanceLive);
      if (!pieces) piecesByLiveArc.set(provenanceLive, (pieces = []));
      pieces.push(liveId);
    }
  }

  // 2. Translate + diff every included shape.
  const shapePatches: PathShapePatch[] = [];
  for (const [layerIndex, featureIds] of mini.included) {
    const liveLayer = liveLayers[layerIndex] as PathLayer;
    const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
    for (const featureId of featureIds) {
      const before = liveLayer.shapes?.[featureId] as PathShape | null;
      const miniShape = miniLayer.shapes?.[featureId] as PathShape | null;
      if (!before || !miniShape) continue;
      const after: PathShape = [];
      let unmappable = false;
      for (const part of miniShape) {
        const translated: number[] = [];
        for (const ref of part) {
          const mapped = finalLiveId[unsigned(ref)];
          if (mapped === undefined) {
            unmappable = true;
            break;
          }
          translated.push(ref < 0 ? -mapped - 1 : mapped);
        }
        if (unmappable) break;
        after.push(translated);
      }
      if (unmappable) return null;
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
  return { appendedArcs, shapePatches, piecesByLiveArc };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run src/map/ops/_mini-translate.test.ts`
Expected: PASS. Iterate on the third fixture until the cut genuinely divides mini arc 1 (assert `mini.arcs.size()` grew by 1 post-`insertCutPoints` before translating).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/_mini-translate.ts src/map/ops/_mini-translate.test.ts
git commit -m "feat(ops): mini result translator with per-slot provenance"
```

---

### Task 3: Reshape polyline path migration

**Files:**
- Modify: `src/map/ops/reshape-selected.ts` (polyline branch of the per-source callback)
- Create: `src/map/ops/_reshape-plan.ts` (per-source planner shared by line/polygon tasks)
- Test: `src/map/ops/reshape-selected-line.test.ts` (must pass UNCHANGED — geometric equivalence), `src/map/ops/_reshape-plan.test.ts` (create)
- Consumes: `buildMiniDataset`/`translateMiniDataset` (Tasks 1-2); `reshapeSelectedPolylines` (unchanged); `RunPreparedEditCommand` (Phase A)

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
// Reuse the dataset fixtures from reshape-selected-line.test.ts (two adjacent
// squares sharing an edge, one polyline) — import or re-declare per that file.

describe('planReshapeSource', () => {
  it('plans a polyline reshape with appended replacement arc and no live mutation', () => {
    // given a live dataset with one polyline feature and a drawn line crossing it twice
    const { source, dataset } = makePolylineSource(); // fixture helper, see below
    const plan = planReshapeSource({
      source, sourceId: 's', dataset, line: DRAWN_LINE,
      adapter: getDefaultMapshaperAdapter(),
      selection: EMPTY_SELECTION, publishSelection: () => {},
    });
    expect(plan).not.toBeNull();
    expect(plan).not.toBe('invalid');
    if (plan === null || plan === 'invalid') return;
    expect(plan.reshapedCount).toBe(1);
    // Planning is read-only: live arcs/shapes untouched.
    expect(dataset.arcs!.size()).toBe(ORIGINAL_ARC_COUNT);
    // Command applies cleanly and undoes exactly.
    plan.command.do();
    expect(dataset.arcs!.size()).toBe(ORIGINAL_ARC_COUNT + APPENDED);
    plan.command.undo();
    expect(dataset.arcs!.size()).toBe(ORIGINAL_ARC_COUNT);
    expect(liveShapeCoords()).toEqual(ORIGINAL_COORDS);
  });

  it('patches a non-candidate neighbor sharing a cut arc (topology linkage)', () => {
    // two polygons sharing an edge; the drawn line contacts only f0
    // expect: shapePatches contains f1 with its shared span rewritten to piece ids,
    // and the uncut shared span keeps ONE arc id referenced by BOTH features.
  });

  it('returns null when the line contacts nothing', () => { /* ... */ });
});
```

Fixture helpers: build real datasets via `mapshaper.internal.ArcCollection` + `PathLayer` as in `_mini-dataset.test.ts`; wrap in a minimal `MutableTopologySource` stub (mirror `src/map/ops/_test-helpers.ts` — check that file's existing source stub and reuse it).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/_reshape-plan.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the planner**

```ts
// src/map/ops/_reshape-plan.ts
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { PathGeometryPatchCommand } from '../../edit/commands/path-geometry-patch';
import type { MutableTopologySource } from '../../source/source';
import { getLayerId } from '../../source/layer-utils';
import type { Selection, SelectionDiff } from '../selection';
import type { ArcCollection, MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { Err } from '../op-result';
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
  const bb = data.bb; // per-arc [xmin, ymin, xmax, ymax]
  for (const part of shape) {
    for (const ref of part) {
      const arcId = ref < 0 ? -ref - 1 : ref;
      if (bb) {
        const x0 = bb[arcId * 4]!, y0 = bb[arcId * 4 + 1]!, x1 = bb[arcId * 4 + 2]!, y1 = bb[arcId * 4 + 3]!;
        if (x1 >= bounds.minX && x0 <= bounds.maxX && y1 >= bounds.minY && y0 <= bounds.maxY) return true;
        continue;
      }
      // Fallback: scan vertices.
      const start = data.ii[arcId]!, end = start + data.nn[arcId]!;
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
  const { source, sourceId, dataset, adapter, selection, publishSelection } = opts;
  const line = normalizeConsecutiveCoordinates(opts.line);
  const arcs = dataset.arcs;
  if (!arcs) return null;
  const bounds = reshapeLineBounds(line);

  // 1. Candidates per path layer (bbox prefilter). Polyline layers: replicate
  //    legacy validation (invalid features are skipped, not fatal).
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
          validatePolylineFeatureShape(shape, arcs); // extracted copy of reshape-selected.ts's validator, operating on a shape
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
  const targetCountBefore = 0; // counted below from geometry results
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

`validatePolylineFeatureShape`: extract the per-shape body of `validatePolylineFeature` in `reshape-selected.ts:34-60` into an exported helper (either in `_reshape-plan.ts` or `geometry-2d.ts`); the legacy wrapper keeps calling it — no behavior change. (This is the ONLY allowed modification to legacy files in this task; it is a pure extraction.)

- [ ] **Step 4: Run planner tests + existing polyline reshape tests**

Run: `pnpm exec vitest run src/map/ops/_reshape-plan.test.ts src/map/ops/reshape-selected-line.test.ts`
Expected: planner tests PASS; `reshape-selected-line.test.ts` PASSES UNCHANGED (it tests the geometry function directly, which is unmodified).

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/_reshape-plan.ts src/map/ops/_reshape-plan.test.ts src/map/ops/reshape-selected.ts
git commit -m "feat(ops): per-source reshape planner on mini dataset"
```

---

### Task 4: Reshape orchestrator migration (single-source path first)

**Files:**
- Modify: `src/map/ops/reshape-selected.ts:70-163` (replace `runPreparedDatasetMutation` callback with direct-runner dispatch)
- Test: `src/map/ops/reshape-selected.test.ts` (behavioral — must pass with the new path; undo assertions now exercise multi-level undo instead of barrier)
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

The existing test at `reshape-selected.test.ts` (attributes/selection/undo, stale prepared dataset) currently asserts barrier behavior (`invalidatesPriorCommands` clearing prior history). Update the undo-related cases to the new contract:
- `reshape → reshape → undo → undo` now restores BOTH edits (multi-level), not "only the last one";
- geometry after each undo matches the pre-op state exactly;
- `dataset.arcs.size()` returns to its original value after the final undo;
- remove any assertion on `DatasetReplaceSelectionCommand` for reshape; assert `historychange` fires once per op;
- the stale-prepared-dataset case keeps working via the runner's editVersion guard (rename the test to reflect the direct-runner guard).

Polygon line/polygon geometry tests (`reshape-selected-polygon.test.ts`, `reshape-selected-line.test.ts`) MUST pass unmodified.

- [ ] **Step 3: Run the full reshape test set**

Run: `pnpm exec vitest run src/map/ops/reshape-selected.test.ts src/map/ops/reshape-selected-line.test.ts src/map/ops/reshape-selected-polygon.test.ts src/core/handlers/reshape-feature.test.ts`
Expected: PASS. Any geometric regression means the mini translation is wrong — fix the translator/planner, NOT the legacy geometry files.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/reshape-selected.ts src/map/ops/reshape-selected.test.ts
git commit -m "feat(ops): migrate reshapeSelected to direct patch commands"
```

---

### Task 5: Multi-source single-entry runner + reshape composite

**Files:**
- Modify: `src/map/ops/_runner.ts` (add `_runPreparedEditCommandMany` beside `_runPreparedEditCommand` at line 319)
- Modify: `src/map/ops/_context.ts` (add `RunPreparedEditCommandMany` type + `OpContext` field)
- Modify: `src/map/mapshaper-ops.ts` (wire the new runner into `OpContext`)
- Modify: `src/map/ops/reshape-selected.ts` (replace the per-source loop with one multi-source call)
- Test: `src/map/ops/reshape-selected.test.ts` (multi-source single-entry case)
- Reference: `enqueueSourceOperation` at `_runner.ts:174-197` (per-source promise-gate queues)

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

- [ ] **Step 3: Implement `_runPreparedEditCommandMany`**

```ts
// src/map/ops/_runner.ts — beside _runPreparedEditCommand
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
        : new CompositeCommand(
            planned.map((p) => p.edit.command),
            label,
          );
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

  // Chain onto EVERY involved source queue so ops on any of them serialize
  // (see the enqueueMultiSourceOperation helper below, refactored out of
  // enqueueSourceOperation at _runner.ts:174-197).
  return enqueueMultiSourceOperation(host, [...new Set(sourceIds)], run);
}
```

Implementation detail (do it, don't delegate the decision): refactor `enqueueSourceOperation` to expose

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
  const previous = sourceIds.map((id) => queues!.get(id) ?? Promise.resolve());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  for (const id of sourceIds) queues.set(id, gate);
  return Promise.all(previous.map((p) => p.catch(() => undefined)))
    .then(run)
    .finally(() => {
      release();
      for (const id of sourceIds) if (queues!.get(id) === gate) queues!.delete(id);
    });
}
```

and re-implement `enqueueSourceOperation` as the single-id delegation (`return enqueueMultiSourceOperation(host, [sourceId], run)`).

- [ ] **Step 4: Switch the orchestrator to one multi-source call**

In `reshape-selected.ts`, replace the `for (const [sourceId, source] of ctx.host._sources)` loop with:

```ts
  const sourceIds = [...ctx.host._sources.keys()].filter((id) => {
    const dataset = ctx.host._sources.get(id)?.getDataset();
    return !!dataset?.arcs;
  });
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
- Reference: `src/edit/commands/path-geometry-patch.ts:62-125` (mirror structure/publish/assertions), `src/edit/commands/feature-delete.ts` (record-array handling for feature add/remove — mirror its data-table access)

**Interfaces:**
- Produces (Tasks 7-8 consume):
```ts
export interface SplitFeaturesCommandOptions {
  source: TopologySource;
  /** Neighbor (sharer) patches + split targets' largest-piece after shapes. */
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
    // layer with 2 features; command patches f0's shape and appends one feature
    // expect shapes.length 2 → 3, records cloned (new object, same content),
    // arcs.size grows by appendedArcs.length, selection === afterSelection
  });

  it('undo restores shapes, records, arcs and selection exactly', () => {
    // after undo: shapes.length === originalFeatureCount, f0 shape identity
    // restored (deep-equal original), records array truncated, arcs.size()
    // back to originalArcCount, selection === beforeSelection refs
  });

  it('redo reproduces identical arc ids and feature contents', () => {
    // do → undo → do; compare full shape table + arc vertex data after redo
    // to the state after the first do (arc ids stable).
  });

  it('asserts when the arc count drifted before redo', () => {
    // do → undo → externally append an arc → redo must throw (bypass guard)
  });
});
```

Fixtures: mock `ArcCollection` from `feature-create.test.ts:7-28`; layer stub with `data.getRecords()` array; selection stub mirroring `path-geometry-patch.test.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/edit/commands/split-features.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the command**

```ts
// src/edit/commands/split-features.ts
import type { EditCommand } from '../edit-command';
import type { MapshaperLayer, PathLayer, PathShape } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';
import {
  getDefaultMapshaperAdapter,
  type AppendedArc,
  type MapshaperAdapter,
} from '../../adapter/mapshaper-adapter';
import {
  appendArcsCompat,
  markSourceChanged,
  truncateArcsCompat,
} from './_shared';
import type { PathShapePatch } from './path-geometry-patch';

export interface SplitFeaturesCommandOptions { /* …exactly the interface above… */ }

export class SplitFeaturesCommand implements EditCommand {
  readonly label: string;
  private readonly adapter: MapshaperAdapter;

  constructor(private readonly opts: SplitFeaturesCommandOptions) {
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
    if (arcs.size() !== opts.originalArcCount)
      throw new Error('SplitFeaturesCommand: arc collection drifted');
    appendArcsCompat(this.adapter, arcs, opts.appendedArcs);
    for (const patch of opts.shapePatches) {
      (patch.layer as PathLayer).shapes![patch.featureId] = patch.after.map((part) =>
        part.slice(),
      );
    }
    const layer = opts.layer as PathLayer;
    layer.shapes!.push(...opts.appendedShapes.map((shape) => shape.map((part) => part.slice())));
    const records = layer.data?.getRecords?.();
    if (records) records.push(...opts.appendedRecords.map((r) => (r === null ? null : { ...r })));
    opts.selection.apply(opts.afterSelection, 'replace');
    markSourceChanged(opts.source);
  }

  undo(): void {
    const { opts } = this;
    const arcs = opts.source.getDataset()?.arcs;
    if (!arcs) throw new Error('SplitFeaturesCommand: source has no arcs');
    opts.selection.apply(opts.beforeSelection.refs, 'replace'); // match PathGeometryPatchCommand's restore semantics exactly
    const layer = opts.layer as PathLayer;
    layer.shapes!.length = opts.originalFeatureCount;
    const records = layer.data?.getRecords?.();
    if (records) records.length = opts.originalFeatureCount;
    for (const patch of opts.shapePatches) {
      (patch.layer as PathLayer).shapes![patch.featureId] = patch.before.map((part) =>
        part.slice(),
      );
    }
    truncateArcsCompat(this.adapter, arcs, opts.originalArcCount);
    markSourceChanged(opts.source);
  }

  publish(): void {
    // Mirror PathGeometryPatchCommand.publish exactly: fire source 'data'
    // with reason 'edit', then the selection diff (if any).
  }
}
```

Implementation checkpoints while writing the real bodies:
- Copy `PathGeometryPatchCommand`'s exact selection restore + publish code (read the full file first; the plan's sketch is structural, not verbatim).
- Mirror `FeatureDeleteCommand`'s data-table access pattern for records (it already splices records safely).
- `markSourceChanged` handles `markDisplayArcsDirty` + `bumpEditVersion` (`_shared.ts`).

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
- Modify: `src/map/ops/split-selected-geometry.ts` (replace `applySplitPieces` with a pure planner variant)
- Modify: `src/map/ops/split-selected.ts:128-192` (dispatch via `runPreparedEditCommand`)
- Test: `src/map/ops/split-selected-line.test.ts`, `src/map/ops/split-selected.test.ts` (must pass with updated undo expectations), `src/map/ops/split-selected.integration.test.ts`
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
// src/map/ops/split-selected-geometry.test.ts (extend existing if present, else create)
describe('planSplitPieces', () => {
  it('keeps the largest piece at the original id and appends the rest in order', () => {
    // two-piece split of f0 (areas 10 and 4): f0 after = area-10 piece;
    // appendedShapes = [area-4 piece]; resultFeatures = [f0, appended id];
    // appendedRecordSource = [0]
  });
  it('preserves unsplit selected ids in resultFeatures', () => { /* ... */ });
  it('clones records: appended record content equals source, object identity differs', () => { /* ... */ });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/map/ops/split-selected-geometry.test.ts -t planSplitPieces`
Expected: FAIL — `planSplitPieces` does not exist.

- [ ] **Step 3: Implement `planSplitPieces`**

Port the ordering/materialization logic from `applySplitPieces` (`split-selected-geometry.ts:42-90`) into the pure planner: same largest-piece sort (`adapter.getShapeArea`/`getShapePerimeter` on the MINI arcs), same append order, same resultFeatures construction. Differences from the legacy body:
- no `shapes`/`records` mutation (return data instead);
- no temporary-layer splicing (temp layers die with the mini);
- NO `cleanArcReferences`;
- record cloning is deferred to the orchestrator (the plan carries `appendedRecordSource` feature ids; the orchestrator reads live records and builds `appendedRecords`).

Delete `applySplitPieces` after the orchestrator switches (clean cutover — it has no other callers; verify with `lsp references` before deleting).

- [ ] **Step 4: Switch the orchestrator**

Replace the `runPreparedDatasetMutation` callback in `split-selected.ts` with:

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
        validateSelectedPolylines(liveLayer, selectedIds, arcs);
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

      // Assemble command data. The translator already produced patches for
      // sharers; add split-target patches (largest piece) and appended features,
      // translating mini ids → live ids via a shape translator exposed from
      // _mini-translate (export translateShapeFromMini(translation, shape)).
      const targetPatches = plan.targetAfterShapes.map(({ featureId, shape }) => ({
        layer: liveLayer,
        featureId,
        before: (liveLayer.shapes![featureId] as PathShape).map((part) => part.slice()),
        after: translateShapeFromMini(translation, shape),
      }));
      const liveRecords = (liveLayer as PathLayer).data?.getRecords?.();
      const appendedRecords = plan.appendedRecordSource.map((sourceFeatureId) =>
        liveRecords ? { ...(liveRecords[sourceFeatureId] ?? {}) } : null,
      );
      const command = new SplitFeaturesCommand({
        source: mutableSource,
        shapePatches: [...translation.shapePatches, ...targetPatches],
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

Translation overlap check (do this while implementing): `translation.shapePatches` may already include a split target if the target's shape changed inside the mini via remap; the target's FINAL after shape must be the largest piece, so merge by featureId — target patches win. Implement the merge explicitly:

```ts
const patchByFeature = new Map<number, PathShapePatch>();
for (const p of translation.shapePatches) patchByFeature.set(p.featureId, p);
for (const p of targetPatches) patchByFeature.set(p.featureId, p); // target wins
const shapePatches = [...patchByFeature.values()];
```

Also export from `_mini-translate.ts` (add in this task, with a unit test):

```ts
export function translateShapeFromMini(translation: MiniTranslation, shape: PathShape): PathShape;
```

(Store the `finalLiveId` map on `MiniTranslation` — add field `miniToLiveFinal: readonly number[]` to the Task 2 interface and populate it in the translator.)

- [ ] **Step 5: Update undo expectations in split tests**

`split-selected.integration.test.ts` currently pins barrier semantics for undo after split. Update to multi-level expectations:
- split → split → undo → undo restores both;
- feature count/records/selection restored exactly after undo;
- `arcs.size()` returns to the original value after undo (orphan arcs are truncated with the command; note the arcs appended by the split itself are removed on undo);
- the transaction undo-selection case keeps passing.

- [ ] **Step 6: Run the full split test set**

Run: `pnpm exec vitest run src/map/ops/split-selected.test.ts src/map/ops/split-selected-line.test.ts src/map/ops/split-selected.integration.test.ts src/map/ops/split-selected-geometry.test.ts src/core/handlers/split-feature.test.ts`
Expected: PASS. Geometric failures ⇒ fix planner/translator, never the legacy geometry files.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add src/map/ops/split-selected.ts src/map/ops/split-selected-geometry.ts src/map/ops/_mini-translate.ts src/map/ops/split-selected.integration.test.ts
git commit -m "feat(ops): migrate splitSelected polylines to SplitFeaturesCommand"
```

---

### Task 8: Split polygon migration

**Files:**
- Modify: `src/map/ops/split-selected.ts` (polygon branch — already routed in Task 7; this task validates and fixes the polygon-specific path)
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
  // two adjacent polygons; split one with a polyline cutter
  // after do: target has largest piece + appended feature; neighbor shares the
  // uncut boundary arc id with both pieces' boundary where untouched
  // after undo: exact original shapes/arc count/records
});

it('area conservation check still rejects invalid mosaic output on the mini path', () => {
  // reuse an existing rejection fixture from split-selected-polygon.test.ts
  // routed through the op facade (not the geometry function directly)
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

### Task 9: Integration hardening, docs, example verification

**Files:**
- Test: `src/map/ops/reshape-selected.test.ts`, `src/map/ops/split-selected.integration.test.ts` (append integration cases)
- Modify: `CHANGELOG.md` (add Phase B entry)
- Modify: `packages/docs/docs/guides/editing.md` + `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md` (undo/redo behavior notes for reshape/split)
- Verify: `packages/examples/examples/reshape-ring-part/index.html` manual run

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
  // then move a vertex on the remaining shared span via the vertex-edit command
  // path (VertexMoveCommand or the handler); assert BOTH features' geometry
  // changed and they still reference the same arc id for that span.
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
it('no cleanArcReferences on the split path (deleted arcs stay referenced by history)', () => {
  // spy on adapter.cleanArcReferences during splitSelected → not called
});
```

- [ ] **Step 5: FeatureQuery/Flatbush invalidation on feature append**

Check the runner's publish path: `source.fire('data', { reason: 'edit' })` → map `_handleSourceData` invalidates shape caches. Verify the FeatureQuery Flatbush index for the target layer is dropped/rebuilt after a split (read `src/map/map.ts` data handler + feature-query cache code). If appends are not covered (Phase A covered deletes), add the invalidation and a test: query a feature added by split immediately after the op returns.

- [ ] **Step 6: Full suite + typecheck**

Run: `pnpm exec vitest run` and `pnpm typecheck`
Expected: full suite PASS (all pre-existing tests unchanged in behavior, updated only where barrier semantics were pinned), 0 type errors.

- [ ] **Step 7: Example + docs + CHANGELOG**

- Manual: serve `packages/examples/examples/reshape-ring-part/index.html`, perform 3 consecutive reshape ops and 3 split ops, undo/redo step-by-step; confirm geometry, selection and attributes restore at each level.
- `editing.md` (both locales): reshape/split are now incremental, multi-level undoable edits; orphan-arc note (exports compact a copy).
- `CHANGELOG.md`: Phase B entry under Unreleased.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test(ops): phase B integration hardening + docs"
```

---

## Self-Review Notes (completed by the author)

- **Spec coverage:** §3.1→Task 1, §3.2→Task 2 (+`translateShapeFromMini`/`miniToLiveFinal` addition in Task 7), §3.3→Task 6, §4.1→Tasks 3-5, §4.2→Task 7, §4.3→Task 8, §4.4→Task 7 Step 3 (no cleanArcReferences) + Task 9 Step 4, §5→Task 5 (runner) + Task 9 Step 5, §6→per-task test steps + Task 9.
- **Type consistency:** `MiniDataset.miniToLiveArc` / `included` (Task 1) consumed verbatim in Task 2; `MiniTranslation` extended once in Task 7 (`miniToLiveFinal`, `translateShapeFromMini`) — Task 2's interface note flags the addition point so the fields exist before Task 7 uses them. `planSplitPieces` field names (`targetAfterShapes`, `appendedShapes`, `appendedRecordSource`, `resultFeatures`, `splitTargetCount`) used identically in the orchestrator code.
- **Known soft spot (flagged for implementers):** the Task 2 third fixture's flat vertex index for `insertCutPoints` must be calibrated against the real fixture; the test asserts the cut landed before proceeding. Task 9 Step 5 is an explicit check-or-fix gate.
