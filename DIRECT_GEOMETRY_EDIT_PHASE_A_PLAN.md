# Direct Geometry Edit Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `addRing` / `deleteRing` / `addPart` / `deletePart` from whole-dataset replacement to in-place reversible commands so ring/part edits support stable multi-level undo/redo without `copyDataset()` / `cleanArcReferences()` per operation.

**Architecture:** Spec: `DIRECT_GEOMETRY_EDIT_DESIGN.md` (commit `ae33041`, §0 verified revision). New `PathGeometryPatchCommand` (shape patch + batch arc append/truncate + selection snapshot) and `FeatureDeleteWithSelectionCommand` (last-part deletion) are committed through a new `_runPreparedEditCommand` runner that lives in `src/map/ops/_runner.ts` beside the existing dataset-replace runners. Planners are pure read-only passes over the LIVE dataset that return `{ value, command, affectedSourceIds }`; the runner owns all side effects (history push, publish, historychange). Batch arc APIs move into `MapshaperAdapter` and `SplitSharedArcsCommand` reverse-consumes them.

**Tech Stack:** TypeScript, Vitest (`pnpm exec vitest run <file>`), mapshaper data structures (ArcCollection `getVertexData`/`updateVertexData`), existing `EditCommand` / `EditHistory` / `Transaction` infrastructure.

**Naming deviation from spec (approved implicitly by existing public API):** the spec sketch calls the arc snapshot type `AppendedArcSnapshot`; the codebase already publicly exports the identical shape as `AppendedArc` (`src/index.ts:367`, consumed by `split-shared-arcs.ts`, `split-shared-node.ts`, `vertex-delete.ts`). This plan keeps the existing public name `AppendedArc` and moves its declaration to the adapter — no second name is introduced.

## Global Constraints

- NEVER import `mapshaper` directly outside `src/adapter/mapshaper-adapter.ts` (AGENTS.md hard rule).
- New runner MUST reuse the module-private `enqueueSourceOperation` + stale-guard skeleton in `_runner.ts`; no second queue/convention.
- Planners MUST be synchronous and pure read-only: no mutation of live dataset before `command.do()`.
- `EditCommand.publish` is a duck-typed convention (`'publish' in command` check), not part of the interface — keep it that way.
- `source.fire('data', { reason: 'edit' })` triggers map `_handleSourceData`, which already does `_invalidateShapeCachesForSources` + `_scheduleRender` + map-level re-fire. The runner MUST NOT repeat those side effects.
- The `'edit'` reason already exists in `EmapEventMap` (`src/core/event-map.ts:62`); `draw-feature.ts:402` already fires it. Precedent, not new surface.
- Commands clone shape snapshots at construction; callers may reuse their arrays after.
- Tests: `pnpm exec vitest run <file>`; type gate: `pnpm typecheck`. Commit after every task with conventional-commit messages.
- Feature refs use canonical layer ids via `getLayerId(layer, index)` (`src/source/layer-utils.ts`).

---

### Task 1: Adapter batch arc APIs (`appendArcs` / `truncateArcs`)

**Files:**
- Modify: `src/adapter/mapshaper-adapter.ts` (interface near line 185, implementation after `appendArc` at line ~691)
- Test: `src/adapter/mapshaper-adapter-arcs.test.ts` (create)
- Move: `AppendedArc` interface from `src/edit/commands/split-shared-arcs.ts:28` into `src/adapter/mapshaper-adapter.ts`; `split-shared-arcs.ts` re-exports it for public back-compat (one documented line — `src/index.ts:367` re-exports from split-shared-arcs and must keep working).

**Interfaces:**
- Produces (every later task relies on these):
```ts
// src/adapter/mapshaper-adapter.ts
export interface AppendedArc {
  xx: Float64Array;
  yy: Float64Array;
  zz?: Float64Array | null;
}
// on MapshaperAdapter:
appendArcs(arcs: ArcCollection, arcsToAppend: AppendedArc[]): number; // id of first appended arc
truncateArcs(arcs: ArcCollection, targetArcCount: number): void;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/adapter/mapshaper-adapter-arcs.test.ts
import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from './mapshaper-adapter';

// Mock ArcCollection mirroring split-shared-arcs.test.ts: tracks vertex data
// plus retained interval / flatness so the batch APIs can be asserted against
// real adapter behavior without importing mapshaper internals.
function makeArcs(options?: { withZz?: boolean }) {
  let nn = new Int32Array([2, 2]);
  let xx = new Float64Array([0, 0, 1, 1]);
  let yy = new Float64Array([0, 1, 1, 0]);
  let zz: Float64Array | null = options?.withZz ? new Float64Array([5, 5, 5, 5]) : null;
  let retained = 0;
  const arcs = {
    size: () => nn.length,
    isFlat: () => zz === null,
    getRetainedInterval: () => retained,
    setRetainedInterval: (v: number) => {
      retained = v;
    },
    getVertexData: () => {
      const ii = new Int32Array(nn.length);
      let cursor = 0;
      for (let i = 0; i < nn.length; i++) {
        ii[i] = cursor;
        cursor += nn[i]!;
      }
      return { xx, yy, zz, nn, ii, bb: null };
    },
    updateVertexData(newNn: Int32Array, newXx: Float64Array, newYy: Float64Array, newZz: Float64Array | null) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
      zz = newZz;
      retained = 0; // mirrors mapshaper: updateVertexData resets retained interval
    },
  } as any;
  return {
    arcs,
    state: () => ({ nn, xx, yy, zz, retained }),
  };
}

describe('MapshaperAdapter.appendArcs / truncateArcs', () => {
  it('appends multiple arcs in one call and returns the first new arc id', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const first = adapter.appendArcs(arcs, [
      { xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) },
      { xx: new Float64Array([4]), yy: new Float64Array([4]) },
    ]);
    expect(first).toBe(2);
    expect(Array.from(state().nn)).toEqual([2, 2, 2, 1]);
    expect(Array.from(state().xx)).toEqual([0, 0, 1, 1, 2, 3, 4]);
  });

  it('preserves the retained interval across append and truncate', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    arcs.setRetainedInterval(42);
    adapter.appendArcs(arcs, [{ xx: new Float64Array([9]), yy: new Float64Array([9]) }]);
    expect(state().retained).toBe(42);
    adapter.truncateArcs(arcs, 2);
    expect(state().retained).toBe(42);
  });

  it('fills Infinity zz for appended arcs missing zz when the collection keeps thresholds', () => {
    const { arcs, state } = makeArcs({ withZz: true });
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [{ xx: new Float64Array([7, 8]), yy: new Float64Array([7, 8]) }]);
    expect(Array.from(state().zz!)).toEqual([5, 5, 5, 5, Infinity, Infinity]);
  });

  it('keeps caller-supplied zz slices on appended arcs', () => {
    const { arcs, state } = makeArcs({ withZz: true });
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [
      { xx: new Float64Array([7]), yy: new Float64Array([7]), zz: new Float64Array([3]) },
    ]);
    expect(Array.from(state().zz!)).toEqual([5, 5, 5, 5, 3]);
  });

  it('truncateArcs drops tail vertex data and restores arc count', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [{ xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) }]);
    adapter.truncateArcs(arcs, 2);
    expect(state().nn.length).toBe(2);
    expect(Array.from(state().xx)).toEqual([0, 0, 1, 1]);
  });

  it('truncateArcs throws when target exceeds current arc count', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(() => adapter.truncateArcs(arcs, 5)).toThrow();
  });

  it('appendArcs with an empty list is a no-op returning current size', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(adapter.appendArcs(arcs, [])).toBe(2);
    expect(Array.from(state().nn)).toEqual([2, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/adapter/mapshaper-adapter-arcs.test.ts`
Expected: FAIL — `adapter.appendArcs is not a function`.

- [ ] **Step 3: Implement**

In `src/adapter/mapshaper-adapter.ts`:

1. Add near the top-level type exports (before the `MapshaperAdapter` interface):

```ts
/** Vertex data for one arc to append onto an `ArcCollection`. */
export interface AppendedArc {
  xx: Float64Array;
  yy: Float64Array;
  zz?: Float64Array | null;
}
```

2. Add to the `MapshaperAdapter` interface immediately after `deleteLastArc` (line ~188):

```ts
  /**
   * Append multiple arcs in ONE allocation. Returns the id of the first
   * appended arc (`arcs.size()` at call time). Preserves the retained
   * interval (`updateVertexData` resets it to 0 — saved and restored here).
   * When the collection keeps simplification thresholds (`zz`), appended
   * arcs missing `zz` are filled with `Infinity` (always retained),
   * mirroring `appendArc`.
   */
  appendArcs(arcs: ArcCollection, arcsToAppend: AppendedArc[]): number;

  /**
   * Truncate back to `targetArcCount` arcs, dropping tail vertex data in
   * one pass. Preserves the retained interval. Throws when the target
   * exceeds the current arc count — silently dropping arcs appended by
   * someone else would corrupt history invariants.
   */
  truncateArcs(arcs: ArcCollection, targetArcCount: number): void;
```

3. Add the implementation immediately after the existing `appendArc` method (after line ~691):

```ts
  appendArcs(arcs: ArcCollection, arcsToAppend: AppendedArc[]): number {
    const data = arcs.getVertexData!();
    const firstArcId = arcs.size();
    if (arcsToAppend.length === 0) return firstArcId;
    const { xx, yy, zz, nn } = data;
    let extraPoints = 0;
    for (const arc of arcsToAppend) extraPoints += arc.xx.length;

    const newXx = new Float64Array(xx.length + extraPoints);
    const newYy = new Float64Array(yy.length + extraPoints);
    newXx.set(xx);
    newYy.set(yy);

    // Mirror appendArc: appended vertices carry Infinity thresholds (always
    // retained) when the collection keeps simplification data.
    const flat = arcs.isFlat?.() ?? zz === null;
    let newZz: Float64Array | null = null;
    if (!flat) {
      newZz = new Float64Array(xx.length + extraPoints).fill(Infinity);
      if (zz) newZz.set(zz);
    }

    let cursor = xx.length;
    for (const arc of arcsToAppend) {
      newXx.set(arc.xx, cursor);
      newYy.set(arc.yy, cursor);
      if (newZz && arc.zz) newZz.set(arc.zz, cursor);
      cursor += arc.xx.length;
    }

    const newNn = new Int32Array(nn.length + arcsToAppend.length);
    newNn.set(nn);
    for (let i = 0; i < arcsToAppend.length; i++) {
      newNn[nn.length + i] = arcsToAppend[i]!.xx.length;
    }

    const retained = arcs.getRetainedInterval?.() ?? 0;
    arcs.updateVertexData!(newNn, newXx, newYy, newZz);
    arcs.setRetainedInterval?.(retained);
    return firstArcId;
  }

  truncateArcs(arcs: ArcCollection, targetArcCount: number): void {
    const data = arcs.getVertexData!();
    const { xx, yy, zz, nn } = data;
    if (nn.length === targetArcCount) return;
    if (targetArcCount > nn.length) {
      throw new Error(
        `truncateArcs: target ${targetArcCount} exceeds current arc count ${nn.length}`,
      );
    }
    let keptPoints = 0;
    for (let i = 0; i < targetArcCount; i++) keptPoints += nn[i]!;
    const newNn = new Int32Array(targetArcCount);
    newNn.set(nn.subarray(0, targetArcCount));
    const retained = arcs.getRetainedInterval?.() ?? 0;
    arcs.updateVertexData!(
      newNn,
      new Float64Array(xx.subarray(0, keptPoints)),
      new Float64Array(yy.subarray(0, keptPoints)),
      zz ? new Float64Array(zz.subarray(0, keptPoints)) : null,
    );
    arcs.setRetainedInterval?.(retained);
  }
```

