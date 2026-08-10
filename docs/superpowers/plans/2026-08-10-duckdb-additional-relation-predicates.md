# Additional DuckDB Relation Predicates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `overlaps`, `equals`, `crosses`, `covers`, `coveredBy`, and `containsProperly` to emap's DuckDB relation API in filter and attribute modes.

**Architecture:** Extend the fixed relation-function union and operation registry, then add explicit public helpers and route them through the existing map-operation switches. Reuse the current CRS alignment, WKB/Arrow conversion, DuckDB lifecycle, `EXISTS` SQL, result conversion, cleanup, and error classification without introducing a new execution path.

**Tech Stack:** TypeScript, Vitest, Apache Arrow, DuckDB-Wasm `1.33.1-dev57.0`, DuckDB Spatial, Rollup, TypeDoc, Docusaurus.

## Global Constraints

- The exact operation mappings are:
  - `overlaps` → `ST_Overlaps` → `duckdb_overlaps`
  - `equals` → `ST_Equals` → `duckdb_equals`
  - `crosses` → `ST_Crosses` → `duckdb_crosses`
  - `covers` → `ST_Covers` → `duckdb_covers`
  - `coveredBy` → `ST_CoveredBy` → `duckdb_covered_by`
  - `containsProperly` → `ST_ContainsProperly` → `duckdb_contains_properly`
- Every new predicate supports both `filter` and `attribute`, requires no distance, and allows geographic CRS.
- DuckDB argument order is always `ST_Function(input_geometry, mask_geometry)`.
- Keep the existing correlated `EXISTS` SQL so one input feature is emitted at most once.
- Do not add R-tree indexes, bbox prefilters, resident sessions, raw SQL, or fallback implementations.
- Do not modify `src/duckdb/duckdb-relation-op.ts`, `src/duckdb/index.ts`, or `src/map/ops/_runner.ts`; their existing contracts already cover this feature.
- The browser-only runtime must not gain Node.js APIs.
- Before editing an existing symbol, run GitNexus upstream impact analysis for that symbol and report the blast radius. Stop and warn before proceeding if risk is HIGH or CRITICAL.
- Before every commit, run GitNexus `detect_changes` and `rtk git diff --check`.
- Production changes follow red-green-refactor: add the focused failing test, observe the expected failure, add only the minimal implementation, then rerun the focused suite.
- All shell commands in this repository are prefixed with `rtk`.
- Do not include the separately tracked example bug MAP-154 (`layer` versus `inputLayer`) in this feature.

---

## File Map

| File | Responsibility in this change |
| --- | --- |
| `src/duckdb/duckdb-sql.ts` | Extend the closed union of safe relation function names. |
| `src/duckdb/duckdb-relation-ops.ts` | Register six predicates and expose twelve dataset helpers. |
| `src/duckdb/map-op.ts` | Route six ids through both explicit relation-mode switches. |
| `src/duckdb/duckdb-buffer.test.ts` | Verify filter and attribute SQL for each added function. |
| `src/duckdb/duckdb-relation-ops.test.ts` | Verify registry metadata, helpers, defaults, and geographic CRS policy. |
| `src/duckdb/map-op.test.ts` | Verify filter and attribute map-op routing for all six ids. |
| `src/duckdb/duckdb-relation.integration.test.ts` | Execute every new `ST_*` function against real DuckDB-Wasm. |
| `packages/examples/examples/duckdb-spatial-ops/index.html` | Expose all six predicates through the existing relation UI. |
| `test/examples/duckdb-spatial-ops.test.ts` | Pin selector, relation-set, and label wiring. |
| `packages/docs/docs/data/duckdb.md` | Document the Chinese API and directional semantics. |
| `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/duckdb.md` | Keep the English guide and API catalog synchronized. |
| `packages/docs/static/api/**` | TypeDoc-generated public API output; regenerate, never hand-edit. |

## Task 1: Register the Six Predicate Functions

**Files:**

- Modify: `src/duckdb/duckdb-sql.ts:65-70`
- Modify: `src/duckdb/duckdb-relation-ops.ts:12-112`
- Test: `src/duckdb/duckdb-buffer.test.ts:255-388`
- Test: `src/duckdb/duckdb-relation-ops.test.ts:316-350`

