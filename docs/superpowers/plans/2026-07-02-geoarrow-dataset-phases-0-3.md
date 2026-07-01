# GeoArrow Dual-Representation Dataset — Phases 0–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring master's GeoArrow/DuckDB capabilities onto `feat/webgl-painter-luma`, upgrade to luma.gl v10, and add the revision-stamped Arrow-table cache to `TopologySource` so unedited data flows to DuckDB and export with zero conversion.

**Architecture:** Topology (`MapshaperDataset`/`ArcCollection`) stays the single source of truth. A monotonic `_dataRevision` counter on `TopologySource` bumps on every committed data change; Arrow tables are derived caches keyed by `(layer, encoding)` and validated against that counter. The formats bundle registers a table converter into the existing `format-registry` global-slot mechanism so the core bundle never imports apache-arrow.

**Tech Stack:** TypeScript, mapshaper, apache-arrow, @duckdb/duckdb-wasm, luma.gl v10 (`@luma.gl/core|engine|webgl|arrow`), vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-geoarrow-dataset-design.md` (phases 4–6 get their own plan after this one lands).

## Global Constraints

- Topology is authoritative; edits NEVER write into Arrow buffers (no dual-write).
- The core bundle must not import `apache-arrow` — Arrow values cross the core boundary as `unknown` via the `format-registry` global-slot pattern (`Symbol.for(...)` on `globalThis`).
- luma.gl v10 is pre-release: pin **exact** versions (no `^`).
- Do not import `mapshaper` outside `src/adapter/mapshaper-adapter.ts` (repo rule).
- Existing Canvas behavior and all existing tests stay green after every task.
- Derived Arrow tables must always carry full-detail coordinates: any rebuild must reset the render-LOD retained interval around the conversion (same save/reset/restore pattern as `TopologySource.export`).
- Verification commands: `npm run typecheck`, `npm run test:run`, `npm run build` (DuckDB integration suite: `npm run test:duckdb`).
- Commit format: `<type>: <description>`, no attribution footer.

## Pre-existing facts the implementer needs

- Branch `feat/webgl-painter-luma` (13 commits) adds `src/renderer/webgl*`, painter-factory, and render-revision plumbing. Master (131 commits ahead of merge-base `1a24365`) adds `src/formats/`, `src/duckdb/`, format-registry, and reworked map/source/vertex-edit files.
- Conflict candidates (changed on BOTH sides): `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `rollup.config.mjs`, `src/core/handlers/vertex-edit.ts` + `.test.ts`, `src/index.ts`, `src/map/map.ts` + `.test.ts`, `src/map/types.ts`, `src/source/display-arcs.ts` + `.test.ts`, `src/source/source.ts`, `src/source/topology-source.ts` + `.test.ts`.
- Post-merge `TopologySource` already has `_renderRevision` / `getRenderRevision()` / `_bumpRenderRevision()` (branch-side). `_bumpRenderRevision` fires from `_updateData`, `reproject`, `markDisplayArcsDirty`, `refreshDisplayArcs`, `setDataset`. The two `DisplayArcs` methods fire per-frame during drags — that is why data revision is a SEPARATE counter.
- `EditHistory` (`src/edit/edit-history.ts`): `push(cmd)` records an already-applied command; `undo()`/`redo()` invoke `cmd.undo()`/`cmd.do()`. Map wraps these as `Emap.pushCommand` / `undo()` / `redo()` (`src/map/map.ts`). Map's source registry is `this._sources: Map<string, TopologySource>`.
- `src/source/format-registry.ts` shares plugin state across bundles via `Symbol.for('emap.formatRegistry')` on `globalThis`. `TopologySource._updateData` routes plugin extensions through `getFormatForExtension(ext)` → `plugin.importBinary(content, pluginFile)`.
- `src/formats/index.ts` registers the `'geoarrow-formats'` plugin (side effect on import) with `importBinary` and `exportFormats: { geoparquet, geoarrow }`.
- `toArrowTable(dataset, opts)` (`src/formats/dataset-to-table.ts`) options: `{ encoding?: 'native'|'wkb', layer?: number|string, geometryColumn?: string, ... }`. It reads coordinates through `adapter.exportPathData` on the live arcs — hence the retained-interval constraint above.
- DuckDB ops convert with `encoding: 'wkb'` (`processGeometryWithDuckDb` in `src/duckdb/duckdb-geometry-op.ts`); rendering/GeoArrow export use `'native'`. This is why the cache is keyed by encoding.
- `src/duckdb/map-op.ts`: every `duckDb*Layer(ctx, opts)` op reads input through the shared `readInputDataset(ctx, src)` helper and writes results through `ctx.setSourceDataset(sourceId, dataset)`. `DuckDbMapOpContext` is implemented by the app/example, not by Map.

---

### Task 1: Merge master into feat/webgl-painter-luma

**Files:**
- Modify: the 15 conflict candidates listed above (merge resolution)
- No new files

**Interfaces:**
- Produces: a branch where `src/formats/`, `src/duckdb/`, `src/source/format-registry.ts` (master) coexist with `src/renderer/webgl*`, `painter-factory` (branch); all subsequent tasks assume this state.

- [ ] **Step 1: Start the merge**

```bash
git checkout feat/webgl-painter-luma
git merge master
```

Expected: conflict list matching (a subset of) the 15 candidates.

- [ ] **Step 2: Resolve conflicts file-by-file with these rules**

Both sides' changes are intended; this is a union merge, not a pick-a-side merge:

- `package.json`: keep BOTH dependency sets — branch adds `@luma.gl/core|engine|webgl`, `@math.gl/polygon`, `earcut`; master adds `apache-arrow`, `@duckdb/duckdb-wasm`, `parquet-wasm` (verify actual names against each side's hunk). Union `scripts`, `exports` and `files` entries.
- `package-lock.json` / `pnpm-lock.yaml`: do NOT hand-merge. Take either side, then regenerate in Step 3.
- `rollup.config.mjs`: union of build targets — master's formats/duckdb bundles + branch's geometry-worker bundle.
- `src/index.ts`: union of exports (branch: painter-factory/webgl types; master: formats/duckdb/DX exports).
- `src/map/map.ts`: master's structure wins (it was heavily reworked); re-apply the branch's additions on top — WebGL painter wiring, renderer switching, revision pass-through to the painter (`setArcRenderRevision` / `setPointRenderRevision` calls), and invalidation hooks.
- `src/core/handlers/vertex-edit.ts`: master's structure wins; re-apply branch additions — spatial prefilter of snap candidates and the `markDisplayArcsDirty` drag path.
- `src/source/topology-source.ts`, `src/source/source.ts`, `src/source/display-arcs.ts`, `src/map/types.ts`: take master's version, re-add the branch's render-revision members (`_renderRevision`, `getRenderRevision`, `_bumpRenderRevision` and its call sites) and any branch-added interface fields.
- Test files: union — keep both sides' test cases.

- [ ] **Step 3: Regenerate lockfiles**

```bash
npm install
```

Expected: lockfile consistent with the merged `package.json`, `node_modules` installs cleanly.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run test:run && npm run build
```

Expected: all green. Typecheck failures here are almost always missed branch re-applications in `map.ts`/`topology-source.ts` — fix by re-checking the branch-side hunk (`git diff 1a24365..HEAD@{1} -- <file>` shows what the branch had added).

- [ ] **Step 5: Commit the merge**

```bash
git add -A
git commit   # completes the merge; default merge message is fine
```

---

### Task 2: Upgrade luma.gl to v10 and add @luma.gl/arrow

**Files:**
- Modify: `package.json`, `src/renderer/webgl-painter.ts`, `src/renderer/webgl/models.ts`, `src/renderer/webgl/shaders.ts` (breakage sites; exact set depends on v10 API drift)

**Interfaces:**
- Produces: luma v10 pinned; `@luma.gl/arrow` available for the phase-4 plan. No behavior change in this plan.

- [ ] **Step 1: Discover and pin the latest v10 release**

```bash
npm view @luma.gl/core versions --json | tail -20
```

Pick the newest `10.0.0-*` (alpha/beta) version. Then:

```bash
npm install --save-exact @luma.gl/core@<ver> @luma.gl/engine@<ver> @luma.gl/webgl@<ver> @luma.gl/arrow@<ver>
```

Expected: `package.json` shows exact versions, no `^`.

- [ ] **Step 2: Typecheck to find breakage**

```bash
npm run typecheck
```

Expected: errors concentrated in `src/renderer/webgl-painter.ts` (Device/WebGLDevice creation, RenderPass props) and `src/renderer/webgl/models.ts` (Model/Buffer APIs). Consult the v10 upgrade guide (`https://luma.gl/docs/upgrade-guide`) for each error; do NOT restructure — mechanical API translation only.

- [ ] **Step 3: Verify tests and build**

```bash
npm run test:run && npm run build
```

Expected: all green. If a v10 API gap blocks an existing feature with no equivalent, STOP and report — do not work around silently.

- [ ] **Step 4: Manual smoke check**

Serve `test/examples/webgl-renderer.html` (see README's manual-example workflow) and confirm points/lines/fills render and renderer switching works.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer
git commit -m "chore: upgrade luma.gl to v10 and add @luma.gl/arrow"
```

---

### Task 3: Data revision counter on TopologySource + Map edit wiring

**Files:**
- Modify: `src/source/topology-source.ts`, `src/source/source.ts` (interface), `src/map/map.ts`
- Test: `src/source/topology-source.test.ts`, `src/map/map.test.ts`

**Interfaces:**
- Produces: `TopologySource.getDataRevision(): number`; `TopologySource.markDataEdited(): void`. Later tasks compare cached entries against `getDataRevision()`.
- Note: the spec calls this `getRevision()`; it is named `getDataRevision()` to avoid confusion with the existing render-only `getRenderRevision()`.

- [ ] **Step 1: Write the failing tests**

In `src/source/topology-source.test.ts` (reuse the file's existing GeoJSON-loading helpers):

```ts
describe('data revision', () => {
  it('starts at a stable value and bumps on markDataEdited', async () => {
    const source = await makeLoadedSource(); // existing helper pattern in this file
    const r0 = source.getDataRevision();
    source.markDataEdited();
    expect(source.getDataRevision()).toBe(r0 + 1);
  });

  it('bumps on setDataset', async () => {
    const source = await makeLoadedSource();
    const r0 = source.getDataRevision();
    source.setDataset(source.getDataset()!);
    expect(source.getDataRevision()).toBeGreaterThan(r0);
  });

  it('does NOT bump on markDisplayArcsDirty (per-frame drag path)', async () => {
    const source = await makeLoadedSource();
    const r0 = source.getDataRevision();
    source.markDisplayArcsDirty();
    source.refreshDisplayArcs();
    expect(source.getDataRevision()).toBe(r0);
  });
});
```

In `src/map/map.test.ts` (reuse the file's existing map+source setup helpers):

```ts
describe('data revision wiring', () => {
  it('bumps every topology source on pushCommand, undo and redo', async () => {
    const { map, source } = await makeMapWithSource(); // existing helper pattern
    const r0 = source.getDataRevision();
    const cmd = { do: () => {}, undo: () => {} };
    map.pushCommand(cmd);
    expect(source.getDataRevision()).toBe(r0 + 1);
    map.undo();
    expect(source.getDataRevision()).toBe(r0 + 2);
    map.redo();
    expect(source.getDataRevision()).toBe(r0 + 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/source/topology-source.test.ts src/map/map.test.ts
```

Expected: FAIL with `getDataRevision is not a function`.

- [ ] **Step 3: Implement TopologySource side**

In `src/source/topology-source.ts`, next to the existing `_renderRevision` members:

```ts
private _dataRevision = 0;

/**
 * Monotonic counter of committed data changes (edits, dataset replaces,
 * reprojection). Derived caches (Arrow tables, render chunks) compare
 * their stamp against this to detect staleness. Render-only churn
 * (markDisplayArcsDirty / refreshDisplayArcs) does NOT bump it.
 */
public getDataRevision(): number {
  return this._dataRevision;
}

/**
 * Record an in-place data edit (vertex move, undo/redo, …). O(1) — no
 * rebuild happens here; stale caches rebuild lazily on next access.
 */
public markDataEdited(): void {
  this._dataRevision++;
}
```

Add `this._dataRevision++;` beside the existing `this._bumpRenderRevision();` calls in `setDataset`, `reproject`, and the `_updateData` completion — but NOT in `markDisplayArcsDirty` / `refreshDisplayArcs`.

Add to the `TopologySource` interface in `src/source/source.ts`:

```ts
/** Monotonic counter of committed data changes. See TopologySource docs. */
getDataRevision(): number;
/** Record an in-place data edit; expires derived caches lazily. */
markDataEdited(): void;
```

- [ ] **Step 4: Implement Map side**

In `src/map/map.ts`, add a private helper near `pushCommand`:

```ts
/**
 * Edits arrive as already-applied EditCommands without a uniform source
 * reference, so bump every topology source. Over-bumping only costs a
 * lazy rebuild on next derived-data access — correctness is unaffected.
 */
private _markSourcesDataEdited(): void {
  for (const source of this._sources.values()) {
    source.markDataEdited();
  }
}
```

Call `this._markSourcesDataEdited();` in:
- `pushCommand(cmd)` after `this._history.push(cmd)`;
- `undo()` after a command was actually undone (inside the `if (cmd)` branch);
- `redo()` after a command was actually redone (inside the `if (cmd)` branch).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:run -- src/source/topology-source.test.ts src/map/map.test.ts
```

Expected: PASS.

- [ ] **Step 6: Full verification and commit**

```bash
npm run typecheck && npm run test:run
git add src/source/topology-source.ts src/source/source.ts src/map/map.ts src/source/topology-source.test.ts src/map/map.test.ts
git commit -m "feat: add data revision counter to TopologySource with Map edit wiring"
```

---

### Task 4: Table converter registration + getArrowTable cache

**Files:**
- Modify: `src/source/format-registry.ts`, `src/formats/index.ts`, `src/source/topology-source.ts`, `src/source/source.ts`
- Test: `src/source/topology-source.arrow-table.test.ts` (new)

**Interfaces:**
- Consumes: `getDataRevision()` / `markDataEdited()` from Task 3.
- Produces:
  - `registerTableConverter(c: DatasetTableConverter): void`, `getTableConverter(): DatasetTableConverter | undefined`, `unregisterTableConverter(): void` in `format-registry.ts`;
  - `TopologySource.getArrowTable(opts?: GetArrowTableOptions): unknown` where `GetArrowTableOptions = { layer?: number | string; encoding?: 'native' | 'wkb' }` (default encoding `'native'`);
  - `TopologySource.seedArrowTable(table: unknown, opts: { encoding: 'native' | 'wkb'; layer?: number | string }): void` (used by Tasks 5 and 8).

- [ ] **Step 1: Write the failing tests**

Create `src/source/topology-source.arrow-table.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Table } from 'apache-arrow';
import '../formats'; // side effect: registers plugin + table converter
import {
  getTableConverter,
  registerTableConverter,
  unregisterTableConverter,
} from './format-registry';
import { TopologySource } from './topology-source';

const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    },
  ],
});

async function makeSource(): Promise<TopologySource> {
  const source = new TopologySource('t');
  await source.setData({
    filename: 'a.geojson',
    content: new TextEncoder().encode(GEOJSON),
  });
  return source;
}

describe('TopologySource.getArrowTable', () => {
  it('builds a table for the current dataset', async () => {
    const source = await makeSource();
    const table = source.getArrowTable() as Table;
    expect(table.numRows).toBe(1);
  });

  it('returns the same instance while the data revision is unchanged', async () => {
    const source = await makeSource();
    expect(source.getArrowTable()).toBe(source.getArrowTable());
  });

  it('caches native and wkb encodings independently', async () => {
    const source = await makeSource();
    const native = source.getArrowTable({ encoding: 'native' });
    const wkb = source.getArrowTable({ encoding: 'wkb' });
    expect(native).not.toBe(wkb);
    expect(source.getArrowTable({ encoding: 'wkb' })).toBe(wkb);
  });

  it('rebuilds after markDataEdited', async () => {
    const source = await makeSource();
    const before = source.getArrowTable();
    source.markDataEdited();
    expect(source.getArrowTable()).not.toBe(before);
  });

  it('seedArrowTable installs a table served by the next matching get', async () => {
    const source = await makeSource();
    const seeded = source.getArrowTable({ encoding: 'wkb' });
    source.markDataEdited();
    source.seedArrowTable(seeded, { encoding: 'wkb' });
    expect(source.getArrowTable({ encoding: 'wkb' })).toBe(seeded);
  });

  it('throws a helpful error when the formats module is not loaded', async () => {
    const source = await makeSource();
    const saved = getTableConverter()!;
    unregisterTableConverter();
    try {
      expect(() => source.getArrowTable()).toThrow(/formats/);
    } finally {
      registerTableConverter(saved);
    }
  });

  it('resets the render LOD interval around rebuilds', async () => {
    const source = await makeSource();
    const arcs = source.getArcs()!;
    const spy = vi.spyOn(arcs, 'setRetainedInterval');
    arcs.setRetainedInterval(5);
    spy.mockClear();
    source.getArrowTable();
    // reset to 0 for the conversion, then restored to 5
    expect(spy.mock.calls.map((c) => c[0])).toEqual([0, 5]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/source/topology-source.arrow-table.test.ts
```

Expected: FAIL with `getArrowTable is not a function` (and missing `registerTableConverter` export).

- [ ] **Step 3: Implement the converter slot in format-registry**

Append to `src/source/format-registry.ts`:

```ts
/**
 * Dataset → Arrow-table converter, registered by the formats bundle.
 * The table crosses this boundary as `unknown` because the core bundle
 * must not depend on apache-arrow types.
 */
export interface DatasetTableConverter {
  toTable(
    dataset: MapshaperDataset,
    opts: { layer?: number | string; encoding: 'native' | 'wkb' },
  ): unknown;
}

const CONVERTER_KEY = Symbol.for('emap.tableConverter');

export function registerTableConverter(converter: DatasetTableConverter): void {
  (globalThis as Record<symbol, unknown>)[CONVERTER_KEY] = converter;
}

/** Test seam, mirroring {@link unregisterFormat}. */
export function unregisterTableConverter(): void {
  delete (globalThis as Record<symbol, unknown>)[CONVERTER_KEY];
}

export function getTableConverter(): DatasetTableConverter | undefined {
  return (globalThis as Record<symbol, unknown>)[CONVERTER_KEY] as
    | DatasetTableConverter
    | undefined;
}
```

- [ ] **Step 4: Register the converter from the formats bundle**

In `src/formats/index.ts`, inside `registerArrowFormats()` (so bundlers that strip side effects re-register through the same entry point):

```ts
registerTableConverter({
  toTable: (dataset, opts) => toArrowTable(dataset, opts),
});
```

with the import added to the existing `format-registry` import line:

```ts
import {
  registerFormat,
  registerTableConverter,
  type ExportedFormatFile,
} from '../source/format-registry';
```

- [ ] **Step 5: Implement getArrowTable / seedArrowTable on TopologySource**

In `src/source/topology-source.ts`:

```ts
export interface GetArrowTableOptions {
  /** Layer to convert (index or name); defaults to layer 0. */
  layer?: number | string;
  /** 'native' (GeoArrow nested arrays; rendering/export default), 'wkb' (DuckDB). */
  encoding?: 'native' | 'wkb';
}
```

and on the class (near the `_dataRevision` members from Task 3):

```ts
/** Derived Arrow tables keyed by `layer|encoding`, stamped with the data
 * revision they were built from. Bounded: at most layers × 2 entries. */
private _arrowCache = new Map<string, { table: unknown; revision: number }>();

private _arrowCacheKey(layer: number | string | undefined, encoding: string): string {
  return `${layer ?? 0}|${encoding}`;
}

/**
 * GeoArrow table for one layer of the current dataset. Cached per
 * (layer, encoding); rebuilt lazily when the data revision moved.
 * Returns `unknown` because the core bundle must not name apache-arrow
 * types — callers in formats/duckdb code cast to `Table`.
 */
public getArrowTable(opts: GetArrowTableOptions = {}): unknown {
  if (!this._dataset) {
    throw new Error('TopologySource has no dataset');
  }
  const encoding = opts.encoding ?? 'native';
  const key = this._arrowCacheKey(opts.layer, encoding);
  const hit = this._arrowCache.get(key);
  if (hit && hit.revision === this._dataRevision) return hit.table;

  const converter = getTableConverter();
  if (!converter) {
    throw new Error(
      "Arrow table support requires the formats module: import '@zwishing/emap/formats' first",
    );
  }

  // Same interval discipline as export(): the render loop may have set a
  // simplification interval on the live arcs; derived tables must always
  // carry full-detail coordinates.
  const arcs = this._dataset.arcs;
  const savedInterval = arcs?.getRetainedInterval?.() ?? 0;
  if (savedInterval && arcs?.setRetainedInterval) arcs.setRetainedInterval(0);
  try {
    const table = converter.toTable(this._dataset, { layer: opts.layer, encoding });
    this._arrowCache.set(key, { table, revision: this._dataRevision });
    return table;
  } finally {
    if (savedInterval && arcs?.setRetainedInterval) arcs.setRetainedInterval(savedInterval);
  }
}

/**
 * Install an externally produced table as the cache entry for the CURRENT
 * data revision — the import path (revision 0) and DuckDB result tables
 * use this so unedited data never pays a conversion. Call AFTER any
 * setDataset/revision bump for the data the table describes.
 */
public seedArrowTable(
  table: unknown,
  opts: { encoding: 'native' | 'wkb'; layer?: number | string },
): void {
  this._arrowCache.set(this._arrowCacheKey(opts.layer, opts.encoding), {
    table,
    revision: this._dataRevision,
  });
}
```

Add the import `getTableConverter` to the existing `./format-registry` import in `topology-source.ts`, and declare all three methods (`getArrowTable`, `seedArrowTable`, plus `GetArrowTableOptions`) on the `TopologySource` interface in `src/source/source.ts` (options type exported from there or re-exported).

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:run -- src/source/topology-source.arrow-table.test.ts
```

Expected: PASS.

- [ ] **Step 7: Full verification and commit**

```bash
npm run typecheck && npm run test:run
git add src/source src/formats/index.ts
git commit -m "feat: revision-stamped Arrow table cache on TopologySource"
```

---

### Task 5: Seed the revision-0 cache on GeoArrow/GeoParquet import

**Files:**
- Modify: `src/source/format-registry.ts`, `src/formats/geoarrow-io.ts`, `src/formats/geoparquet-io.ts`, `src/formats/index.ts`, `src/source/topology-source.ts`
- Test: `src/formats/index.test.ts` (extend), `src/source/topology-source.arrow-table.test.ts` (extend)

**Interfaces:**
- Consumes: `seedArrowTable` from Task 4.
- Produces:
  - `format-registry.ts`: `interface ImportedBinaryDataset { dataset: MapshaperDataset; arrowTable?: unknown; arrowEncoding?: 'native' | 'wkb' }`; `importBinary` return type widens to `Promise<MapshaperDataset | ImportedBinaryDataset>`;
  - `geoarrow-io.ts`: `importGeoArrowTable(data, opts?): { table: Table; dataset: MapshaperDataset; encoding: 'native' | 'wkb' }`;
  - `geoparquet-io.ts`: `importGeoParquetTable(data, opts?): Promise<{ table: Table; dataset: MapshaperDataset; encoding: 'native' | 'wkb' }>`.

- [ ] **Step 1: Write the failing test**

Append to `src/source/topology-source.arrow-table.test.ts`:

```ts
import { exportGeoArrow } from '../formats/geoarrow-io';

describe('revision-0 cache seeding on import', () => {
  it('serves the imported table without converting', async () => {
    // Build .arrow bytes from a known dataset
    const seedSource = await makeSource();
    const bytes = exportGeoArrow(seedSource.getDataset()!);

    // Spy on the converter to prove getArrowTable never converts
    const real = getTableConverter()!;
    const spy = vi.fn(real.toTable.bind(real));
    registerTableConverter({ toTable: spy });
    try {
      const source = new TopologySource('arrow');
      await source.setData({ filename: 'a.arrow', content: bytes });
      const table = source.getArrowTable() as Table; // native: geoarrow default
      expect(table.numRows).toBe(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      registerTableConverter(real);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/source/topology-source.arrow-table.test.ts
```

Expected: the new test FAILS on `expect(spy).not.toHaveBeenCalled()` (import discards the table today, so `getArrowTable` converts).

- [ ] **Step 3: Widen the plugin return type**

In `src/source/format-registry.ts`, above `DatasetFormatPlugin`:

```ts
/**
 * Rich import result: the dataset plus the Arrow table it was parsed
 * from, so TopologySource can seed its revision-0 table cache and
 * unedited data pays zero conversion on later DuckDB/export use.
 */
export interface ImportedBinaryDataset {
  dataset: MapshaperDataset;
  arrowTable?: unknown;
  arrowEncoding?: 'native' | 'wkb';
}
```

and change the `importBinary` signature in `DatasetFormatPlugin` to:

```ts
importBinary(
  content: Uint8Array,
  filename: string,
): Promise<MapshaperDataset | ImportedBinaryDataset>;
```

- [ ] **Step 4: Expose table-returning import variants in formats**

In `src/formats/geoarrow-io.ts` (imports: add `detectGeometryColumn` from `./geometry-column`, `fromArrowTable` is already imported):

```ts
/** Like {@link importGeoArrow}, but also returns the parsed Arrow table
 * and its geometry encoding so callers can retain it (cache seeding). */
export function importGeoArrowTable(
  data: Uint8Array | ArrayBuffer,
  opts: ImportGeoArrowOptions = {},
): { table: Table; dataset: MapshaperDataset; encoding: 'native' | 'wkb' } {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const table = tableFromIPC(bytes);
  const geom = detectGeometryColumn(table, opts.geometryColumn);
  const dataset = fromArrowTable(table, opts);
  return { table, dataset, encoding: geom?.encoding === 'WKB' ? 'wkb' : 'native' };
}
```

Refactor `importGeoArrow` to delegate: `return importGeoArrowTable(data, opts).dataset;`.

In `src/formats/geoparquet-io.ts`, mirror the same shape around the existing parquet→Arrow-table step (the table already exists inside `importGeoParquet`; extract `importGeoParquetTable` returning `{ table, dataset, encoding }` and delegate `importGeoParquet` to it).

- [ ] **Step 5: Return the rich result from the plugin**

In `src/formats/index.ts`, replace the plugin's `importBinary` body:

```ts
importBinary: async (content, filename) => {
  const layerName = layerNameFromFilename(filename);
  const ext = filename.toLowerCase();
  if (ext.endsWith('.parquet') || ext.endsWith('.geoparquet')) {
    const { table, dataset, encoding } = await importGeoParquetTable(content, { layerName });
    return { dataset, arrowTable: table, arrowEncoding: encoding };
  }
  const { table, dataset, encoding } = importGeoArrowTable(content, { layerName });
  return { dataset, arrowTable: table, arrowEncoding: encoding };
},
```

- [ ] **Step 6: Accept the rich result in TopologySource**

At the `plugin.importBinary(content, pluginFile)` call site inside `_updateData` (`src/source/topology-source.ts`), unwrap the union and seed:

```ts
const imported = await plugin.importBinary(content, pluginFile);
const rich =
  imported && typeof imported === 'object' && 'dataset' in imported
    ? (imported as ImportedBinaryDataset)
    : null;
const dataset = rich ? rich.dataset : (imported as MapshaperDataset);
```

Continue with `dataset` where the old code used the return value. After the dataset is installed and `_dataRevision` bumped for this load, and ONLY when this import produced the whole dataset from a single plugin file (multi-file imports skip seeding):

```ts
if (rich?.arrowTable) {
  this.seedArrowTable(rich.arrowTable, { encoding: rich.arrowEncoding ?? 'native' });
}
```

Import `ImportedBinaryDataset` from `./format-registry`.

- [ ] **Step 7: Run tests to verify they pass, full verification, commit**

```bash
npm run test:run -- src/source/topology-source.arrow-table.test.ts src/formats
npm run typecheck && npm run test:run
git add src/source src/formats
git commit -m "feat: seed revision-0 Arrow cache from GeoArrow/GeoParquet imports"
```

---

### Task 6: DuckDB ops consume the cached WKB table

**Files:**
- Modify: `src/duckdb/duckdb-geometry-op.ts`, `src/duckdb/map-op.ts`
- Test: `src/duckdb/map-op.test.ts` (extend)

**Interfaces:**
- Consumes: `getArrowTable({ encoding: 'wkb', layer })` from Task 4.
- Produces:
  - `DuckDbUnaryGeometryOptions.inputTable?: Table` — pre-built WKB input table, skips conversion;
  - `DuckDbMapOpSource.getArrowTable?(opts: { layer?: string | number; encoding: 'native' | 'wkb' }): unknown` (structurally satisfied by `TopologySource.getArrowTable`).
- Scope note: single-input op families only (unary geometry via `processGeometryWithDuckDb`; the attribute/query families follow the identical pattern at their single `toArrowTable` call site if present — apply mechanically). Two-input families (relation/overlay) keep converting internally; extending them is follow-up work, not this task.

- [ ] **Step 1: Write the failing test**

In `src/duckdb/map-op.test.ts`, following the file's existing fake-context/fake-runtime patterns (a fake runtime whose `connect()` returns a recording connection is already the established pattern in this suite):

```ts
it('passes the source Arrow cache to the op instead of reconverting', async () => {
  const cached = toArrowTable(dataset, { encoding: 'wkb', geometryColumn: 'geometry' });
  const inserted: unknown[] = [];
  const runtime = makeFakeRuntime({
    onInsertArrowTable: (table: unknown) => inserted.push(table),
  }); // reuse/extend this suite's fake runtime helper
  const ctx = {
    getSource: () => ({
      getDataset: () => dataset,
      getArrowTable: (opts: { encoding: string }) => {
        expect(opts.encoding).toBe('wkb');
        return cached;
      },
    }),
    setSourceDataset: vi.fn(),
  };

  await duckDbBufferLayer(ctx, {
    src: 's',
    distance: 1,
    output: { sourceId: 'out' },
    runtime,
    failOnGeographicCrs: false,
  });

  expect(inserted[0]).toBe(cached);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: FAIL — `inserted[0]` is a freshly converted table, not `cached` (identity mismatch).

- [ ] **Step 3: Accept a pre-built input table in the op layer**

In `src/duckdb/duckdb-geometry-op.ts`:

```ts
export interface DuckDbUnaryGeometryOptions {
  layer?: string | number;
  outputLayer?: string;
  geometryColumn?: string;
  /**
   * Pre-built WKB-encoded Arrow table for the input dataset (e.g. the
   * TopologySource revision cache). Skips the toArrowTable conversion.
   * Callers are responsible for it matching `layer`/`geometryColumn`.
   */
  inputTable?: Table;
}
```

and in `processGeometryWithDuckDb`, replace the conversion block:

```ts
let input: Table;
if (opts.inputTable) {
  input = opts.inputTable;
} else {
  try {
    input = toArrowTable(dataset, {
      layer: opts.layer,
      encoding: 'wkb',
      geometryColumn,
    });
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      `DuckDB ${spec.id} input could not be converted to Arrow`,
      { cause: err },
    );
  }
}
```

- [ ] **Step 4: Fetch the cache in map-op's shared input reader**

In `src/duckdb/map-op.ts`, extend `DuckDbMapOpSource`:

```ts
export interface DuckDbMapOpSource {
  getBytes?(): Uint8Array | ArrayBuffer | null | undefined;
  getDataset(): MapshaperDataset | null | undefined;
  /** Revision-cached Arrow table (TopologySource.getArrowTable). */
  getArrowTable?(opts: {
    layer?: string | number;
    encoding: 'native' | 'wkb';
  }): unknown;
  getGeoParquetQuerySource?(): DuckDbGeoParquetQuerySource | null | undefined;
}
```

Extend `readInputDataset` to also resolve the cached table (only for the default geometry column — a custom `geometryColumn` was not what the cache was built with):

```ts
function readInputDataset(
  ctx: DuckDbMapOpContext,
  src: string,
  field = 'src',
  tableOpts?: { layer?: string | number; geometryColumn?: string },
):
  | { ok: true; dataset: MapshaperDataset; inputTable?: Table }
  | { ok: false; result: OpResult<never> } {
  const source = ctx.getSource(src);
  if (!source) return { ok: false, result: Err.notFound('source', src) };

  const dataset = source.getDataset();
  if (!dataset) {
    return {
      ok: false,
      result: Err.validation(field, `Source '${src}' does not have a loaded dataset`),
    };
  }

  let inputTable: Table | undefined;
  const geometryColumn = tableOpts?.geometryColumn ?? 'geometry';
  if (geometryColumn === 'geometry' && source.getArrowTable) {
    try {
      inputTable = source.getArrowTable({
        layer: tableOpts?.layer,
        encoding: 'wkb',
      }) as Table;
    } catch {
      // cache unavailable (formats module not loaded, conversion failure):
      // fall back to the op's own conversion path
    }
  }

  return { ok: true, dataset, inputTable };
}
```

(`import type { Table } from 'apache-arrow';` — the duckdb bundle already depends on apache-arrow.)

In each single-input op wrapper that feeds `processGeometryWithDuckDb` (e.g. `duckDbBufferLayer`, `duckDbGeometryLayer`), pass the table through:

```ts
const input = readInputDataset(ctx, opts.src, 'src', {
  layer: opts.layer,
  geometryColumn: opts.geometryColumn,
});
if (!input.ok) return input.result;
...
const dataset = await bufferDatasetWithDuckDb(
  input.dataset,
  { ...opts, inputTable: input.inputTable },
  opts.runtime,
);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:run -- src/duckdb
```

Expected: PASS (new test and all existing duckdb unit tests).

- [ ] **Step 6: Full verification and commit**

```bash
npm run typecheck && npm run test:run
git add src/duckdb
git commit -m "feat: DuckDB ops reuse the TopologySource Arrow cache"
```

---

### Task 7: GeoArrow/GeoParquet export served from the cache

**Files:**
- Modify: `src/source/topology-source.ts` (`export()`), `src/formats/geoarrow-io.ts`, `src/formats/geoparquet-io.ts`, `src/formats/index.ts`
- Test: `src/source/topology-source.arrow-table.test.ts` (extend)

**Interfaces:**
- Consumes: `getArrowTable` from Task 4.
- Produces: `ExportGeoArrowOptions.table?: Table` and the geoparquet equivalent — when provided, the exporter serializes that table instead of rebuilding one.

- [ ] **Step 1: Write the failing test**

Append to `src/source/topology-source.arrow-table.test.ts`:

```ts
describe('export via arrow cache', () => {
  it('exports geoarrow without a second conversion when cached', async () => {
    const seedSource = await makeSource();
    const bytes = exportGeoArrow(seedSource.getDataset()!);
    const source = new TopologySource('arrow2');
    await source.setData({ filename: 'b.arrow', content: bytes });

    const real = getTableConverter()!;
    const spy = vi.fn(real.toTable.bind(real));
    registerTableConverter({ toTable: spy });
    try {
      const blob = await source.export({ format: 'geoarrow' });
      expect(blob.size).toBeGreaterThan(0);
      expect(spy).not.toHaveBeenCalled(); // seeded revision-0 table served
    } finally {
      registerTableConverter(real);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/source/topology-source.arrow-table.test.ts
```

Expected: FAIL on `expect(spy).not.toHaveBeenCalled()`.

- [ ] **Step 3: Let the exporters accept a pre-built table**

`src/formats/geoarrow-io.ts`:

```ts
export interface ExportGeoArrowOptions extends Omit<ToArrowTableOptions, 'encoding'> {
  /** Geometry encoding; GeoArrow IPC defaults to native nested arrays. */
  encoding?: 'native' | 'wkb';
  /** Pre-built table (e.g. the source revision cache); serialized as-is. */
  table?: Table;
}

export function exportGeoArrow(
  dataset: MapshaperDataset,
  opts: ExportGeoArrowOptions = {},
): Uint8Array {
  const table: Table =
    opts.table ?? toArrowTable(dataset, { ...opts, encoding: opts.encoding ?? 'native' });
  return tableToIPC(table, 'file');
}
```

Mirror in `src/formats/geoparquet-io.ts`: add `table?: Table` to `ExportGeoParquetOptions` and use `opts.table ?? toArrowTable(...)` at its conversion site (geoparquet's encoding default is `'wkb'`).

- [ ] **Step 4: Pass the cached table from TopologySource.export**

In `TopologySource.export`, where the plugin export handler is resolved (`getExportHandler(options.format)` path), for `geoarrow`/`geoparquet` fetch the cache first and merge it into the handler options:

```ts
if (options.format === 'geoarrow' || options.format === 'geoparquet') {
  const encoding =
    options.encoding ?? (options.format === 'geoarrow' ? 'native' : 'wkb');
  let table: unknown;
  try {
    table = this.getArrowTable({ layer: options.layer, encoding });
  } catch {
    // formats module missing or conversion failed — the handler surfaces
    // its own error on the rebuild path
  }
  handlerOptions = { ...options, table };
}
```

(Adapt the exact variable names to the post-merge `export()` body; the invariant is: the handler receives `{ ...ExportOptions, table? }`.)

- [ ] **Step 5: Run tests, full verification, commit**

```bash
npm run test:run -- src/source/topology-source.arrow-table.test.ts src/formats
npm run typecheck && npm run test:run
git add src/source src/formats
git commit -m "feat: serve geoarrow/geoparquet export from the Arrow cache"
```

---

### Task 8: DuckDB result tables reseed the cache

**Files:**
- Modify: `src/duckdb/duckdb-geometry-op.ts`, `src/duckdb/map-op.ts`
- Test: `src/duckdb/map-op.test.ts` (extend)

**Interfaces:**
- Consumes: `seedArrowTable` (Task 4), `inputTable` plumbing (Task 6).
- Produces:
  - `DuckDbUnaryGeometryOptions.onResultTable?: (table: Table) => void`;
  - `DuckDbMapOpContext.seedSourceArrowTable?(id: string, table: unknown, encoding: 'native' | 'wkb'): void`.

- [ ] **Step 1: Write the failing test**

In `src/duckdb/map-op.test.ts`:

```ts
it('reseeds the output source cache with the result table', async () => {
  const runtime = makeFakeRuntime({
    queryResult: fakeResultTable, // suite's existing fake result-table fixture
  });
  const seeded: Array<{ id: string; table: unknown; encoding: string }> = [];
  const ctx = {
    getSource: () => ({ getDataset: () => dataset }),
    setSourceDataset: vi.fn(),
    seedSourceArrowTable: (id: string, table: unknown, encoding: string) =>
      seeded.push({ id, table, encoding }),
  };

  await duckDbBufferLayer(ctx, {
    src: 's',
    distance: 1,
    output: { sourceId: 'out' },
    runtime,
    failOnGeographicCrs: false,
  });

  expect(seeded).toEqual([{ id: 'out', table: fakeResultTable, encoding: 'wkb' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: FAIL — `seeded` is empty.

- [ ] **Step 3: Emit the result table from the op layer**

In `src/duckdb/duckdb-geometry-op.ts`, add to `DuckDbUnaryGeometryOptions`:

```ts
/** Called with the raw result table right before it is converted to a
 * dataset — lets callers reseed a source cache without a re-conversion. */
onResultTable?: (table: Table) => void;
```

and in `processGeometryWithDuckDb`, in the success path right before `fromArrowTable(resultTable, ...)`:

```ts
opts.onResultTable?.(resultTable);
```

- [ ] **Step 4: Wire it in map-op and the context**

In `src/duckdb/map-op.ts`, extend the context interface:

```ts
export interface DuckDbMapOpContext {
  getSource(id: string): DuckDbMapOpSource | null | undefined;
  setSourceDataset(id: string, dataset: MapshaperDataset): void | Promise<void>;
  /**
   * Install a result table as the output source's Arrow cache entry
   * (TopologySource.seedArrowTable). Must be invoked AFTER
   * setSourceDataset so the entry stamps the new data revision.
   */
  seedSourceArrowTable?(
    id: string,
    table: unknown,
    encoding: 'native' | 'wkb',
  ): void;
}
```

In each single-input wrapper (pattern shown for `duckDbBufferLayer`; apply identically where Task 6 added `inputTable`):

```ts
let resultTable: Table | undefined;
const dataset = await bufferDatasetWithDuckDb(
  input.dataset,
  {
    ...opts,
    inputTable: input.inputTable,
    onResultTable: (t) => {
      resultTable = t;
    },
  },
  opts.runtime,
);
await ctx.setSourceDataset(sourceId, dataset);
if (resultTable) ctx.seedSourceArrowTable?.(sourceId, resultTable, 'wkb');
return okValue({ sourceId, dataset });
```

- [ ] **Step 5: Run tests, full verification, commit**

```bash
npm run test:run -- src/duckdb
npm run typecheck && npm run test:run
git add src/duckdb
git commit -m "feat: reseed source Arrow cache from DuckDB result tables"
```

---

### Task 9: Full-suite verification + example wiring

**Files:**
- Modify: the DuckDB example page under `test/examples/` that constructs a `DuckDbMapOpContext` literal (locate with `git grep -l "setSourceDataset" test/examples/`), if one exists — add the two optional context members so the examples exercise the cache path:

```js
seedSourceArrowTable: (id, table, encoding) =>
  map.getSource(id)?.seedArrowTable?.(table, { encoding }),
```

(and its `getSource` return already structurally provides `getArrowTable` when it returns the `TopologySource` itself).

- [ ] **Step 1: Run everything**

```bash
npm run typecheck && npm run test:run && npm run build && npm run test:duckdb
```

Expected: all green (test:duckdb needs a network-capable environment for duckdb-wasm; if unavailable, report which suites ran).

- [ ] **Step 2: Detect-changes gate (repo rule)**

Run `gitnexus detect_changes` (MCP) and confirm the touched symbols match this plan's file list — sources, formats, duckdb, map; no renderer symbols beyond Task 2's mechanical upgrades.

- [ ] **Step 3: Commit any example wiring**

```bash
git add test/examples
git commit -m "docs: wire Arrow cache seeding into DuckDB example context"
```

---

## Deferred to the phases 4–6 plan

- Whole-table bridge render via `@luma.gl/arrow` (`ArrowPathModel` / `ArrowStoragePathModel`).
- Chunk outputs unified on GeoArrow physical layout + edit-local invalidation.
- Edit-session hot path + featureId consistency mask.
- Two-input DuckDB families (relation/overlay) consuming the cache.