4. In `src/edit/commands/split-shared-arcs.ts`: delete the local `export interface AppendedArc { ... }` declaration (lines 23-31) and replace with:

```ts
import type { AppendedArc } from '../../adapter/mapshaper-adapter';
// Re-exported so the public `@/edit/commands/split-shared-arcs` import path
// (and `src/index.ts`) keep working after the type moved to the adapter.
export type { AppendedArc };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/adapter/mapshaper-adapter-arcs.test.ts && pnpm typecheck`
Expected: 7 tests PASS; typecheck clean (split-shared-arcs still compiles via the re-export).

- [ ] **Step 5: Commit**

```bash
git add src/adapter/mapshaper-adapter.ts src/adapter/mapshaper-adapter-arcs.test.ts src/edit/commands/split-shared-arcs.ts
git commit -m "feat(adapter): batch appendArcs/truncateArcs with retained-interval and zz fixes"
```

---

### Task 2: `SplitSharedArcsCommand` reverse-consumes adapter APIs

**Files:**
- Modify: `src/edit/commands/split-shared-arcs.ts` (delete private `appendArcs`/`truncateArcs` at lines ~226-275; command delegates to adapter)
- Test: `src/edit/commands/split-shared-arcs.test.ts` (existing suite must stay green; add one retained-interval regression test)

**Interfaces:**
- Consumes: `MapshaperAdapter.appendArcs/truncateArcs` (Task 1), `AppendedArc` from adapter.
- Produces: unchanged public surface (`SplitSharedArcsCommand`, `planSharedArcSplit`, `AppendedArc` re-export).

- [ ] **Step 1: Write the failing regression test**

Append to `src/edit/commands/split-shared-arcs.test.ts` (fixture's mock arcs need `getRetainedInterval`/`setRetainedInterval` — extend `buildFixture`'s arcs mock with `let retained = 0; getRetainedInterval: () => retained, setRetainedInterval: (v: number) => { retained = v; }` and expose `state: () => ({ retained })` from the fixture):

```ts
  it('preserves the retained interval across do/undo', () => {
    const { source, layerA, layerB, arcs } = buildFixture();
    arcs.setRetainedInterval(17);
    const plan = planSharedArcSplit(source, [{ layer: layerA, featureId: 0 }], [layerA, layerB])!;
    const command = new SplitSharedArcsCommand(plan);
    command.do();
    expect(arcs.getRetainedInterval()).toBe(17);
    command.undo();
    expect(arcs.getRetainedInterval()).toBe(17);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/edit/commands/split-shared-arcs.test.ts`
Expected: the new test FAILS (old private helpers reset the interval via `updateVertexData`); all pre-existing tests PASS.

- [ ] **Step 3: Implement the delegation**

In `src/edit/commands/split-shared-arcs.ts`:

1. Change the adapter import (top of file) to:

```ts
import { getDefaultMapshaperAdapter, type AppendedArc } from '../../adapter/mapshaper-adapter';
```

(keep the `export type { AppendedArc };` re-export line from Task 1).

2. Replace `do()` body:

```ts
  do(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    getDefaultMapshaperAdapter().appendArcs(arcs, this.opts.appendedArcs);
    for (const r of this.opts.remaps) {
      r.layer.shapes![r.featureId] = cloneShape(r.newShape);
    }
    markSourceChanged(source);
  }
```

3. Replace `undo()` body:

```ts
  undo(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    getDefaultMapshaperAdapter().truncateArcs(arcs, this.opts.originalArcCount);
    for (const r of this.opts.remaps) {
      r.layer.shapes![r.featureId] = cloneShape(r.originalShape);
    }
    markSourceChanged(source);
  }
```

4. Delete the two private module functions `appendArcs` and `truncateArcs` at the bottom of the file. Keep `cloneShape`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/edit/commands/`
Expected: ALL PASS — the full commands directory suite (split-shared-arcs, split-shared-node, vertex-delete, vertex-move, feature-delete, composite, …) is green; `vertex-delete.ts` / `split-shared-node.ts` consume `AppendedArc` only as a type and are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/edit/commands/split-shared-arcs.ts src/edit/commands/split-shared-arcs.test.ts
git commit -m "refactor(commands): SplitSharedArcsCommand delegates to adapter batch arc APIs"
```

---

### Task 3: `PathGeometryPatchCommand`

**Files:**
- Create: `src/edit/commands/path-geometry-patch.ts`
- Test: `src/edit/commands/path-geometry-patch.test.ts` (create)

**Interfaces:**
- Consumes: `AppendedArc` + `appendArcs`/`truncateArcs` (Task 1), `markSourceChanged` (`./_shared`), `Selection.apply(refs, 'replace')` / `Selection.restore(snapshot)` / `Selection.snapshot()` (`src/map/selection.ts`), `TopologySource`/`asMutableTopologySource` (`src/source/source.ts`).
- Produces (Tasks 6-10 construct this):

```ts
export interface PathShapePatch {
  layer: MapshaperLayer;
  featureId: number;
  before: PathShape;
  after: PathShape;
}

export interface PathGeometryPatchCommandOptions {
  source: TopologySource;
  shapePatches: PathShapePatch[];
  originalArcCount: number;
  appendedArcs: AppendedArc[];
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
  adapter?: MapshaperAdapter; // test override
}
```

- [ ] **Step 1: Write the failing test**

```ts
// src/edit/commands/path-geometry-patch.test.ts
import { describe, expect, it, vi } from 'vitest';
import { PathGeometryPatchCommand } from './path-geometry-patch';
import { Selection } from '../../map/selection';

function makeArcs() {
  let nn = new Int32Array([2]);
  let xx = new Float64Array([0, 1]);
  let yy = new Float64Array([0, 1]);
  const arcs = {
    size: () => nn.length,
    isFlat: () => true,
    getVertexData: () => {
      const ii = new Int32Array(nn.length);
      let cursor = 0;
      for (let i = 0; i < nn.length; i++) {
        ii[i] = cursor;
        cursor += nn[i]!;
      }
      return { xx, yy, zz: null, nn, ii, bb: null };
    },
    updateVertexData(newNn: Int32Array, newXx: Float64Array, newYy: Float64Array) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
    },
  } as any;
  return {
    arcs,
    state: () => ({ nn, xx, yy }),
  };
}

function makeSource(arcs: any) {
  return {
    getArcs: () => arcs,
    getDataset: () => ({ layers: [], arcs }),
    markDisplayArcsDirty: vi.fn(),
    fire: vi.fn(),
  } as any;
}

const REF = { source: 's', layer: 'l', id: 0 };

function makeCommand(arcs: any, source: any, layer: any, selection: Selection) {
  const publishSelection = vi.fn();
  const command = new PathGeometryPatchCommand({
    source,
    shapePatches: [
      { layer, featureId: 0, before: [[0]], after: [[0], [1]] }, // add ring arc 1
    ],
    originalArcCount: 1,
    appendedArcs: [{ xx: new Float64Array([5, 6]), yy: new Float64Array([5, 6]) }],
    selection,
    beforeSelection: selection.snapshot(),
    afterSelection: [REF],
    publishSelection,
    label: 'Add ring',
  });
  return { command, publishSelection };
}

describe('PathGeometryPatchCommand', () => {
  it('do appends arcs, writes the after shape, applies the selection', () => {
    const { arcs, state } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    command.do();
    expect(state().nn.length).toBe(2);
    expect(layer.shapes[0]).toEqual([[0], [1]]);
    expect(selection.getAll()).toEqual([REF]);
    expect(source.markDisplayArcsDirty).toHaveBeenCalled();
  });

  it('undo truncates arcs, restores the before shape and selection', () => {
    const { arcs, state } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    command.do();
    command.undo();
    expect(state().nn.length).toBe(1);
    expect(Array.from(state().xx)).toEqual([0, 1]);
    expect(layer.shapes[0]).toEqual([[0]]);
    expect(selection.getAll()).toEqual([]);
  });

  it('redo reproduces identical arc ids across multiple undo/redo rounds', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    command.do();
    const firstShapes = JSON.stringify(layer.shapes);
    for (let round = 0; round < 3; round++) {
      command.undo();
      command.do();
      expect(JSON.stringify(layer.shapes)).toBe(firstShapes);
      expect(layer.shapes[0]![1]).toEqual([1]); // appended arc id stays 1
    }
  });

  it('do throws when the arc count drifted from the planned count', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command } = makeCommand(arcs, source, layer, selection);
    // Simulate a bypassing append after planning.
    arcs.updateVertexData(new Int32Array([2, 3]), new Float64Array(5), new Float64Array(5));
    expect(() => command.do()).toThrow();
  });

  it('clones shape snapshots at construction so caller mutation cannot rewrite history', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const before = [[0]];
    const after = [[0], [1]];
    const command = new PathGeometryPatchCommand({
      source,
      shapePatches: [{ layer, featureId: 0, before, after }],
      originalArcCount: 1,
      appendedArcs: [{ xx: new Float64Array([5, 6]), yy: new Float64Array([5, 6]) }],
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [],
      publishSelection: () => {},
      label: 'Add ring',
    });
    after[1]![0] = 999; // caller mutates its array after construction
    command.do();
    expect(layer.shapes[0]).toEqual([[0], [1]]);
  });

  it('publish fires data(edit) and the pending selection diff exactly once', () => {
    const { arcs } = makeArcs();
    const source = makeSource(arcs);
    const layer = { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] } as any;
    const selection = new Selection();
    const { command, publishSelection } = makeCommand(arcs, source, layer, selection);
    command.do();
    command.publish();
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'edit' });
    expect(publishSelection).toHaveBeenCalledTimes(1);
    expect(publishSelection.mock.calls[0]![0]).toMatchObject({ added: [REF], removed: [] });
    command.publish(); // second publish: diff already consumed
    expect(publishSelection).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/edit/commands/path-geometry-patch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/edit/commands/path-geometry-patch.ts
import type { EditCommand } from '../edit-command';
import type { MapshaperLayer, PathShape } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';
import {
  getDefaultMapshaperAdapter,
  type AppendedArc,
  type MapshaperAdapter,
} from '../../adapter/mapshaper-adapter';
import { markSourceChanged } from './_shared';

/** One feature's path shape replaced wholesale (before/after snapshots). */
export interface PathShapePatch {
  layer: MapshaperLayer;
  featureId: number;
  before: PathShape;
  after: PathShape;
}

export interface PathGeometryPatchCommandOptions {
  source: TopologySource;
  shapePatches: PathShapePatch[];
  /** Arc count BEFORE the first do(). undo() truncates back to this. */
  originalArcCount: number;
  /** Arcs appended by do(), in id order (first id = originalArcCount). */
  appendedArcs: AppendedArc[];
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
  /** Adapter override for tests; defaults to the process-wide singleton. */
  adapter?: MapshaperAdapter;
}

function cloneShape(shape: PathShape): PathShape {
  return shape.map((part) => part.slice());
}

/**
 * In-place reversible patch for local path-geometry edits (add/delete ring,
 * add/delete part). Do/undo are exact mirror images:
 *
 *   do:   append arcs → write after shapes → apply afterSelection
 *   undo: truncate arcs → restore before shapes → restore beforeSelection
 *
 * Arc ids stay stable for the command's lifetime: nothing below the original
 * arc count is ever rewritten, and redo re-appends the same vertex data at
 * the same count. Both do and redo assert the collection still holds exactly
 * `originalArcCount` arcs so a bypassing append fails loudly instead of
 * corrupting history.
 *
 * Not a history barrier: `invalidatesPriorCommands` is intentionally absent,
 * so consecutive local edits stack into multi-level undo/redo.
 */
export class PathGeometryPatchCommand implements EditCommand {
  readonly label: string;
  private readonly opts: PathGeometryPatchCommandOptions;
  private pendingSelectionDiff: SelectionDiff | null = null;

  constructor(opts: PathGeometryPatchCommandOptions) {
    // Clone snapshots: caller arrays may be reused/mutated after construction.
    this.opts = {
      ...opts,
      shapePatches: opts.shapePatches.map((patch) => ({
        ...patch,
        before: cloneShape(patch.before),
        after: cloneShape(patch.after),
      })),
    };
    this.label = opts.label;
  }

  do(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    if (this.opts.appendedArcs.length > 0) {
      if (arcs.size() !== this.opts.originalArcCount) {
        throw new Error(
          `PathGeometryPatchCommand: expected ${this.opts.originalArcCount} arcs before do(), found ${arcs.size()}`,
        );
      }
      adapter.appendArcs(arcs, this.opts.appendedArcs);
    }
    for (const patch of this.opts.shapePatches) {
      patch.layer.shapes![patch.featureId] = cloneShape(patch.after);
    }
    this.pendingSelectionDiff = this.opts.selection.apply(this.opts.afterSelection, 'replace');
    markSourceChanged(source);
  }

  undo(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    if (this.opts.appendedArcs.length > 0) {
      const expected = this.opts.originalArcCount + this.opts.appendedArcs.length;
      if (arcs.size() !== expected) {
        throw new Error(
          `PathGeometryPatchCommand: expected ${expected} arcs before undo(), found ${arcs.size()}`,
        );
      }
      adapter.truncateArcs(arcs, this.opts.originalArcCount);
    }
    for (const patch of this.opts.shapePatches) {
      patch.layer.shapes![patch.featureId] = cloneShape(patch.before);
    }
    this.pendingSelectionDiff = this.opts.selection.restore(this.opts.beforeSelection);
    markSourceChanged(source);
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'edit' });
    if (this.pendingSelectionDiff?.changed) this.opts.publishSelection(this.pendingSelectionDiff);
    this.pendingSelectionDiff = null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/edit/commands/path-geometry-patch.test.ts && pnpm typecheck`