**Interfaces:**

- Consumes: `buildRelationFilterSql`, `buildRelationAttributeSql`, and `getDuckDbRelationOperationSpec(operation: string)`.
- Produces: six new `DuckDbRelationOperationId` values and six corresponding `RelationDuckDbFunction` values for later helpers and map routing.

- [ ] **Step 1: Run upstream impact analysis before editing the existing type and registry symbols**

Run GitNexus `impact` with `direction: "upstream"`, `repo: "/Users/zhang/code/emap"`, and these targets:

```text
RelationDuckDbFunction
DUCKDB_RELATION_OPERATION_SPECS
TopologicalRelationOperationId
getDuckDbRelationOperationSpec
```

Expected: a localized DuckDB relation blast radius. Report all direct callers and affected processes before editing.

- [ ] **Step 2: Add failing SQL and registry tests**

Add this table in both relevant test files, local to their existing DuckDB relation describe blocks:

```ts
const ADDITIONAL_RELATION_CASES = [
  { id: 'overlaps', duckDbFunction: 'ST_Overlaps', outputColumn: 'duckdb_overlaps' },
  { id: 'equals', duckDbFunction: 'ST_Equals', outputColumn: 'duckdb_equals' },
  { id: 'crosses', duckDbFunction: 'ST_Crosses', outputColumn: 'duckdb_crosses' },
  { id: 'covers', duckDbFunction: 'ST_Covers', outputColumn: 'duckdb_covers' },
  { id: 'coveredBy', duckDbFunction: 'ST_CoveredBy', outputColumn: 'duckdb_covered_by' },
  {
    id: 'containsProperly',
    duckDbFunction: 'ST_ContainsProperly',
    outputColumn: 'duckdb_contains_properly',
  },
] as const;
```

In `src/duckdb/duckdb-buffer.test.ts`, add:

```ts
it.each(ADDITIONAL_RELATION_CASES)(
  'builds additional filter and attribute SQL for $duckDbFunction',
  ({ duckDbFunction, outputColumn }) => {
    const base = {
      inputTableName: 'input',
      maskTableName: 'mask',
      inputGeometryColumn: 'geometry',
      maskGeometryColumn: 'geometry',
      duckDbFunction,
    };

    const filterSql = buildRelationFilterSql(base);
    const attributeSql = buildRelationAttributeSql({ ...base, outputColumn });
    const predicate = `${duckDbFunction}(i."geometry", m."geometry")`;

    expect(filterSql).toContain(' AND EXISTS (');
    expect(filterSql).toContain(predicate);
    expect(attributeSql).toContain(' EXISTS (');
    expect(attributeSql).toContain(predicate);
    expect(attributeSql).toContain(`AS "${outputColumn}"`);
  },
);
```

In `src/duckdb/duckdb-relation-ops.test.ts`, add:

```ts
it.each(ADDITIONAL_RELATION_CASES)(
  'returns the additional $id operation spec',
  ({ id, duckDbFunction, outputColumn }) => {
    expect(getDuckDbRelationOperationSpec(id)).toEqual({
      id,
      duckDbFunction,
      outputColumn,
      output: 'predicate',
      supportsFilter: true,
      supportsAttribute: true,
      requiresDistance: false,
      rejectGeographicCrs: false,
    });
  },
);
```

Change the existing unknown-operation test input from `crosses` to `unsupported` so it continues to test an actually unsupported id.

- [ ] **Step 3: Run the tests and typecheck to verify RED**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-relation-ops.test.ts --reporter=dot
rtk pnpm run typecheck
```

Expected: registry cases fail with `Unsupported DuckDB relation operation`; type checking rejects the new function literals because `RelationDuckDbFunction` has not been extended.

- [ ] **Step 4: Extend the safe function union**

Replace `RelationDuckDbFunction` with:

```ts
export type RelationDuckDbFunction =
  | 'ST_Intersects'
  | 'ST_Contains'
  | 'ST_Within'
  | 'ST_Touches'
  | 'ST_Disjoint'
  | 'ST_Overlaps'
  | 'ST_Equals'
  | 'ST_Crosses'
  | 'ST_Covers'
  | 'ST_CoveredBy'
  | 'ST_ContainsProperly';