Expected: 6 tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/edit/commands/path-geometry-patch.ts src/edit/commands/path-geometry-patch.test.ts
git commit -m "feat(commands): PathGeometryPatchCommand for in-place ring/part edits"
```

---

### Task 4: `FeatureDeleteWithSelectionCommand`

**Files:**
- Modify: `src/edit/commands/feature-delete.ts` (append new class; do NOT change `FeatureDeleteCommand` / `BulkFeatureDeleteCommand`)
- Test: `src/edit/commands/feature-delete.test.ts` (extend)

**Interfaces:**
- Consumes: `FeatureDeleteCommand` (same file), `Selection` APIs, `markSourceChanged`.
- Produces (Task 10 constructs this):

```ts
export interface FeatureDeleteWithSelectionCommandOptions extends FeatureDeleteCommandOptions {
  source: TopologySource;
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
}
export class FeatureDeleteWithSelectionCommand implements EditCommand { /* do/undo/publish/label */ }
```

- [ ] **Step 1: Write the failing test**

Append to `src/edit/commands/feature-delete.test.ts`:

```ts
describe('FeatureDeleteWithSelectionCommand', () => {
  function makeSetup() {
    const layer = {
      name: 'l',
      geometry_type: 'polygon',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => records },
    } as any;
    const records = [{ name: 'a' }, { name: 'b' }];
    const source = {
      getArcs: () => null,
      getDataset: () => ({ layers: [layer], arcs: null }),
      markDisplayArcsDirty: vi.fn(),
      fire: vi.fn(),
    } as any;
    const selection = new Selection();
    selection.apply(
      [
        { source: 's', layer: 'l', id: 1 }, // the feature about to be deleted
        { source: 's', layer: 'l', id: 0 },
      ],
      'add',
    );
    const publishSelection = vi.fn();
    const command = new FeatureDeleteWithSelectionCommand({
      layer,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1]!,
      source,
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [{ source: 's', layer: 'l', id: 0 }],
      publishSelection,
      label: 'Delete part',
    });
    return { layer, records, source, selection, publishSelection, command };
  }

  it('do splices the feature row + record and applies the remapped selection', () => {
    const { layer, records, selection, command } = makeSetup();
    command.do();
    expect(layer.shapes).toEqual([[[0]]]);
    expect(records).toEqual([{ name: 'a' }]);
    expect(selection.getAll()).toEqual([{ source: 's', layer: 'l', id: 0 }]);
  });

  it('undo restores the feature row + record + selection exactly', () => {
    const { layer, records, selection, command } = makeSetup();
    command.do();
    command.undo();
    expect(layer.shapes).toEqual([[[0]], [[1]]]);
    expect(records).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(selection.getAll()).toHaveLength(2);
  });

  it('publish fires data(edit) and the selection diff once', () => {
    const { source, publishSelection, command } = makeSetup();
    command.do();
    command.publish();
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'edit' });
    expect(publishSelection).toHaveBeenCalledTimes(1);
    expect(publishSelection.mock.calls[0]![0]).toMatchObject({
      added: [],
      removed: [{ source: 's', layer: 'l', id: 1 }],
    });
  });
});
```

(Add `FeatureDeleteWithSelectionCommand` + `Selection` + `vi` imports to the test file head as needed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/edit/commands/feature-delete.test.ts`
Expected: FAIL — `FeatureDeleteWithSelectionCommand` is not exported.

- [ ] **Step 3: Implement**

Append to `src/edit/commands/feature-delete.ts`:

```ts
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';
import { markSourceChanged } from './_shared';

export interface FeatureDeleteWithSelectionCommandOptions extends FeatureDeleteCommandOptions {
  source: TopologySource;
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
}

/**
 * Source-aware wrapper around {@link FeatureDeleteCommand} for op-driven
 * deletions (e.g. `deletePart` removing a feature's last part). Adds the
 * three things the plain command deliberately does not own: selection
 * snapshot/remap, `markSourceChanged`, and the publish contract
 * (`data` + one selection diff). Cache invalidation / render / history
 * events stay with the runner.
 */
export class FeatureDeleteWithSelectionCommand implements EditCommand {
  readonly label: string;
  private readonly inner: FeatureDeleteCommand;
  private pendingSelectionDiff: SelectionDiff | null = null;

  constructor(private readonly opts: FeatureDeleteWithSelectionCommandOptions) {
    this.inner = new FeatureDeleteCommand(opts);
    this.label = opts.label;
  }

  do(): void {
    this.inner.do();
    this.pendingSelectionDiff = this.opts.selection.apply(this.opts.afterSelection, 'replace');
    markSourceChanged(asMutableTopologySource(this.opts.source));
  }

  undo(): void {
    this.inner.undo();
    this.pendingSelectionDiff = this.opts.selection.restore(this.opts.beforeSelection);
    markSourceChanged(asMutableTopologySource(this.opts.source));
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'edit' });
    if (this.pendingSelectionDiff?.changed) this.opts.publishSelection(this.pendingSelectionDiff);
    this.pendingSelectionDiff = null;
  }
}
```

(Place the new imports at the top of the file with the existing ones; the class goes at the end.)

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/edit/commands/feature-delete.test.ts && pnpm typecheck`
Expected: ALL PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/edit/commands/feature-delete.ts src/edit/commands/feature-delete.test.ts
git commit -m "feat(commands): FeatureDeleteWithSelectionCommand for op-driven feature removal"
```

---

### Task 5: Direct runner `_runPreparedEditCommand` + OpContext wiring

**Files:**
- Modify: `src/map/ops/_context.ts` (add `PreparedDirectEdit<T>` + `RunPreparedEditCommand` types + `OpContext.runPreparedEditCommand` field)
- Modify: `src/map/ops/_runner.ts` (add `_runPreparedEditCommand` after `_runPreparedDatasetMutation`, ~line 306)
- Modify: `src/map/mapshaper-ops.ts` (wire `runPreparedEditCommand` into `_ctx`, lines ~130-148)
- Modify: `src/map/ops/_test-helpers.ts` (add stub field so existing stub ctxs keep compiling)
- Test: `src/map/ops/_runner.test.ts` (extend)

**Interfaces:**
- Consumes: `enqueueSourceOperation`, `Err`/`okValue` (same module), `EditCommand`, `TransactionInternal._captureFirstTouch`/`_trackOperation`.
- Produces (Tasks 6-10 call this via `ctx.runPreparedEditCommand`):