```

- [ ] **Step 5: Add the six registry entries**

Insert these entries in `DUCKDB_RELATION_OPERATION_SPECS` before the distance entries:

```ts
overlaps: {
  id: 'overlaps',
  duckDbFunction: 'ST_Overlaps',
  outputColumn: 'duckdb_overlaps',
  output: 'predicate',
  supportsFilter: true,
  supportsAttribute: true,
  requiresDistance: false,
  rejectGeographicCrs: false,
},
equals: {
  id: 'equals',
  duckDbFunction: 'ST_Equals',
  outputColumn: 'duckdb_equals',
  output: 'predicate',
  supportsFilter: true,
  supportsAttribute: true,
  requiresDistance: false,
  rejectGeographicCrs: false,
},
crosses: {
  id: 'crosses',
  duckDbFunction: 'ST_Crosses',
  outputColumn: 'duckdb_crosses',
  output: 'predicate',
  supportsFilter: true,
  supportsAttribute: true,
  requiresDistance: false,
  rejectGeographicCrs: false,
},
covers: {
  id: 'covers',
  duckDbFunction: 'ST_Covers',
  outputColumn: 'duckdb_covers',
  output: 'predicate',
  supportsFilter: true,
  supportsAttribute: true,
  requiresDistance: false,
  rejectGeographicCrs: false,
},
coveredBy: {
  id: 'coveredBy',
  duckDbFunction: 'ST_CoveredBy',
  outputColumn: 'duckdb_covered_by',
  output: 'predicate',
  supportsFilter: true,
  supportsAttribute: true,
  requiresDistance: false,
  rejectGeographicCrs: false,
},
containsProperly: {
  id: 'containsProperly',
  duckDbFunction: 'ST_ContainsProperly',
  outputColumn: 'duckdb_contains_properly',
  output: 'predicate',
  supportsFilter: true,
  supportsAttribute: true,
  requiresDistance: false,
  rejectGeographicCrs: false,
},
```

Replace the manual topological id union with:

```ts
type TopologicalRelationOperationId = Exclude<
  DuckDbRelationOperationId,
  'distance' | 'distanceWithin'
>;
```

This keeps future registry predicates from drifting away from the helper dispatch type while still excluding both distance operations.

- [ ] **Step 6: Run focused tests and typecheck to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-relation-ops.test.ts --reporter=dot
rtk pnpm run typecheck
```

Expected: all focused tests pass and typecheck exits successfully.

- [ ] **Step 7: Check scope and commit Task 1**

Run GitNexus `detect_changes` with `scope: "all"`, then:

```bash
rtk git diff --check
rtk git add src/duckdb/duckdb-sql.ts src/duckdb/duckdb-relation-ops.ts src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-relation-ops.test.ts
rtk git commit -m "Add DuckDB relation predicate specs"
```

## Task 2: Expose Twelve Named Dataset Helpers

**Files:**

- Modify: `src/duckdb/duckdb-relation-ops.ts:199-354`
- Test: `src/duckdb/duckdb-relation-ops.test.ts:1-315`

**Interfaces:**

- Consumes: the six registry entries and `TopologicalRelationOperationId` from Task 1.
- Produces: six filter helpers and six attribute helpers, automatically exported through the existing `src/duckdb/index.ts` barrel.

- [ ] **Step 1: Add failing helper imports and table cases**

Add all twelve helpers to the test import from `./duckdb-relation-ops`:

```ts
containsProperlyAttributeDatasetWithDuckDb,
containsProperlyDatasetWithDuckDb,
coveredByAttributeDatasetWithDuckDb,
coveredByDatasetWithDuckDb,
coversAttributeDatasetWithDuckDb,
coversDatasetWithDuckDb,
crossesAttributeDatasetWithDuckDb,
crossesDatasetWithDuckDb,
equalsAttributeDatasetWithDuckDb,
equalsDatasetWithDuckDb,
overlapsAttributeDatasetWithDuckDb,
overlapsDatasetWithDuckDb,
```

Append these rows to the existing filter helper table:

```ts
[overlapsDatasetWithDuckDb, 'overlaps', 'ST_Overlaps'],
[equalsDatasetWithDuckDb, 'equals', 'ST_Equals'],
[crossesDatasetWithDuckDb, 'crosses', 'ST_Crosses'],
[coversDatasetWithDuckDb, 'covers', 'ST_Covers'],
[coveredByDatasetWithDuckDb, 'coveredBy', 'ST_CoveredBy'],
[containsProperlyDatasetWithDuckDb, 'containsProperly', 'ST_ContainsProperly'],
```

Append these rows to the existing attribute helper table:

```ts
[overlapsAttributeDatasetWithDuckDb, 'overlaps', 'ST_Overlaps', 'duckdb_overlaps'],
[equalsAttributeDatasetWithDuckDb, 'equals', 'ST_Equals', 'duckdb_equals'],
[crossesAttributeDatasetWithDuckDb, 'crosses', 'ST_Crosses', 'duckdb_crosses'],
[coversAttributeDatasetWithDuckDb, 'covers', 'ST_Covers', 'duckdb_covers'],
[coveredByAttributeDatasetWithDuckDb, 'coveredBy', 'ST_CoveredBy', 'duckdb_covered_by'],
[
  containsProperlyAttributeDatasetWithDuckDb,
  'containsProperly',
  'ST_ContainsProperly',
  'duckdb_contains_properly',
],
```

Append the filter and attribute helpers to the existing geographic-CRS table so all twelve are checked against `EPSG:4326`.

- [ ] **Step 2: Run the helper test to verify RED**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/duckdb-relation-ops.test.ts --reporter=dot
```

Expected: module transform fails because the twelve named exports do not exist.

- [ ] **Step 3: Add the six filter helpers**

Add:

```ts
export function overlapsDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('overlaps', inputDataset, maskDataset, opts, runtime);
}

export function equalsDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('equals', inputDataset, maskDataset, opts, runtime);
}

export function crossesDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('crosses', inputDataset, maskDataset, opts, runtime);
}

export function coversDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('covers', inputDataset, maskDataset, opts, runtime);
}

export function coveredByDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('coveredBy', inputDataset, maskDataset, opts, runtime);
}

export function containsProperlyDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalFilterHelper('containsProperly', inputDataset, maskDataset, opts, runtime);
}
```

- [ ] **Step 4: Add the six attribute helpers**

Add:

```ts
export function overlapsAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('overlaps', inputDataset, maskDataset, opts, runtime);
}

export function equalsAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('equals', inputDataset, maskDataset, opts, runtime);
}

export function crossesAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('crosses', inputDataset, maskDataset, opts, runtime);
}

export function coversAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('covers', inputDataset, maskDataset, opts, runtime);
}

export function coveredByAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('coveredBy', inputDataset, maskDataset, opts, runtime);
}

export function containsProperlyAttributeDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runTopologicalAttributeHelper('containsProperly', inputDataset, maskDataset, opts, runtime);
}
```

- [ ] **Step 5: Run helper tests and typecheck to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/duckdb-relation-ops.test.ts --reporter=dot
rtk pnpm run typecheck
```

Expected: helper specs, default columns, and all geographic-CRS cases pass.

- [ ] **Step 6: Check scope and commit Task 2**

Run GitNexus `detect_changes` with `scope: "all"`, then:

```bash
rtk git diff --check
rtk git add src/duckdb/duckdb-relation-ops.ts src/duckdb/duckdb-relation-ops.test.ts
rtk git commit -m "Expose additional DuckDB relation helpers"
```

## Task 3: Route the New Predicates Through Map Operations

**Files:**

- Modify: `src/duckdb/map-op.ts:31-47,313-416`
- Test: `src/duckdb/map-op.test.ts:606-830`

**Interfaces:**

- Consumes: the twelve public helpers from Task 2.
- Produces: `runRelationOperation` and `duckDbRelationLayer` support for every new id in both modes.

- [ ] **Step 1: Run upstream impact analysis for the explicit dispatcher**

Run GitNexus `impact` for `runRelationOperation` with `direction: "upstream"` and `repo: "/Users/zhang/code/emap"`.

Expected: direct caller `duckDbRelationLayer` and the DuckDB relation execution flows. Report the risk before editing.

- [ ] **Step 2: Add a failing map-operation routing matrix**

Add inside `describe('duckDbRelationLayer')`:

```ts
it.each([
  ['overlaps', 'ST_Overlaps'],
  ['equals', 'ST_Equals'],
  ['crosses', 'ST_Crosses'],
  ['covers', 'ST_Covers'],
  ['coveredBy', 'ST_CoveredBy'],
  ['containsProperly', 'ST_ContainsProperly'],
] as const)('routes %s through filter and attribute relation modes', async (operation, fn) => {
  for (const mode of ['filter', 'attribute'] as const) {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const ctx = makeContext('src', input);
    ctx.sources.set('mask', new FakeSource(mask));
    const runtime = new FakeRuntime(toArrowTable(input, { encoding: 'wkb' }));
    const sourceId = `${operation}-${mode}`;

    const result = await duckDbRelationLayer(ctx, {
      src: 'src',
      mask: 'mask',
      mode,
      operation,
      output: { sourceId },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has(sourceId)).toBe(true);
    expect(runtime.connection.inserted).toHaveLength(2);
    expect(runtime.connection.queries.join('\n')).toContain(fn);
  }
});
```

- [ ] **Step 3: Run the map-op test to verify RED**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/map-op.test.ts -t "duckDbRelationLayer" --reporter=dot
```

Expected: each new id returns a DuckDB validation error because both explicit switches lack cases.

- [ ] **Step 4: Import all twelve helpers in `map-op.ts`**

Add the exact helper names produced by Task 2 to the existing import from `./duckdb-relation-ops`. Keep imports alphabetized by helper family and allow Biome to format the block.

- [ ] **Step 5: Add filter-mode cases**

Add to the filter switch:

```ts
case 'overlaps':
  return overlapsDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
case 'equals':
  return equalsDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
case 'crosses':
  return crossesDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
case 'covers':
  return coversDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
case 'coveredBy':
  return coveredByDatasetWithDuckDb(inputDataset, maskDataset, helperOptions, opts.runtime);
case 'containsProperly':
  return containsProperlyDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
```

- [ ] **Step 6: Add attribute-mode cases**

Add to the attribute switch:

```ts
case 'overlaps':
  return overlapsAttributeDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
case 'equals':
  return equalsAttributeDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
case 'crosses':
  return crossesAttributeDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
case 'covers':
  return coversAttributeDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
case 'coveredBy':
  return coveredByAttributeDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
case 'containsProperly':
  return containsProperlyAttributeDatasetWithDuckDb(
    inputDataset,
    maskDataset,
    helperOptions,
    opts.runtime,
  );
```

- [ ] **Step 7: Run map-op and helper tests to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/duckdb-relation-ops.test.ts src/duckdb/map-op.test.ts --reporter=dot
rtk pnpm run typecheck
```

Expected: all new filter and attribute routes pass without changing existing distance behavior.

- [ ] **Step 8: Check scope and commit Task 3**

Run GitNexus `detect_changes` with `scope: "all"`, then:

```bash
rtk git diff --check
rtk git add src/duckdb/map-op.ts src/duckdb/map-op.test.ts
rtk git commit -m "Route additional DuckDB relation predicates"
```

## Task 4: Verify Every Function Against DuckDB-Wasm

**Files:**

- Test: `src/duckdb/duckdb-relation.integration.test.ts:1-305`

**Interfaces:**

- Consumes: the six filter and attribute helpers implemented in Tasks 2 and 3 and the existing shared blocking DuckDB-Wasm runtime.
- Produces: real-extension compatibility and directional-semantics coverage for all six functions.

This is a compatibility-verification task. Production behavior already entered through failing unit tests in Tasks 1-3; do not change production code unless an integration failure is first reduced to a focused regression test.

- [ ] **Step 1: Add geometry fixture builders**

Add below the existing fixture helpers:

```ts
function square(id: string, minX: number, minY: number, maxX: number, maxY: number) {
  return {
    type: 'Feature',
    properties: { id },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
  };
}

function line(id: string, coordinates: number[][]) {
  return {
    type: 'Feature',
    properties: { id },
    geometry: { type: 'LineString', coordinates },
  };
}

function point(id: string, coordinates: number[]) {
  return {
    type: 'Feature',
    properties: { id },
    geometry: { type: 'Point', coordinates },
  };
}

async function fixtureDataset(features: unknown[]): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON({ type: 'FeatureCollection', features });
  dataset.info = { ...dataset.info, crs_string: 'EPSG:3857' };
  return dataset;
}
```