```ts
// _context.ts
export interface PreparedDirectEdit<T> {
  value: T;
  command: EditCommand;
  affectedSourceIds: readonly string[];
}
export type RunPreparedEditCommand = <T>(
  sourceId: string,
  label: string,
  plan: (
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T>,
) => Promise<OpResult<T>>;
// OpContext gains:  runPreparedEditCommand: RunPreparedEditCommand;
```

- [ ] **Step 1: Write the failing test**

Append to `src/map/ops/_runner.test.ts`. Add two static imports at the file head —
`import { EditHistory } from '../../edit/edit-history';` and
`import { Selection } from '../selection';` — then append the suite below. The
stub host uses a REAL `EditHistory` so push/capture behavior is exercised:

```ts
describe('_runPreparedEditCommand', () => {
  function makeHost(source: any) {
    return {
      _removed: false,
      _sources: new Map([['s', source]]),
      _selection: new Selection(),
      _history: new EditHistory(),
      _activeTransaction: null,
      _scheduleRender: vi.fn(),
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      _invalidateShapeCachesForSources: vi.fn(),
      _clearSpatialIndexesForSources: vi.fn(),
      fire: vi.fn(),
    } as any;
  }

  it('runs planner on the live dataset, commits the command, publishes once', async () => {
    const dataset = { layers: [], arcs: null, editVersion: 0 };
    const source = { getDataset: () => dataset, fire: vi.fn(), markDisplayArcsDirty: vi.fn() };
    const host = makeHost(source);
    const command = { do: vi.fn(), undo: vi.fn(), publish: vi.fn(), label: 'X' };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', (planned, plannedSource) => {
      expect(planned).toBe(dataset); // live, NOT a copy
      expect(plannedSource).toBe(source);
      return { value: 42, command, affectedSourceIds: ['s'] };
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(command.do).toHaveBeenCalledTimes(1);
    expect(command.publish).toHaveBeenCalledTimes(1);
    expect(host._history.size()).toBe(1);
    expect(host._fireHistoryChange).toHaveBeenCalledTimes(1);
    // Side effects ride on publish's data event — runner must NOT duplicate them:
    expect(host._invalidateShapeCachesForSources).not.toHaveBeenCalled();
    expect(host._scheduleRender).not.toHaveBeenCalled();
  });

  it('returns planner failure without touching history', async () => {
    const dataset = { layers: [], arcs: null };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () =>
      Err.validation('ring', 'nope'),
    );
    expect(result.ok).toBe(false);
    expect(host._history.size()).toBe(0);
  });

  it('rejects with stale-operation when editVersion changed during planning', async () => {
    const dataset: any = { layers: [], arcs: null, editVersion: 0 };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    const command = { do: vi.fn(), undo: vi.fn() };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () => {
      dataset.editVersion = 1; // concurrent edit slipped in
      return { value: undefined, command, affectedSourceIds: ['s'] };
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
    expect(command.do).not.toHaveBeenCalled();
    expect(host._history.size()).toBe(0);
  });

  it('undoes a throwing do() and reports a mapshaper error without pushing history', async () => {
    const dataset = { layers: [], arcs: null };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    const command = {
      do: vi.fn(() => { throw new Error('boom'); }),
      undo: vi.fn(),
    };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () => ({
      value: undefined,
      command,
      affectedSourceIds: ['s'],
    }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'mapshaper' } });
    expect(command.undo).toHaveBeenCalledTimes(1);
    expect(host._history.size()).toBe(0);
  });

  it('diverts the command into an active transaction capture buffer', async () => {
    const dataset = { layers: [], arcs: null };
    const source = { getDataset: () => dataset };
    const host = makeHost(source);
    host._history.beginCapture();
    host._activeTransaction = {
      isOpen: true,
      _captureFirstTouch: vi.fn(),
      _trackOperation: vi.fn(),
    };
    const command = { do: vi.fn(), undo: vi.fn(), publish: vi.fn() };
    const result = await _runPreparedEditCommand(host as any, 's', 'X', () => ({
      value: undefined,
      command,
      affectedSourceIds: ['s'],
    }));
    expect(result.ok).toBe(true);
    expect(host._history.size()).toBe(0); // captured, not pushed
    expect(host._history.endCapture()).toEqual([command]);
    expect(host._fireHistoryChange).not.toHaveBeenCalled();
    expect(host._activeTransaction._captureFirstTouch).toHaveBeenCalledWith('s', dataset);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/map/ops/_runner.test.ts`
Expected: FAIL — `_runPreparedEditCommand` not exported.

- [ ] **Step 3: Implement**

1. In `src/map/ops/_context.ts` add imports (`EditCommand` from `../../edit/edit-command`, `MutableTopologySource` from `../../source/source`) and:

```ts
/** Planner output for {@link RunPreparedEditCommand}: value + ready-to-commit command. */
export interface PreparedDirectEdit<T> {
  value: T;
  command: EditCommand;
  /** Sources the command mutates; asserted in tests, consumed by the Phase-B batch runner. */
  affectedSourceIds: readonly string[];
}

/**
 * In-place edit runner: plans read-only against the LIVE dataset, then
 * commits the returned command (do → history push → publish). No dataset
 * copy, no replacement barrier. See DIRECT_GEOMETRY_EDIT_DESIGN.md §8.
 */
export type RunPreparedEditCommand = <T>(
  sourceId: string,
  label: string,
  plan: (
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T>,
) => Promise<OpResult<T>>;
```

and add `runPreparedEditCommand: RunPreparedEditCommand;` to `OpContext`.

2. In `src/map/ops/_runner.ts`, immediately after `_runPreparedDatasetMutation` (after line ~306):

```ts
export function _runPreparedEditCommand<T>(
  host: EmapHostInternal,
  sourceId: string,
  label: string,
  plan: (
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T>,
): Promise<OpResult<T>> {
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueSourceOperation(host, sourceId, async () => {
    if (host._removed) return Err.hostRemoved();
    const source = host._sources.get(sourceId);
    if (!source) return Err.notFound('source', sourceId);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', sourceId);

    const plannedEditVersion = dataset.editVersion ?? 0;
    let planned: PreparedDirectEdit<T> | OpResult<T>;
    try {
      planned = plan(dataset, source);
      if ('ok' in planned) return planned;
    } catch (err) {
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, { operation: label });
    }

    if (host._removed) return Err.hostRemoved();
    if (
      host._sources.get(sourceId) !== source ||
      source.getDataset() !== dataset ||
      (dataset.editVersion ?? 0) !== plannedEditVersion ||
      host._activeTransaction !== transaction ||
      (transaction !== null && !transaction.isOpen)
    ) {
      return Err.staleOperation(sourceId, label);
    }

    // First-touch bookkeeping so Transaction.rollback can notify this source.
    // For direct edits the snapshot IS the live object (mutated in place) —
    // rollback correctness comes from reverse-order command undo, not the
    // snapshot. See transaction.ts rollback.
    transaction?._captureFirstTouch(sourceId, dataset);

    const { command } = planned;
    try {
      command.do();
    } catch (err) {
      // do() is designed to be failure-free after planning (all allocation
      // happens in the planner); if allocation still threw, best-effort undo
      // to avoid leaving a partial mutation.
      try {
        command.undo();
      } catch {
        // swallow — the original error is the meaningful one
      }
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, { operation: label });
    }

    host._history.push(command);
    // publish() fires source 'data' → the map's data handler invalidates
    // shape caches, schedules render, and re-fires map-level 'data'. The
    // runner deliberately does NOT duplicate those side effects.
    (command as { publish?: () => void }).publish?.();
    if (!host._history.isCapturing()) host._fireHistoryChange();
    return okValue(planned.value);
  });
  transaction?._trackOperation(operation);
  return operation;
}
```

Add `PreparedDirectEdit` to the existing `from './_context'` type import.

3. In `src/map/mapshaper-ops.ts`: add `_runPreparedEditCommand as _runPreparedEditCommandShared` to the `_runner` import block (lines 23-28) and add to `_ctx` after `runPreparedDatasetMutation`:

```ts
      runPreparedEditCommand: (sourceId, label, plan) =>
        _runPreparedEditCommandShared(this._emap, sourceId, label, plan),
```

4. In `src/map/ops/_test-helpers.ts` add to the stub ctx (after `runPreparedDatasetMutation`):

```ts
    runPreparedEditCommand: <T>() => Promise.resolve(OK as OpResult<T>),
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/map/ops/_runner.test.ts src/map/ops/_test-helpers.ts && pnpm typecheck`
Expected: ALL PASS (existing runner tests + 5 new); typecheck clean. Note: `_test-helpers.ts` has no test file — typecheck covers it. If any OTHER test file constructs a raw `OpContext` object literal, typecheck will flag it; add the same one-line stub there.

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/_context.ts src/map/ops/_runner.ts src/map/mapshaper-ops.ts src/map/ops/_test-helpers.ts src/map/ops/_runner.test.ts
git commit -m "feat(ops): direct edit runner for in-place reversible commands"
```

---

### Task 6: `coordinatesToArcSnapshot` helper + `addRing` migration

**Files:**
- Modify: `src/map/ops/geometry-2d.ts` (append helper)
- Modify: `src/map/ops/rings.ts` (rewrite `addRing`; `deleteRing` untouched until Task 7)
- Test: `src/map/ops/rings.test.ts` (migrate the stub: replace `runPreparedDatasetMutation` fakes with `runPreparedEditCommand` fakes — see below)

**Interfaces:**
- Consumes: `ctx.runPreparedEditCommand` (Task 5), `PathGeometryPatchCommand` (Task 3).
- Produces:

```ts
// geometry-2d.ts
export function coordinatesToArcSnapshot(points: readonly Coordinate[]): AppendedArc;
```

**Test stub migration (applies to rings.test.ts here, parts.test.ts in Tasks 8/10):** the existing `createFixture` builds a REAL dataset via `adapter.runImport` and stubs `ctx.runPreparedDatasetMutation` with a copyDataset-based fake (`rings.test.ts:72-81`). Replace that one ctx field with a direct-edit fake and record pushed commands. Exact code (module-level `adapter` already exists in rings.test.ts):

```ts
// Extend createFixture: replace the `runPreparedDatasetMutation` ctx field with
// the block below, add `entries` to the returned object, and add to the file head:
//   import { okValue } from '../op-result';  // (already imported)
//   import type { EditCommand } from '../../edit/edit-command';
const entries: EditCommand[] = [];
// ...inside the ctx object literal:
    runPreparedEditCommand: async <T>(
      _sourceId: string,
      _label: string,
      plan: (planned: MapshaperDataset, plannedSource: unknown) => any,
    ): Promise<OpResult<T>> => {
      const outcome = plan(dataset, source);
      if ('ok' in outcome) return outcome;
      outcome.command.do();
      entries.push(outcome.command);
      return okValue(outcome.value);
    },
// ...return { ctx, dataset: () => dataset, refs, entries, undo: ... }
```

Important: the fixture's `_selection` stub (`{ getAll: () => refs }`) must become a REAL
`Selection` (`new Selection()` + `selection.apply(refs, 'replace')`), because the new
commands call `selection.snapshot() / .apply() / .restore()`. `integrationHarness`
already uses a real `Selection` — mirror that.

Keep every existing assertion unchanged — they pin behavior (validation errors, target resolution, selection); only the runner seam moves. The stale-rejection test (`rings.test.ts:~232`) migrates the same way; identity drift is simulated by passing a DIFFERENT object as the planned dataset — `plan({ ...fixture.dataset() } as any, source)` — so the op's `planned !== dataset` check returns `stale-operation` and no entry is recorded.

- [ ] **Step 1: Write the failing tests**

Append to `src/map/ops/rings.test.ts` (uses `createFixture`, `exported`, and the
module-level `adapter`; ring coordinates are literal so no fixture changes are needed
beyond the stub migration above):

```ts
describe('addRing direct edit (multi-level undo)', () => {
  const SHELL: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };
  const HOLE_A: [number, number][] = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ];
  const HOLE_B: [number, number][] = [
    [4, 1],
    [5, 1],
    [5, 2],
    [4, 2],
  ];
  const HOLE_C: [number, number][] = [
    [7, 1],
    [8, 1],
    [8, 2],
    [7, 2],
  ];

  it('commits an in-place command without copying the dataset', async () => {
    const fixture = await createFixture(undefined, undefined, SHELL);
    const live = fixture.dataset();
    const copySpy = vi.spyOn(adapter, 'copyDataset');
    try {
      const result = await addRing(fixture.ctx, { ring: HOLE_A });
      expect(result.ok).toBe(true);
      expect(copySpy).not.toHaveBeenCalled();
      expect(fixture.dataset()).toBe(live); // same object, mutated in place
      expect(fixture.entries).toHaveLength(1);
      expect(fixture.entries[0]!.label).toBe('Add ring');
      expect((fixture.entries[0] as any).invalidatesPriorCommands).toBeUndefined();
    } finally {
      copySpy.mockRestore();
    }
  });

  it('three consecutive addRings undo/redo level by level with stable arc ids', async () => {
    const fixture = await createFixture(undefined, undefined, SHELL);
    const arcs = fixture.dataset().arcs!;
    const originalArcCount = arcs.size();
    const ringCount = () => exported(fixture.dataset()).coordinates.length;

    await addRing(fixture.ctx, { ring: HOLE_A });
    await addRing(fixture.ctx, { ring: HOLE_B });
    await addRing(fixture.ctx, { ring: HOLE_C });
    expect(ringCount()).toBe(4);
    expect(arcs.size()).toBe(originalArcCount + 3);
    expect(fixture.entries).toHaveLength(3);

    fixture.entries[2]!.undo();
    expect(ringCount()).toBe(3);
    fixture.entries[1]!.undo();
    expect(ringCount()).toBe(2);
    fixture.entries[0]!.undo();
    expect(ringCount()).toBe(1);
    expect(arcs.size()).toBe(originalArcCount);

    fixture.entries[0]!.do();
    fixture.entries[1]!.do();
    fixture.entries[2]!.do();
    expect(ringCount()).toBe(4);
    expect(arcs.size()).toBe(originalArcCount + 3); // redo reuses the same ids
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/map/ops/rings.test.ts`
Expected: the two new tests FAIL (`copyDataset` still called / `entries` empty). Existing tests still pass here — the stub seam migrates in Step 3 together with the op.

- [ ] **Step 3: Implement the helper + migrate `addRing`**

1. Append to `src/map/ops/geometry-2d.ts`:

```ts
import type { AppendedArc } from '../../adapter/mapshaper-adapter'; // top-of-file type import

/** Pack planar coordinates into one appendable arc snapshot (no zz). */
export function coordinatesToArcSnapshot(points: readonly Coordinate[]): AppendedArc {
  const xx = new Float64Array(points.length);
  const yy = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    xx[i] = points[i]![0];
    yy[i] = points[i]![1];
  }
  return { xx, yy };
}
```

2. In `src/map/ops/rings.ts` rewrite `addRing` (imports: add `PathGeometryPatchCommand` from `../../edit/commands/path-geometry-patch`, `coordinatesToArcSnapshot` from `./geometry-2d`):

```ts
export async function addRing(ctx: OpContext, options: AddRingOptions): Promise<OpResult<void>> {
  const ring = normalizeRing(options.ring);
  if (!ring) return Err.validation('ring', 'ring coordinates are invalid');
  if (Math.abs(shoelaceArea(ring)) === 0)
    return Err.validation('ring', 'ring must enclose an area');
  if (new SegmentConflictIndex([ringSegments(ring)]).hasConflict())
    return Err.validation('ring', 'ring self-intersects');
  const adapter = getDefaultMapshaperAdapter();
  let genericFailure: OpResult<void> | null = null;
  let specificFailure: OpResult<void> | null = null;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(sourceId, 'Add ring', (planned) => {
      // Read-only planning against the LIVE dataset. `planned === dataset`
      // is guaranteed by the runner; the identity check pins the contract.
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Add ring');
      const arcs = planned.arcs!;
      let reason: string | null = null;
      for (const layer of planned.layers) {
        if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
        for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
          const shape = layer.shapes[featureId] as PathShape | null;
          if (!shape?.length) continue;
          // Cheap prefilter (unchanged semantics): skip features that cannot
          // contain the ring.
          if (
            !shape.some((part) =>
              adapter.testPointInPolygon(ring[0]![0], ring[0]![1], [part], arcs),
            )
          )
            continue;
          const target = ringTarget(ring, shape, arcs, adapter);
          if (target === 'outside') continue;
          if (typeof target === 'string') {
            reason = reason ?? target;
            continue;
          }
          const shapeError = validateTargetShape(shape, arcs, adapter);
          if (shapeError) return shapeError;
          const exteriorCoordinates = shapeSegments(
            [shape[target.exteriorIndex]!],
            arcs,
          ).map(([start]) => start);
          const hole =
            shoelaceArea(ring) * shoelaceArea(exteriorCoordinates) > 0 ? [...ring].reverse() : ring;
          // Build the after shape WITHOUT touching the live one: the new ring
          // references the arc id the command will append at do() time.
          const afterShape = shape.slice();
          afterShape.splice(target.insertIndex, 0, [arcs.size()]);
          return {
            value: undefined,
            affectedSourceIds: [sourceId],
            command: new PathGeometryPatchCommand({
              source,
              shapePatches: [{ layer, featureId, before: shape, after: afterShape }],
              originalArcCount: arcs.size(),
              appendedArcs: [coordinatesToArcSnapshot(hole)],
              selection: ctx.host._selection,
              beforeSelection: ctx.host._selection.snapshot(),
              afterSelection: ctx.host._selection.getAll(),
              publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
              label: 'Add ring',
            }),
          };
        }
      }
      return Err.validation('ring', reason ?? 'ring is not inside a polygon exterior');
    });
    if (result.ok) return result;
    if (result.error.kind !== 'validation') return result;
    if (result.error.reason === 'ring is not inside a polygon exterior') genericFailure ??= result;
    else specificFailure ??= result;
  }
  return (
    specificFailure ??
    genericFailure ??
    Err.validation('ring', 'ring is not inside a polygon exterior')
  );
}
```

3. Migrate `rings.test.ts` stubs per the "Test stub migration" note above.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/map/ops/rings.test.ts && pnpm typecheck`
Expected: ALL PASS — old behavior assertions unchanged, new direct-edit tests green.

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/geometry-2d.ts src/map/ops/rings.ts src/map/ops/rings.test.ts
git commit -m "feat(ops): addRing migrates to in-place PathGeometryPatchCommand"
```

---

### Task 7: `deleteRing` migration

**Files:**
- Modify: `src/map/ops/rings.ts` (rewrite `deleteRing`)
- Test: `src/map/ops/rings.test.ts`

**Interfaces:**
- Consumes: same as Task 6.
- Produces: none new.

- [ ] **Step 1: Write the failing tests**

Append to `src/map/ops/rings.test.ts` (fixture = migrated `createFixture` from Task 6;
polygon literal with two holes so a delete can be followed by id-stability asserts):

```ts
describe('deleteRing direct edit', () => {
  const TWO_HOLES: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [8, 4],
        [9, 4],
        [9, 6],
        [8, 6],
        [8, 4],
      ], // hole A — click target [8.5, 5]
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1],
      ], // hole B
    ],
  };

  it('does not compact arcs: orphan ring arc survives, later arc ids unchanged', async () => {
    const fixture = await createFixture(undefined, undefined, TWO_HOLES);
    const arcs = fixture.dataset().arcs!;
    const arcCount = arcs.size();
    const cleanSpy = vi.spyOn(adapter, 'cleanArcReferences');
    try {
      const result = await deleteRing(fixture.ctx, { point: [8.5, 5] });
      expect(result.ok).toBe(true);
      expect(cleanSpy).not.toHaveBeenCalled();
      expect(arcs.size()).toBe(arcCount); // hole A's arc retained as orphan
      expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
    } finally {
      cleanSpy.mockRestore();
    }
    fixture.entries[0]!.undo();
    expect(exported(fixture.dataset()).coordinates).toHaveLength(3);
    expect(arcs.size()).toBe(arcCount);
    fixture.entries[0]!.do();
    expect(exported(fixture.dataset()).coordinates).toHaveLength(2);
  });

  it('addRing → deleteRing → undo × 2 / redo × 2 round-trips exactly', async () => {
    const fixture = await createFixture(); // single shell, no holes
    const ringCount = () => exported(fixture.dataset()).coordinates.length;
    const initial = ringCount();
    await addRing(fixture.ctx, {
      ring: [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
    });
    expect(ringCount()).toBe(2);
    await deleteRing(fixture.ctx, { point: [5, 5] });
    expect(ringCount()).toBe(initial);
    fixture.entries[1]!.undo(); // undo delete → hole returns
    expect(ringCount()).toBe(2);
    fixture.entries[0]!.undo(); // undo add → back to initial
    expect(ringCount()).toBe(initial);
    fixture.entries[0]!.do();
    fixture.entries[1]!.do();
    expect(ringCount()).toBe(initial);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/map/ops/rings.test.ts`
Expected: FAIL — `cleanArcReferences` still called.

- [ ] **Step 3: Migrate `deleteRing`**

Rewrite in `src/map/ops/rings.ts`:

```ts
export async function deleteRing(
  ctx: OpContext,
  options: DeleteRingOptions,
): Promise<OpResult<void>> {
  if (!isCoordinate(options.point)) return Err.validation('ring', 'point coordinates are invalid');
  const adapter = getDefaultMapshaperAdapter();
  const [px, py] = options.point;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(sourceId, 'Delete ring', (planned) => {
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Delete ring');
      const arcs = planned.arcs!;
      for (const layer of planned.layers) {
        if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
        for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
          const shape = layer.shapes[featureId] as PathShape | null;
          if (!shape?.length) continue;
          // Cheap prefilter (unchanged).
          if (!shape.some((part) => adapter.testPointInPolygon(px, py, [part], arcs))) continue;
          for (const group of collectPolygonExteriors(shape, arcs, adapter)) {
            if (!adapter.testPointInPolygon(px, py, [shape[group.exteriorIndex]!], arcs)) continue;
            const ringIndex = group.holeIndexes.find((holeIndex) =>
              adapter.testPointInPolygon(px, py, [shape[holeIndex]!], arcs),
            );
            if (ringIndex === undefined) continue;
            const shapeError = validateTargetShape(shape, arcs, adapter);
            if (shapeError) return shapeError;
            // Shape patch only: the ring's arc stays in the collection as an
            // orphan (reclaimed on export compaction / future clean op) so
            // arc ids captured by other history entries never shift.
            const afterShape = shape.filter((_, index) => index !== ringIndex);
            return {
              value: undefined,
              affectedSourceIds: [sourceId],
              command: new PathGeometryPatchCommand({
                source,
                shapePatches: [{ layer, featureId, before: shape, after: afterShape }],
                originalArcCount: arcs.size(),
                appendedArcs: [],
                selection: ctx.host._selection,
                beforeSelection: ctx.host._selection.snapshot(),
                afterSelection: ctx.host._selection.getAll(),
                publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
                label: 'Delete ring',
              }),
            };
          }
        }
      }
      return Err.validation('ring', 'no ring contains the point');
    });
    if (result.ok) return result;
    if (result.error.kind !== 'validation') return result;
  }
  return Err.validation('ring', 'no ring contains the point');
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/map/ops/rings.test.ts && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/rings.ts src/map/ops/rings.test.ts
git commit -m "feat(ops): deleteRing migrates to shape-patch command without arc compaction"
```

---

### Task 8: `addPart` migration

**Files:**
- Modify: `src/map/ops/parts.ts` (rewrite `addPart`; delete the now-unused `appendPart` helper)
- Test: `src/map/ops/parts.test.ts` (stub migration per Task 6 note + new tests)

**Interfaces:**
- Consumes: `ctx.runPreparedEditCommand`, `PathGeometryPatchCommand`, `coordinatesToArcSnapshot`.
- Produces: none new.

- [ ] **Step 1: Write the failing test**

First apply the Task 6 stub migration to `parts.test.ts`'s `createFixture`
(`parts.test.ts:36-71`): replace the `runPreparedDatasetMutation` ctx field with the
`runPreparedEditCommand` fake from Task 6, return `entries`, and swap the
`_selection: { getAll: () => refs }` stub for a real `Selection` primed with
`selection.apply(refs, 'replace')`. Then append:

```ts
describe('addPart direct edit', () => {
  const NEW_PART: [number, number][] = [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ];

  it('commits in place; undo/redo stable across rounds; arc count stable', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    const arcs = fixture.dataset().arcs!;
    const originalArcCount = arcs.size();
    const partCount = () => fixture.dataset().layers[0]!.shapes![0]!.length;
    const copySpy = vi.spyOn(adapter, 'copyDataset');
    try {
      const result = await addPart(fixture.ctx, { coordinates: NEW_PART });
      expect(result.ok).toBe(true);
      expect(copySpy).not.toHaveBeenCalled();
    } finally {
      copySpy.mockRestore();
    }
    expect(partCount()).toBe(2);
    expect(arcs.size()).toBe(originalArcCount + 1);
    expect(fixture.entries).toHaveLength(1);

    fixture.entries[0]!.undo();
    expect(partCount()).toBe(1);
    expect(arcs.size()).toBe(originalArcCount);
    fixture.entries[0]!.do();
    fixture.entries[0]!.undo();
    fixture.entries[0]!.do();
    expect(partCount()).toBe(2); // no drift across rounds
    expect(arcs.size()).toBe(originalArcCount + 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/map/ops/parts.test.ts`
Expected: FAIL — `copyDataset` still called by the old path (plus stub-seam failures until Step 3).

- [ ] **Step 3: Migrate `addPart`**

In `src/map/ops/parts.ts`:

1. Add imports: `PathGeometryPatchCommand` from `../../edit/commands/path-geometry-patch`, `coordinatesToArcSnapshot` from `./geometry-2d`.

2. Rewrite `addPart`:

```ts
export async function addPart(ctx: OpContext, options: AddPartOptions): Promise<OpResult<void>> {
  const normalized = normalizePart(options.coordinates, false);
  if (!normalized)
    return Err.validation('part', 'part coordinates must contain at least two points');
  const refs = ctx.host._selection.getAll();
  const selected = selectPath(ctx, refs);
  if (isFailure(selected)) return selected;
  const polygon = selected.layer.geometry_type === 'polygon';
  const part = polygon ? normalizePart(normalized, true) : normalized;
  if (!part) return Err.validation('part', 'part coordinates must form a ring');
  if (!selected.dataset.arcs)
    return Err.validation('selection', 'selected path geometry is invalid');
  const adapter = getDefaultMapshaperAdapter();
  return ctx.runPreparedEditCommand(selected.sourceId, 'Add part', (planned, source) => {
    if (planned !== selected.dataset)
      return Err.staleOperation(selected.sourceId, 'Add part');
    const arcs = planned.arcs;
    // Planned dataset IS the live one: resolve the layer in-place.
    const layer = ctx.host.layers.resolveInLayers(planned.layers, selected.layerId);
    if (
      !layer ||
      !isPathLayer(layer) ||
      layer.geometry_type !== selected.layer.geometry_type ||
      !layer.shapes ||
      !arcs
    )
      return Err.staleOperation(selected.sourceId, 'Add part');
    const shape = layer.shapes[selected.featureId] as PathShape | null;
    if (!shape) return Err.staleOperation(selected.sourceId, 'Add part');
    const shapeError = polygon ? validatePolygonShape(shape, arcs, adapter) : null;
    if (shapeError) return shapeError;
    const validation = polygon
      ? validateNewPolygon(part, shape, arcs, adapter)
      : validateNewLine(part, shape, arcs);
    if (validation) return Err.validation('part', validation);
    // Orientation rule unchanged: polygon parts are stored reversed.
    const stored = polygon ? [...part].reverse() : part;
    const afterShape = shape.concat([[arcs.size()]]);
    return {
      value: undefined,
      affectedSourceIds: [selected.sourceId],
      command: new PathGeometryPatchCommand({
        source,
        shapePatches: [{ layer, featureId: selected.featureId, before: shape, after: afterShape }],
        originalArcCount: arcs.size(),
        appendedArcs: [coordinatesToArcSnapshot(stored)],
        selection: ctx.host._selection,
        beforeSelection: ctx.host._selection.snapshot(),
        afterSelection: refs,
        publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
        label: 'Add part',
      }),
    };
  });
}
```

3. Delete the now-unused `appendPart` helper (lines ~208-217).

4. Migrate `parts.test.ts` stubs per the Task 6 note.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/map/ops/parts.test.ts && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/parts.ts src/map/ops/parts.test.ts
git commit -m "feat(ops): addPart migrates to in-place PathGeometryPatchCommand"
```

---

### Task 9: Highlight layer-clearing infrastructure

**Files:**
- Modify: `src/map/highlight-manager.ts` (add `removeLayer`)
- Modify: `src/map/emap-host.ts` (add optional `_clearHighlightsForLayer?`)
- Modify: `src/map/map.ts` (implement `_clearHighlightsForLayer` next to `_invalidateShapeCachesForSources`, ~line 2379)
- Test: `src/map/highlight-manager.test.ts` (extend the existing `HighlightManager state` suite)

**Interfaces:**
- Produces (Task 10 consumes):

```ts
// HighlightManager
removeLayer(sourceId: string, layerId: string): boolean;
// EmapHostInternal (optional so existing stub hosts keep compiling)
_clearHighlightsForLayer?(sourceId: string, layerKeys: readonly string[]): void;
```

- [ ] **Step 1: Write the failing test**

Append to the `describe('HighlightManager state', ...)` suite in `src/map/highlight-manager.test.ts`
(the file's existing entries pass `{ source, layer, id, geometryType, properties }` objects —
mirror that shape):

```ts
  it('removeLayer drops every highlight pinned to one layer only', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 's', layer: 'a', id: 0, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'a', id: 1, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'b', id: 2, geometryType: 'polygon', properties: {} },
    ]);
    expect(h.removeLayer('s', 'a')).toBe(true);
    expect(h.removeLayer('s', 'a')).toBe(false); // already gone
    expect(h.removeLayer('s', 'b')).toBe(true); // sibling layer unaffected until removed
    expect(h.size).toBe(0);
  });

  it('removeLayer removes the source bucket when its last layer is dropped', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 's', layer: 'a', id: 0, geometryType: 'polygon', properties: {} },
    ]);
    expect(h.removeLayer('s', 'a')).toBe(true);
    expect(h.size).toBe(0);
    expect(h.removeLayer('s', 'a')).toBe(false);
  });
```

No Emap-level wiring test: the Emap→HighlightManager glue is a 3-line loop covered by
typecheck, and the observable op-level contract (deletePart calls the host hook) is
asserted in Task 10.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/map/highlight-manager.test.ts`
Expected: FAIL — `h.removeLayer is not a function`.

- [ ] **Step 3: Implement**

1. `src/map/highlight-manager.ts`, after `removeSource`:

```ts
  /** Drop every highlight pinned to `layerId` under `sourceId`. */
  removeLayer(sourceId: string, layerId: string): boolean {
    const byLayer = this._highlighted.get(sourceId);
    if (!byLayer) return false;
    const removed = byLayer.delete(layerId);
    if (byLayer.size === 0) this._highlighted.delete(sourceId);
    return removed;
  }
```

2. `src/map/emap-host.ts`, in the shared-services block after `_clearSpatialIndexesForSources`:

```ts
  /**
   * Clear highlights pinned to a layer whose feature ids just shifted
   * (feature deletion). Optional so stub hosts in tests need not stub it;
   * managers must call it defensively (`?.`).
   */
  _clearHighlightsForLayer?(sourceId: string, layerKeys: readonly string[]): void;
```

3. `src/map/map.ts`, next to `_invalidateShapeCachesForSources` (~line 2379):

```ts
  _clearHighlightsForLayer(sourceId: string, layerKeys: readonly string[]): void {
    for (const key of layerKeys) this._highlightManager.removeLayer(sourceId, key);
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/map/highlight-manager.test.ts && pnpm typecheck`
Expected: ALL PASS; typecheck clean (optional host method keeps stub hosts compiling).

- [ ] **Step 5: Commit**

```bash
git add src/map/highlight-manager.ts src/map/emap-host.ts src/map/map.ts src/map/highlight-manager.test.ts
git commit -m "feat(map): per-layer highlight clearing for feature-id-shifting edits"
```

---

### Task 10: `deletePart` migration (incl. last-part feature deletion + highlight clear)

**Files:**
- Modify: `src/map/ops/parts.ts` (rewrite `deletePart`)
- Test: `src/map/ops/parts.test.ts`

**Interfaces:**
- Consumes: `PathGeometryPatchCommand` (Task 3), `FeatureDeleteWithSelectionCommand` (Task 4), `ctx.host._clearHighlightsForLayer?.` (Task 9), existing `selectionAfterFeatureRemoval` / `refMatchesLayer` helpers (same file).
- Produces: none new.

- [ ] **Step 1: Write the failing tests**

Append to `src/map/ops/parts.test.ts` (fixture = migrated `createFixture` from Task 8 —
real `Selection`, `entries` recorded; `layer.data` comes from the GeoJSON `properties`
that `runImport` turns into an attribute table):

```ts
describe('deletePart direct edit', () => {
  const MULTI_PART: GeoJSON.MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ], // part 0
      [
        [
          [20, 0],
          [30, 0],
          [30, 10],
          [20, 10],
          [20, 0],
        ],
      ], // part 1 — click target [25, 5]
    ],
  };

  it('deleting one of several parts patches the shape without arc compaction', async () => {
    const fixture = await createFixture(MULTI_PART);
    const arcs = fixture.dataset().arcs!;
    const arcCount = arcs.size();
    const partCount = () => fixture.dataset().layers[0]!.shapes![0]!.length;
    const cleanSpy = vi.spyOn(adapter, 'cleanArcReferences');
    try {
      const result = await deletePart(fixture.ctx, { point: [25, 5] });
      expect(result.ok).toBe(true);
      expect(cleanSpy).not.toHaveBeenCalled();
      expect(arcs.size()).toBe(arcCount); // deleted part's arc retained as orphan
      expect(partCount()).toBe(1);
    } finally {
      cleanSpy.mockRestore();
    }
    fixture.entries[0]!.undo();
    expect(partCount()).toBe(2);
    expect(arcs.size()).toBe(arcCount);
  });

  it('deleting the last part removes feature row, record, selection — all restored by undo', async () => {
    const fixture = await createFixture({ type: 'Polygon', coordinates: [square] });
    const highlight = vi.fn();
    (fixture.ctx.host as any)._clearHighlightsForLayer = highlight;
    const layer = fixture.dataset().layers[0]!;
    const result = await deletePart(fixture.ctx, { point: [5, 5] });
    expect(result.ok).toBe(true);
    expect(layer.shapes).toHaveLength(0);
    expect(layer.data!.getRecords()).toHaveLength(0);
    expect(fixture.ctx.host._selection.getAll()).toEqual([]);
    expect(highlight).toHaveBeenCalledWith('source', expect.arrayContaining(['parts']));

    fixture.entries[0]!.undo();
    expect(layer.shapes).toHaveLength(1);
    expect(layer.data!.getRecords()).toHaveLength(1);
    expect(fixture.ctx.host._selection.getAll()).toEqual([
      { source: 'source', layer: 'parts', id: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/map/ops/parts.test.ts`
Expected: FAIL — old path still compacts / replaces.

- [ ] **Step 3: Migrate `deletePart`**

Rewrite in `src/map/ops/parts.ts` (add import: `FeatureDeleteWithSelectionCommand` from `../../edit/commands/feature-delete`):

```ts
export async function deletePart(
  ctx: OpContext,
  options: DeletePartOptions,
): Promise<OpResult<void>> {
  if (!isCoordinate(options.point)) return Err.validation('part', 'point coordinates are invalid');
  const adapter = getDefaultMapshaperAdapter();
  const tolerance = options.tolerance ?? 0;
  let searchedPolygon = false;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    // Track the deleted feature's layer keys across the planner boundary so
    // highlights can be cleared after a successful commit.
    let deletedFeatureLayerKeys: readonly string[] | null = null;
    const result = await ctx.runPreparedEditCommand(sourceId, 'Delete part', (planned) => {
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Delete part');
      const arcs = planned.arcs!;
      for (let layerIndex = 0; layerIndex < planned.layers.length; layerIndex++) {
        const layer = planned.layers[layerIndex]!;
        if (
          !isPathLayer(layer) ||
          (layer.geometry_type !== 'polygon' && layer.geometry_type !== 'polyline') ||
          !layer.shapes
        )
          continue;
        const polygon = layer.geometry_type === 'polygon';
        if (polygon) searchedPolygon = true;
        for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
          const shape = layer.shapes[featureId] as PathShape | null;
          if (!shape?.length) continue;
          const index = polygon
            ? polygonPartIndex(options.point, shape, arcs, adapter)
            : (() => {
                const closest = closestPartIndex(options.point, shape, arcs, adapter);
                return closest && closest.distance <= tolerance ? closest.index : -1;
              })();
          if (index === -1) continue;
          if (polygon) {
            const shapeError = validatePolygonShape(shape, arcs, adapter);
            if (shapeError) return shapeError;
          }
          const beforeSelection = ctx.host._selection.snapshot();
          const currentRefs = ctx.host._selection.getAll();
          if (shape.length > 1) {
            // Shape patch only — the part's arc stays as an orphan.
            const afterShape = shape.filter((_, partIndex) => partIndex !== index);
            return {
              value: undefined,
              affectedSourceIds: [sourceId],
              command: new PathGeometryPatchCommand({
                source,
                shapePatches: [{ layer, featureId, before: shape, after: afterShape }],
                originalArcCount: arcs.size(),
                appendedArcs: [],
                selection: ctx.host._selection,
                beforeSelection,
                afterSelection: currentRefs,
                publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
                label: 'Delete part',
              }),
            };
          }
          // Last part: the whole feature (row + attribute record) goes away
          // and every later feature id in the layer shifts down by one.
          deletedFeatureLayerKeys = [
            getLayerId(layer, layerIndex),
            ...(layer.name ? [String(layer.name)] : []),
            ...(layer.id ? [String(layer.id)] : []),
          ];
          return {
            value: undefined,
            affectedSourceIds: [sourceId],
            command: new FeatureDeleteWithSelectionCommand({
              layer,
              featureId,
              shape,
              record: layer.data?.getRecords?.()[featureId] ?? null,
              source,
              selection: ctx.host._selection,
              beforeSelection,
              afterSelection: selectionAfterFeatureRemoval(
                currentRefs,
                sourceId,
                layer,
                layerIndex,
                featureId,
              ),
              publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
              label: 'Delete part',
            }),
          };
        }
      }
      return Err.validation('part', 'no part contains the point');
    });
    if (result.ok) {
      if (deletedFeatureLayerKeys) {
        ctx.host._clearHighlightsForLayer?.(sourceId, deletedFeatureLayerKeys);
      }
      return result;
    }
    if (result.error.kind !== 'validation') return result;
  }
  return Err.validation(
    'part',
    searchedPolygon ? 'no part contains the point' : 'no part near the point',
  );
}
```

(The `getLayerId` import already exists in parts.ts. `searchedPolygon` is a closure mutated during planning — same as the current implementation.)

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/map/ops/parts.test.ts && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/ops/parts.ts src/map/ops/parts.test.ts
git commit -m "feat(ops): deletePart migrates to in-place commands with feature-delete wrapper"
```

---

### Task 11: Transaction rollback — reverse-order command undo

**Files:**
- Modify: `src/edit/transaction.ts` (`rollback()`)
- Test: `src/edit/transaction.test.ts` (extend)

**Interfaces:**
- Consumes: `EditHistory.endCapture()` returning the captured buffer (already exists), commands' `undo()`.
- Produces: none new. Behavior contract: rollback of direct (in-place) commands actually reverts geometry.

- [ ] **Step 1: Write the failing tests**

Append to `src/edit/transaction.test.ts`:

```ts
describe('rollback with in-place (direct) commands', () => {
  function makeRollbackHost(source: { getDataset(): any; setDataset(d: any): void }) {
    return {
      _removed: false,
      _sources: new Map([['s', source]]),
      _history: new EditHistory(),
      _selection: new Selection(),
      _activeTransaction: null as any,
      _fireHistoryChange: vi.fn(),
      _fireSelectionChange: vi.fn(),
      _scheduleRender: vi.fn(),
    } as any;
  }

  it('reverse-undoes captured commands instead of relying on dataset snapshots', () => {
    // The dataset is a plain object mutated IN PLACE by the fake direct
    // commands — the snapshot the transaction holds is the same reference,
    // so only reverse-order undo() can revert it.
    const dataset: any = { layers: [], arcs: null, editVersion: 0, marker: 0 };
    const source = { getDataset: () => dataset, setDataset: vi.fn() };
    const host = makeRollbackHost(source);
    const t = new Transaction(host);
    host._activeTransaction = t;
    t._captureFirstTouch('s', dataset); // runner behavior for direct ops
    const order: string[] = [];
    const directA = {
      label: 'A',
      do: () => { dataset.marker = 1; },
      undo: () => { order.push('undoA'); dataset.marker = 0; },
    };
    const directB = {
      label: 'B',
      do: () => { dataset.marker = 2; },
      undo: () => { order.push('undoB'); dataset.marker = 1; },
    };
    host._history.push(directA); // diverted to capture buffer
    host._history.push(directB);
    directA.do();
    directB.do();
    t.rollback();
    expect(order).toEqual(['undoB', 'undoA']); // strict reverse order
    expect(dataset.marker).toBe(0); // in-place state actually reverted
    expect(host._history.size()).toBe(0);
    // Snapshot re-attach still happens (acts as data notification for the source).
    expect(source.setDataset).toHaveBeenCalledWith(dataset);
  });

  it('replacement-only rollback keeps working exactly as before', () => {
    const before: any = { layers: [], marker: 'before' };
    const after: any = { layers: [], marker: 'after' };
    let live = before;
    const source = { getDataset: () => live, setDataset: vi.fn((d: any) => { live = d; }) };
    const host = makeRollbackHost(source);
    const t = new Transaction(host);
    host._activeTransaction = t;
    t._captureFirstTouch('s', before);
    const replacement = {
      label: 'R',
      invalidatesPriorCommands: true,
      do: () => { live = after; },
      undo: () => { live = before; },
    };
    replacement.do();
    host._history.push(replacement);
    t.rollback();
    expect(live).toBe(before);
    expect(host._history.size()).toBe(0);
  });
});
```

(File-head imports for this suite: `import { EditHistory } from './edit-history';`,
`import { Selection } from '../map/selection';` — `transaction.test.ts` already imports
`Transaction` and `vi`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/edit/transaction.test.ts`
Expected: the first test FAILS (today's rollback discards the buffer without undoing; `dataset.marker` stays 2). The second may already pass — keep it as a regression guard.

- [ ] **Step 3: Implement**

In `src/edit/transaction.ts`, replace the `rollback()` body up to the selection restore:

```ts
  rollback(): void {
    this._end();
    // Drain the capture buffer and reverse every captured command in
    // reverse order. This is the only correct rollback path for in-place
    // (direct) commands: they mutate the very dataset object the snapshots
    // below reference, so `setDataset(snapshot)` alone cannot revert them.
    // For replacement commands, undo() re-attaches the pre-op dataset —
    // equivalent to the snapshot restore that follows — so existing
    // behavior is preserved.
    const cmds = this._host._history.endCapture();
    for (let i = cmds.length - 1; i >= 0; i--) {
      try {
        cmds[i]!.undo();
      } catch (error) {
        // Best effort, but observable (user-adjudicated during review):
        // log each failure and continue — rollback() stays a total
        // function; replacement-touched sources are still recovered by
        // the snapshot restore below.
        console.error(`emap: rollback could not undo "${cmds[i]!.label}"; in-place state may be partially reverted`, error);
      }
    }
    // Restore every touched source's dataset to its first-touch snapshot.
    // For sources touched only by direct commands the snapshot IS the live
    // object; re-attaching it is a no-op mutation-wise and doubles as the
    // 'data' notification + DisplayArcs rebuild for the in-place rollback.
    for (const [sourceId, before] of this._datasetSnapshots) {
      const source = this._host._sources.get(sourceId);
      if (source) source.setDataset(before);
    }
    // ... selection restore / events unchanged
```

Also update the file-top comment block item 4 (rollback description) to mention reverse-order command undo.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/edit/ && pnpm typecheck`
Expected: ALL PASS — including the pre-existing transaction/edit-history suites (no regressions in capture/commit/barrier behavior).

- [ ] **Step 5: Commit**

```bash
git add src/edit/transaction.ts src/edit/transaction.test.ts
git commit -m "fix(edit): transaction rollback reverse-undoes captured commands"
```

---

### Task 12: MSX export compacts a copy

**Files:**
- Modify: `src/source/topology-source.ts` (`export()`, lines ~744-757)
- Test: `src/source/topology-source.test.ts` (extend)

**Interfaces:**
- Consumes: `adapter.copyDataset`, `adapter.cleanArcReferences` (both exist).
- Produces: none new. Behavior contract: MSX output never contains orphan arcs; live dataset is never compacted.

- [ ] **Step 1: Write the failing test**

```ts
it('msx export serializes a compacted copy, leaving the live dataset untouched', async () => {
  const adapter = getDefaultMapshaperAdapter();
  const source = new TopologySource('msx-orphan');
  await source.setData({
    filename: 'a.geojson',
    content: new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
                ],
              ],
            },
          },
        ],
      }),
    ),
  });
  const live = source.getDataset()!;
  const liveArcCount = live.arcs!.size();
  // Append an unreferenced (orphan) arc directly to the live collection.
  adapter.appendArc(live.arcs!, [
    [5, 5],
    [6, 6],
  ]);
  expect(live.arcs!.size()).toBe(liveArcCount + 1);

  // Note: TopologySource stores the adapter as `this._adapter`. If it holds the
  // process-wide singleton (getDefaultMapshaperAdapter()), spying on `adapter`
  // here intercepts the call; if a future refactor hands sources their own
  // instance, spy on `getPrivate(source, '_adapter')` instead.
  const seen: number[] = [];
  const spy = vi
    .spyOn(adapter, 'exportPackedDatasets')
    .mockImplementation(async (datasets: any[]) => {
      seen.push(datasets[0].arcs.size());
      expect(datasets[0]).not.toBe(live); // must be a copy
      return [{ filename: 'a.msx', content: new Uint8Array([0]) }];
    });
  try {
    await source.export({ format: 'msx' });
  } finally {
    spy.mockRestore();
  }
  expect(seen).toEqual([liveArcCount]); // orphan compacted away in the copy
  expect(live.arcs!.size()).toBe(liveArcCount + 1); // live dataset untouched
});
```

(Match the exact `setData`/`export` options signatures to the existing tests in `topology-source.test.ts` — e.g. `export` may require additional `ExportOptions` fields; copy them from a neighboring export test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/source/topology-source.test.ts`
Expected: FAIL — `datasets[0]` is the live dataset and carries the orphan arc.

- [ ] **Step 3: Implement**

In `src/source/topology-source.ts`, replace the MSX branch of `export()`:

```ts
      const adapter = this._adapter;
      let files;
      if (options.format === 'msx') {
        // MSX packs the raw arc table; `compact: true` only gzip-compresses
        // vertex buffers and does NOT drop orphan arcs left behind by direct
        // edits. Serialize a compacted copy so history lifetime never forces
        // live-dataset arc compaction (which would invalidate captured ids).
        const copy = adapter.copyDataset(this._dataset);
        adapter.cleanArcReferences(copy);
        files = await adapter.exportPackedDatasets([copy], { compact: true });
      } else {
        // GeoJSON iterates shapes (orphans drop out naturally); TopoJSON
        // export dissolves arcs on its own copy. Both stay untouched.
        files = adapter.exportFileContent(this._dataset, { format: options.format });
      }
      return this._filesToBlob(files, options.format);
```

(Keep the surrounding simplification-floor save/restore `try/finally` exactly as-is.)

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/source/topology-source.test.ts && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/source/topology-source.ts src/source/topology-source.test.ts
git commit -m "fix(source): msx export serializes a compacted dataset copy"
```

---

### Task 13: Barrier identity probe test + docs + CHANGELOG + full verification

**Files:**
- Test: `src/map/ops/rings.test.ts` (one barrier identity probe test, via `integrationHarness`)
- Modify: `packages/docs/docs/guides/editing.md` + `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md` (only if they claim single-level undo for ring/part edits — verify with grep first)
- Modify: `CHANGELOG.md`
- Sanity: `packages/examples/examples/reshape-ring-part/index.html` (manual smoke in a browser session if one is available; otherwise covered by op-level tests)

**Interfaces:**
- Consumes: everything above.
- Produces: none new.

- [ ] **Step 1: Write the barrier identity probe test (observation only — do NOT narrow the barrier)**

Append to `src/map/ops/rings.test.ts`. Uses the file's `integrationHarness` (real
`MapshaperOps` → real `_runner` commit paths) with its fake history swapped for a real
`EditHistory`, and drives the replacement side through the real shared runner
`_runPreparedDatasetMutation` (imported from `./_runner`):

```ts
it('barrier probe: direct → replacement → undo replacement restores captured identity', async () => {
  const dataset = await importDataset({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  });
  dataset.layers[0]!.name = 'rings';
  const harness = integrationHarness(dataset);
  const realHistory = new EditHistory(); // import from '../../edit/edit-history'
  (harness.ops as any)._emap._history = realHistory;

  const liveBefore = harness.source.getDataset();
  await expect(
    harness.ops.addRing({ ring: [[3, 3], [7, 3], [7, 7], [3, 7]] }),
  ).resolves.toMatchObject({ ok: true });
  expect(harness.source.getDataset()).toBe(liveBefore); // in-place: same identity
  expect(realHistory.size()).toBe(1);

  // Replacement through the real prepared-mutation runner (no-op mutation,
  // but the commit path pushes a DatasetReplaceSelectionCommand barrier).
  const result = await _runPreparedDatasetMutation(
    (harness.ops as any)._emap,
    'source',
    'Probe replace',
    () => ({ value: undefined, selection: [] }),
  );
  expect(result.ok).toBe(true);
  expect(realHistory.size()).toBe(2); // stale placeholder + barrier command
  expect(realHistory.snapshot().staleCount).toBe(1);

  realHistory.undo(); // undo replacement: re-attaches the exact pre-replace object
  expect(harness.source.getDataset()).toBe(liveBefore);
  // Barrier semantics unchanged: the direct command below the placeholder is
  // skipped, not replayed — the hole stays on the map. This pins CURRENT
  // behavior; narrowing the barrier is Phase D (spec §16.6).
  realHistory.undo();
  expect(realHistory.snapshot().skippedStale).toBe(true);
  expect(exported(harness.source.getDataset()).coordinates).toHaveLength(2);
});
```

- [ ] **Step 2: Run test**

Run: `pnpm exec vitest run src/map/ops/rings.test.ts`
Expected: PASS (documents current barrier semantics; if it reveals a real bug, stop and report — do not patch around it).

- [ ] **Step 3: Docs**

Run: `grep -n -i "undo\|撤回\|撤销" packages/docs/docs/guides/editing.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md`
If either guide claims ring/part edits only support single-step undo, update the paragraph: ring/part edits now stack as multi-level undo entries; global spatial operations (clip/dissolve/…) remain history barriers. If no such claim exists, no doc change.

- [ ] **Step 4: CHANGELOG**

Add to `CHANGELOG.md` under the unreleased section (create `## [Unreleased]` if absent):

```markdown
### Changed
- Ring/part editing ops (`addRing`, `deleteRing`, `addPart`, `deletePart`) now commit in-place reversible commands instead of whole-dataset replacement: consecutive local edits support multi-level undo/redo, no per-op dataset clone, and deleting a ring/part no longer compacts the arc collection. MSX snapshot export serializes a compacted copy so orphan arcs never bloat the file.

### Fixed
- Transaction rollback now reverse-undoes captured commands, so in-place edits staged inside a transaction are actually reverted (previously only dataset-replacing ops rolled back correctly).
```

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm exec vitest run`
Expected: typecheck clean; FULL suite green (pay attention to `edit-sessions`, `split-selected*`, `merge-selected`, `map.test.ts` history tests — they share the fixtures touched in Tasks 5-6).

- [ ] **Step 6: Commit**

```bash
git add src/map/ops/rings.test.ts CHANGELOG.md packages/docs/docs/guides/editing.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md
git commit -m "docs: multi-level undo for ring/part edits; barrier identity probe test"
```