- [ ] **Step 2: Add imports for the six helpers used by the integration matrix**

Import:

```ts
containsProperlyAttributeDatasetWithDuckDb,
coveredByDatasetWithDuckDb,
coversAttributeDatasetWithDuckDb,
crossesDatasetWithDuckDb,
equalsAttributeDatasetWithDuckDb,
overlapsDatasetWithDuckDb,
```

- [ ] **Step 3: Add one real-runtime test that executes all six functions**

Add:

```ts
it('executes the additional topological predicates with directional semantics', async () => {
  const duckDbRuntime = await getIntegrationRuntime();

  const overlaps = await overlapsDatasetWithDuckDb(
    await fixtureDataset([square('overlap', 0, 0, 10, 10), square('far', 20, 20, 30, 30)]),
    await fixtureDataset([square('mask', 5, 5, 15, 15)]),
    {},
    duckDbRuntime,
  );
  expect(records(overlaps).map((record) => record.id)).toEqual(['overlap']);

  const equals = await equalsAttributeDatasetWithDuckDb(
    await fixtureDataset([square('same', 0, 0, 10, 10), square('shifted', 5, 5, 15, 15)]),
    await fixtureDataset([square('mask', 0, 0, 10, 10)]),
    {},
    duckDbRuntime,
  );
  expect(records(equals).map((record) => record.duckdb_equals)).toEqual([true, false]);

  const crosses = await crossesDatasetWithDuckDb(
    await fixtureDataset([
      line('crossing', [[0, 5], [10, 5]]),
      line('far', [[0, 20], [10, 20]]),
    ]),
    await fixtureDataset([line('mask', [[5, 0], [5, 10]])]),
    {},
    duckDbRuntime,
  );
  expect(records(crosses).map((record) => record.id)).toEqual(['crossing']);

  const covers = await coversAttributeDatasetWithDuckDb(
    await fixtureDataset([square('covering', 0, 0, 10, 10), square('far', 20, 20, 30, 30)]),
    await fixtureDataset([point('boundary', [0, 5])]),
    {},
    duckDbRuntime,
  );
  expect(records(covers).map((record) => record.duckdb_covers)).toEqual([true, false]);

  const coveredBy = await coveredByDatasetWithDuckDb(
    await fixtureDataset([point('boundary', [0, 5]), point('outside', [20, 20])]),
    await fixtureDataset([square('mask', 0, 0, 10, 10)]),
    {},
    duckDbRuntime,
  );
  expect(records(coveredBy).map((record) => record.id)).toEqual(['boundary']);

  const containsProperly = await containsProperlyAttributeDatasetWithDuckDb(
    await fixtureDataset([
      square('interior', 0, 0, 10, 10),
      square('boundary', 5, 5, 15, 15),
    ]),
    await fixtureDataset([point('mask', [5, 5])]),
    {},
    duckDbRuntime,
  );
  expect(
    records(containsProperly).map((record) => record.duckdb_contains_properly),
  ).toEqual([true, false]);
}, 120_000);
```

- [ ] **Step 4: Run the real integration file**

Run:

```bash
rtk run 'DUCKDB_WASM_INTEGRATION=1 pnpm exec vitest run src/duckdb/duckdb-relation.integration.test.ts --reporter=dot'
```

Expected: every function loads from the installed spatial extension and all directional assertions pass.

- [ ] **Step 5: Check scope and commit Task 4**

Run GitNexus `detect_changes` with `scope: "all"`, then:

```bash
rtk git diff --check
rtk git add src/duckdb/duckdb-relation.integration.test.ts
rtk git commit -m "Verify additional DuckDB relation predicates"
```

## Task 5: Document and Demonstrate the New Predicates

**Files:**

- Modify: `packages/examples/examples/duckdb-spatial-ops/index.html:124-240`
- Test: `test/examples/duckdb-spatial-ops.test.ts:83-102`
- Modify: `packages/docs/docs/data/duckdb.md:5,103-128,182-187`
- Modify: `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/duckdb.md:5,92-117,169-186`
- Generate: `packages/docs/static/api/reflections.json`
- Generate: `packages/docs/static/api/modules/duckdb.html`
- Generate: `packages/docs/static/api/functions/duckdb.<helper>.html` for each of the twelve new helpers
- Generate: any relation type, navigation, hierarchy, search, or shared TypeDoc assets changed by `pnpm run api:build`

**Interfaces:**

- Consumes: all public helpers and map-op ids from Tasks 1-3.
- Produces: synchronized Chinese/English API catalog entries, discoverable example controls, and generated TypeDoc pages.

- [ ] **Step 1: Run impact analysis for the example's relation constants**

Run GitNexus upstream impact for `RELATION_OPERATIONS` and `OPERATION_LABELS` in `packages/examples/examples/duckdb-spatial-ops/index.html` when the symbols resolve. Report the example-only blast radius.

- [ ] **Step 2: Add failing example contract assertions**

Extend `exposes DuckDB relation operation controls` with:

```ts
expect(html).toContain('<option value="overlaps">Overlaps</option>');
expect(html).toContain('<option value="equals">Equals</option>');
expect(html).toContain('<option value="crosses">Crosses</option>');
expect(html).toContain('<option value="covers">Covers</option>');
expect(html).toContain('<option value="coveredBy">Covered By</option>');
expect(html).toContain('<option value="containsProperly">Contains Properly</option>');
```

Add a second assertion that extracts the `RELATION_OPERATIONS` and `OPERATION_LABELS` source blocks and verifies every id is present in both. Use this exact data table:

```ts
const additionalRelations = [
  ['overlaps', 'Overlaps'],
  ['equals', 'Equals'],
  ['crosses', 'Crosses'],
  ['covers', 'Covers'],
  ['coveredBy', 'Covered By'],
  ['containsProperly', 'Contains Properly'],
] as const;

const relationOperations = html.match(
  /const RELATION_OPERATIONS = new Set\(\[([\s\S]*?)\]\);/,
)?.[1];
const operationLabels = html.match(/const OPERATION_LABELS = \{([\s\S]*?)\n\s*\};/)?.[1];

expect(relationOperations).toBeDefined();
expect(operationLabels).toBeDefined();
for (const [id, label] of additionalRelations) {
  expect(relationOperations).toContain(`'${id}'`);
  expect(operationLabels).toContain(`${id}: '${label}'`);
}
```

- [ ] **Step 3: Run the example contract test to verify RED**

Run:

```bash
rtk pnpm exec vitest run test/examples/duckdb-spatial-ops.test.ts --reporter=dot
```

Expected: the six option assertions fail because the HTML has not been updated.

- [ ] **Step 4: Update selector, relation set, and labels**

Add these selector options after `disjoint`:

```html
<option value="overlaps">Overlaps</option>
<option value="equals">Equals</option>
<option value="crosses">Crosses</option>
<option value="covers">Covers</option>
<option value="coveredBy">Covered By</option>
<option value="containsProperly">Contains Properly</option>
```

Add all six ids to `RELATION_OPERATIONS` and these entries to `OPERATION_LABELS`:

```js
overlaps: 'Overlaps',
equals: 'Equals',
crosses: 'Crosses',
covers: 'Covers',
coveredBy: 'Covered By',
containsProperly: 'Contains Properly',
```

Do not change `makeRelationOptions()`'s unrelated `layer` field in this task; that bug is MAP-154.

- [ ] **Step 5: Catalog all twelve helpers in both guide frontmatters**

Add these names in the same order to both `api` arrays:

```text
overlapsDatasetWithDuckDb
overlapsAttributeDatasetWithDuckDb
equalsDatasetWithDuckDb
equalsAttributeDatasetWithDuckDb
crossesDatasetWithDuckDb
crossesAttributeDatasetWithDuckDb
coversDatasetWithDuckDb
coversAttributeDatasetWithDuckDb
coveredByDatasetWithDuckDb
coveredByAttributeDatasetWithDuckDb
containsProperlyDatasetWithDuckDb
containsProperlyAttributeDatasetWithDuckDb
```

- [ ] **Step 6: Add synchronized relation documentation**

In both relation sections, add a table with operation id, DuckDB function, filter helper, attribute helper, and default output column. State explicitly:

```text
DuckDB evaluates every relation as ST_Function(inputGeometry, maskGeometry).
covers means the input covers a mask feature; coveredBy means the input is
covered by a mask feature; containsProperly means the input properly contains
a mask feature. All six predicates are topological and allow geographic CRS.
```

Translate the prose naturally in the Chinese guide while preserving the exact API names, function names, and argument order. Keep both frontmatter `api` arrays byte-for-byte equivalent after parsing.

- [ ] **Step 7: Verify example behavior and generate API documentation**

Run:

```bash
rtk pnpm run build
rtk pnpm exec vitest run test/examples/duckdb-spatial-ops.test.ts test/examples/duckdb-new-features.test.ts --reporter=dot
rtk pnpm run api:build
rtk pnpm run docs:check-i18n
rtk pnpm run docs:check-api
rtk pnpm run examples:check
```

Expected: example tests pass, TypeDoc emits twelve new helper pages, both language catalogs match, and every new public reflection is cataloged.

- [ ] **Step 8: Review generated scope and commit Task 5**

Review `rtk git status --short` and confirm ignored build directories (`dist/`, `packages/examples/dist/`, `packages/docs/build/`, `packages/docs/.docusaurus/`) are absent. Keep the complete related `packages/docs/static/api/**` output instead of cherry-picking individual generated assets.

Run GitNexus `detect_changes` with `scope: "all"`, then:

```bash
rtk git diff --check
rtk git add packages/examples/examples/duckdb-spatial-ops/index.html test/examples/duckdb-spatial-ops.test.ts packages/docs/docs/data/duckdb.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/duckdb.md packages/docs/static/api
rtk git commit -m "Document additional DuckDB relation predicates"
```

## Task 6: Complete Regression and Scope Verification

**Files:**

- Verify only; modify files only if a failing check exposes an in-scope regression and a focused failing test is added before the fix.

**Interfaces:**

- Consumes: all implementation, tests, docs, example, and generated API outputs from Tasks 1-5.
- Produces: fresh evidence that the complete repository contract remains valid.

- [ ] **Step 1: Run focused DuckDB relation tests**

Run:

```bash
rtk pnpm exec vitest run src/duckdb/duckdb-buffer.test.ts src/duckdb/duckdb-relation-ops.test.ts src/duckdb/map-op.test.ts --reporter=dot
```

Expected: all focused unit and map-op tests pass.

- [ ] **Step 2: Run the real relation integration test and complete DuckDB integration script**

Run:

```bash
rtk run 'DUCKDB_WASM_INTEGRATION=1 pnpm exec vitest run src/duckdb/duckdb-relation.integration.test.ts --reporter=dot'
rtk pnpm run test:duckdb
```

Expected: all DuckDB-Wasm integration files pass with zero skipped relation tests.

- [ ] **Step 3: Run repository-wide static and unit verification**

Run:

```bash
rtk pnpm run typecheck
rtk pnpm run format:check
rtk pnpm run build
rtk pnpm run test:run
```

Expected: typecheck, formatting, production bundles/declarations, and the full Vitest suite pass.

- [ ] **Step 4: Run complete documentation verification**

Run:

```bash
rtk pnpm run docs:verify
```

Expected: API generation, examples build, Docusaurus build, composition, i18n, API catalog, and example checks all pass.

- [ ] **Step 5: Run final GitNexus and git scope checks**

Run GitNexus `detect_changes` with `scope: "compare"`, `base_ref: "origin/master"`, `repo: "/Users/zhang/code/emap"`, and `worktree: "/Users/zhang/code/emap"`.

Expected affected scope:

```text
DuckDB relation SQL/spec/helper flow
runRelationOperation and duckDbRelationLayer
DuckDB relation tests
DuckDB guide and spatial example
generated DuckDB API documentation
```

Then run:

```bash
rtk git diff --check origin/master...HEAD
rtk git status --short
rtk git log --oneline origin/master..HEAD
```

Expected: no uncommitted changes, no whitespace errors, and only the approved design/plan plus Tasks 1-5 commits. If generated verification changed tracked API output after Task 5, inspect it, rerun `detect_changes`, and commit only the verified related generated files.
