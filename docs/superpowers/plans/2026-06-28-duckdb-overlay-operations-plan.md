# DuckDB Overlay Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DuckDB-Wasm `intersection` and `difference` overlay helpers that union mask geometries first, preserve input attributes, and expose the workflow through the map-op adapter.

**Architecture:** Add overlay as a dedicated DuckDB operation path beside relation operations. `duckdb-overlay-op.ts` owns conversion, table registration, constrained overlay SQL execution, result conversion, CRS carryover, and cleanup. `duckdb-overlay-ops.ts` exposes named public helpers. `duckdb-sql.ts` supplies a fixed-function SQL builder. `map-op.ts` adds `duckDbOverlayLayer()` that reads an input source and a mask source and writes the output source.

**Tech Stack:** TypeScript, DuckDB-Wasm, DuckDB Spatial, Apache Arrow, Mapshaper datasets, Vitest, GitNexus.

---

## File Structure

- Modify: `src/duckdb/duckdb-sql.ts`
  - Add `OverlayDuckDbFunction`, `BuildOverlaySqlOptions`, and `buildOverlaySql()`.
- Create: `src/duckdb/duckdb-overlay-op.ts`
  - Shared overlay executor for input/mask conversion, DuckDB lifecycle, result conversion, CRS carryover, and cleanup errors.
- Create: `src/duckdb/duckdb-overlay-op.test.ts`
  - SQL builder and fake-runtime executor tests.
- Create: `src/duckdb/duckdb-overlay-ops.ts`
  - Public operation ids, operation-spec lookup, and `intersectionDatasetWithDuckDb()` / `differenceDatasetWithDuckDb()`.
- Create: `src/duckdb/duckdb-overlay-ops.test.ts`
  - Named helper dispatch and validation tests.
- Create: `src/duckdb/duckdb-overlay.integration.test.ts`
  - Real DuckDB-Wasm intersection and difference tests.
- Modify: `src/duckdb/map-op.ts`
  - Add overlay option/result types and `duckDbOverlayLayer()`.
- Modify: `src/duckdb/map-op.test.ts`
  - Cover successful overlay writes plus validation and failure behavior.
- Modify: `src/duckdb/index.ts`
  - Export overlay operation modules.
- Modify: `package.json`
  - Include the new overlay integration file in `test:duckdb`.
- Modify: `README.md`
  - Document dataset helpers, map-op usage, and CRS/attribute semantics.

## Pre-Implementation Rules

- Before modifying an existing function, class, interface, or type, run GitNexus impact for that exact symbol and record the risk in the task log.
- Required shared-symbol impact checks before their first edit: `DuckDbMapOpSource`, `DuckDbMapOpContext`, `duckDbRelationLayer`, `duckDbGeoParquetQueryLayer`, `buildUnaryGeometrySql`, `buildRelationFilterSql`, and `processRelationWithDuckDb`.
- If impact analysis returns HIGH or CRITICAL risk, stop that task and report the affected callers before editing.
- Before every commit, run `rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged`.
- Stage only the files listed in the active task. Do not stage `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.codegraph/`, `.gstack/`, `.serena/`, or `.superpowers/`.
- Use Lore commit messages with `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, and `Not-tested:` trailers where they add useful context.
- Keep overlay separate from relation helpers; relation helpers answer predicate/distance questions, while overlay creates replacement geometry.

## Task 1: Add Overlay SQL Builder

**Files:**
- Modify: `src/duckdb/duckdb-sql.ts`
- Create: `src/duckdb/duckdb-overlay-op.test.ts`

- [ ] **Step 1: Run impact for shared SQL symbols before editing**

Run:

```bash
rtk node .gitnexus/run.cjs impact --repo emap buildUnaryGeometrySql
rtk node .gitnexus/run.cjs impact --repo emap buildRelationFilterSql
```

Expected: neither check reports HIGH or CRITICAL risk. The task adds a new builder and must not change current unary or relation SQL output.

- [ ] **Step 2: Add failing SQL builder tests**

Create `src/duckdb/duckdb-overlay-op.test.ts` with the first test block:

```ts
import type { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { processOverlayWithDuckDb } from './duckdb-overlay-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import { buildOverlaySql } from './duckdb-sql';

const INPUT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, name: 'a' },
      geometry: {
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
      },
    },
  ],
};

async function inputDataset(crs = 'EPSG:3857'): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(INPUT_FC);
  dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

describe('buildOverlaySql', () => {
  it('builds intersection SQL that unions mask geometry once', () => {
    expect(
      buildOverlaySql({
        duckDbFunction: 'ST_Intersection',
        inputGeometryColumn: 'geom',
        inputTableName: 'input table',
        maskGeometryColumn: 'mask geom',
        maskTableName: 'mask table',
      }),
    ).toContain('ST_Union_Agg(m."mask geom") AS mask_geometry');
  });

  it('builds difference SQL with fixed DuckDB Spatial function names', () => {
    const sql = buildOverlaySql({
      duckDbFunction: 'ST_Difference',
      inputGeometryColumn: 'geometry',
      inputTableName: 'input',
      maskGeometryColumn: 'geometry',
      maskTableName: 'mask',
    });

    expect(sql).toContain('ST_Difference(i."geometry", mask_coverage.mask_geometry)');
    expect(sql).toContain('i.* EXCLUDE ("geometry")');
    expect(sql).toContain('NOT ST_IsEmpty(overlay.overlay_geometry)');
  });

  it('rejects unsafe overlay function names', () => {
    expect(() =>
      buildOverlaySql({
        duckDbFunction: 'ST_Intersection); DROP TABLE x; --',
        inputGeometryColumn: 'geometry',
        inputTableName: 'input',
        maskGeometryColumn: 'geometry',
        maskTableName: 'mask',
      }),
    ).toThrow(/Unsafe DuckDB function name/);
  });
});
```

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
```

Expected: FAIL because `buildOverlaySql` is not implemented.

- [ ] **Step 3: Add overlay SQL types and builder**

In `src/duckdb/duckdb-sql.ts`, add this type near the relation function types:

```ts
export type OverlayDuckDbFunction = 'ST_Intersection' | 'ST_Difference';

export interface BuildOverlaySqlOptions {
  inputTableName: string;
  maskTableName: string;
  inputGeometryColumn: string;
  maskGeometryColumn: string;
  duckDbFunction: OverlayDuckDbFunction;
}
```

Add this builder after `buildRelationAttributeSql()`:

```ts
export function buildOverlaySql(opts: BuildOverlaySqlOptions): string {
  const inputTableName = quoteIdentifier(opts.inputTableName);
  const maskTableName = quoteIdentifier(opts.maskTableName);
  const inputGeometryColumn = `i.${quoteIdentifier(opts.inputGeometryColumn)}`;
  const maskGeometryColumn = `m.${quoteIdentifier(opts.maskGeometryColumn)}`;
  const outputGeometryColumn = quoteIdentifier(opts.inputGeometryColumn);
  const duckDbFunction = assertSafeDuckDbFunction(opts.duckDbFunction);
  const overlayExpression = `${duckDbFunction}(${inputGeometryColumn}, mask_coverage.mask_geometry)`;

  return [
    'WITH mask_coverage AS (',
    ' SELECT',
    `  ST_Union_Agg(${maskGeometryColumn}) AS mask_geometry`,
    ` FROM ${maskTableName} AS m`,
    ` WHERE ${maskGeometryColumn} IS NOT NULL`,
    '), overlay AS (',
    ' SELECT',
    `  i.* EXCLUDE (${outputGeometryColumn}),`,
    `  CASE WHEN mask_coverage.mask_geometry IS NULL THEN i.${outputGeometryColumn} ELSE ${overlayExpression} END AS overlay_geometry`,
    ` FROM ${inputTableName} AS i`,
    ' CROSS JOIN mask_coverage',
    ` WHERE ${inputGeometryColumn} IS NOT NULL`,
    ')',
    'SELECT',
    ' * EXCLUDE (overlay_geometry),',
    ` overlay_geometry AS ${outputGeometryColumn}`,
    'FROM overlay',
    'WHERE overlay_geometry IS NOT NULL',
    ' AND NOT ST_IsEmpty(overlay_geometry)',
  ].join('\n');
}
```

Then adjust the builder so `ST_Intersection` returns no rows when the mask union is absent. Use a branch inside `buildOverlaySql()`:

```ts
const emptyMaskPredicate =
  opts.duckDbFunction === 'ST_Intersection'
    ? 'mask_coverage.mask_geometry IS NOT NULL'
    : 'TRUE';
```

and include it in the overlay CTE `WHERE` list:

```ts
`  AND ${emptyMaskPredicate}`,
```

This preserves non-null input geometries for `difference` when the mask table has no usable geometry, while `intersection` returns an empty result.

- [ ] **Step 4: Run SQL tests**

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
rtk npm run test:run -- src/duckdb/duckdb-buffer.test.ts
```

Expected: PASS. Existing buffer SQL tests prove current SQL helpers were not regressed.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
rtk git add src/duckdb/duckdb-sql.ts src/duckdb/duckdb-overlay-op.test.ts
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
rtk git commit -m "$(cat <<'EOF'
Constrain overlay SQL to fixed DuckDB Spatial builders

Overlay needs replacement geometry rather than relation filtering, so
the SQL builder unions mask geometry once and computes per-input
intersection or difference using a fixed operation spec.

Constraint: Mask geometries are coverage-only and are unioned before overlay
Rejected: Extend relation SQL builders | overlay returns new geometry instead of predicate rows
Confidence: high
Scope-risk: narrow
Directive: Do not pass user-provided DuckDB function names into overlay SQL
Tested: npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
Tested: npm run test:run -- src/duckdb/duckdb-buffer.test.ts
EOF
)"
```

## Task 2: Implement Shared Overlay Executor

**Files:**
- Modify: `src/duckdb/duckdb-overlay-op.test.ts`
- Create: `src/duckdb/duckdb-overlay-op.ts`

- [ ] **Step 1: Add failing fake-runtime lifecycle tests**

Append these fake classes to `src/duckdb/duckdb-overlay-op.test.ts`:

```ts
class FakeConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly resultTable: Table,
    private readonly events: string[],
    private readonly queryError?: unknown,
    private readonly closeError?: unknown,
  ) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.events.push(`insert:${opts.name}`);
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.events.push('query');
    this.queries.push(sql);
    if (this.queryError && !sql.startsWith('DROP TABLE')) throw this.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.events.push('close');
    this.closed = true;
    if (this.closeError) throw this.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly events: string[] = [];
  readonly connection: FakeConnection;

  constructor(resultTable: Table, queryError?: unknown, closeError?: unknown) {
    this.connection = new FakeConnection(resultTable, this.events, queryError, closeError);
  }

  async connect(): Promise<DuckDbConnection> {
    this.events.push('connect');
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.events.push('ensureSpatial');
  }
}
```

Add executor tests:

```ts
describe('processOverlayWithDuckDb', () => {
  it('registers input and mask tables, runs overlay SQL, closes, and preserves input CRS', async () => {
    const input = await inputDataset('EPSG:3857');
    const mask = await inputDataset('EPSG:3857');
    const resultTable = toArrowTable(input, { encoding: 'wkb', geometryColumn: 'geometry' });
    const runtime = new FakeRuntime(resultTable);

    const result = await processOverlayWithDuckDb(
      input,
      mask,
      {
        inputGeometryColumn: 'geometry',
        maskGeometryColumn: 'geometry',
        outputLayer: 'clipped',
      },
      { id: 'intersection', duckDbFunction: 'ST_Intersection' },
      runtime,
    );

    expect(runtime.events).toEqual([
      'ensureSpatial',
      'connect',
      expect.stringMatching(/^insert:emap_duckdb_overlay_input_/),
      expect.stringMatching(/^insert:emap_duckdb_overlay_mask_/),
      'query',
      'query',
      'query',
      'close',
    ]);
    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
    expect(result.layers[0]?.name).toBe('clipped');
    expect(result.info?.crs_string).toBe('EPSG:3857');
  });

  it('wraps input conversion failures as conversion-failed', async () => {
    await expect(
      processOverlayWithDuckDb(
        { layers: [] },
        await inputDataset(),
        {},
        { id: 'difference', duckDbFunction: 'ST_Difference' },
        new FakeRuntime(toArrowTable(await inputDataset(), { encoding: 'wkb' })),
      ),
    ).rejects.toMatchObject({ kind: 'conversion-failed' });
  });

  it('preserves the primary query error when close also fails', async () => {
    const input = await inputDataset();
    const mask = await inputDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });

    await expect(
      processOverlayWithDuckDb(
        input,
        mask,
        {},
        { id: 'difference', duckDbFunction: 'ST_Difference' },
        new FakeRuntime(resultTable, new Error('query failed'), new Error('close failed')),
      ),
    ).rejects.toMatchObject({ kind: 'query-failed' });
  });

  it('reports cleanup failure after successful overlay work', async () => {
    const input = await inputDataset();
    const mask = await inputDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });

    await expect(
      processOverlayWithDuckDb(
        input,
        mask,
        {},
        { id: 'difference', duckDbFunction: 'ST_Difference' },
        new FakeRuntime(resultTable, undefined, new Error('close failed')),
      ),
    ).rejects.toMatchObject({ kind: 'query-failed' });
  });
});
```

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
```

Expected: FAIL because `processOverlayWithDuckDb` is not implemented.

- [ ] **Step 2: Create overlay executor**

Create `src/duckdb/duckdb-overlay-op.ts`:

```ts
import type { Table } from 'apache-arrow';
import { toArrowTable } from '../formats/dataset-to-table';
import { fromArrowTable } from '../formats/table-to-dataset';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { buildOverlaySql, type OverlayDuckDbFunction } from './duckdb-sql';

let duckDbOverlayInputTableSequence = 0;
let duckDbOverlayMaskTableSequence = 0;

export interface DuckDbOverlayOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
}

export interface DuckDbOverlayOperationSpec {
  id: string;
  duckDbFunction: OverlayDuckDbFunction;
}

function nextDuckDbOverlayInputTableName(): string {
  duckDbOverlayInputTableSequence += 1;
  return `emap_duckdb_overlay_input_${duckDbOverlayInputTableSequence}`;
}

function nextDuckDbOverlayMaskTableName(): string {
  duckDbOverlayMaskTableSequence += 1;
  return `emap_duckdb_overlay_mask_${duckDbOverlayMaskTableSequence}`;
}

function convertOverlayInput(
  dataset: MapshaperDataset,
  layer: string | number | undefined,
  geometryColumn: string,
  operationId: string,
): Table {
  try {
    return toArrowTable(dataset, { layer, encoding: 'wkb', geometryColumn });
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      `DuckDB ${operationId} input could not be converted to Arrow`,
      { cause: err },
    );
  }
}

export async function processOverlayWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayOptions,
  spec: DuckDbOverlayOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }

  const inputGeometryColumn =
    opts.inputGeometryColumn === undefined ? 'geometry' : opts.inputGeometryColumn;
  const maskGeometryColumn =
    opts.maskGeometryColumn === undefined ? 'geometry' : opts.maskGeometryColumn;
  const input = convertOverlayInput(inputDataset, opts.inputLayer, inputGeometryColumn, spec.id);
  const mask = convertOverlayInput(maskDataset, opts.maskLayer, maskGeometryColumn, spec.id);

  try {
    await runtime.ensureSpatial();
  } catch (err) {
    throw new DuckDbOperationError(
      'spatial-extension-unavailable',
      'DuckDB spatial extension is unavailable',
      { cause: err },
    );
  }

  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined;
  let inputTableName: string | undefined;
  let maskTableName: string | undefined;
  let primaryError: unknown;

  try {
    conn = await runtime.connect();
    inputTableName = nextDuckDbOverlayInputTableName();
    maskTableName = nextDuckDbOverlayMaskTableName();

    await conn.insertArrowTable(input, { name: inputTableName });
    await conn.insertArrowTable(mask, { name: maskTableName });

    const resultTable = await conn.query(
      buildOverlaySql({
        duckDbFunction: spec.duckDbFunction,
        inputGeometryColumn,
        inputTableName,
        maskGeometryColumn,
        maskTableName,
      }),
    );

    try {
      const result = fromArrowTable(resultTable, { layerName: opts.outputLayer });
      if (inputDataset.info?.crs_string) {
        result.info = { ...result.info, crs_string: inputDataset.info.crs_string };
      }
      return result;
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        `DuckDB ${spec.id} result could not be converted to a dataset`,
        { cause: err },
      );
    }
  } catch (err) {
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', `DuckDB ${spec.id} query failed`, {
      cause: err,
    });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    let cleanupError: unknown;
    if (conn && inputTableName) {
      try {
        await conn.query(`DROP TABLE IF EXISTS ${inputTableName}`);
      } catch (err) {
        cleanupError = err;
      }
    }
    if (conn && maskTableName) {
      try {
        await conn.query(`DROP TABLE IF EXISTS ${maskTableName}`);
      } catch (err) {
        if (!cleanupError) cleanupError = err;
      }
    }
    try {
      await conn?.close?.();
    } catch (err) {
      if (!cleanupError) cleanupError = err;
    }
    if (cleanupError && !primaryError) {
      throw new DuckDbOperationError('query-failed', `DuckDB ${spec.id} cleanup failed`, {
        cause: cleanupError,
      });
    }
  }
}
```

If TypeScript reports that `DROP TABLE` identifiers need quoting, add a private quote helper to this file and use it for cleanup table names.

- [ ] **Step 3: Run focused executor tests**

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
rtk git add src/duckdb/duckdb-overlay-op.ts src/duckdb/duckdb-overlay-op.test.ts
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
rtk git commit -m "$(cat <<'EOF'
Execute DuckDB overlay operations through a dedicated lifecycle

The executor mirrors existing DuckDB helpers while preserving the
primary failure when cleanup also fails and surfacing cleanup failures
after otherwise successful work.

Constraint: Overlay result CRS must inherit from the input dataset
Rejected: Reuse relation executor | relation operations do not replace geometry
Confidence: high
Scope-risk: moderate
Directive: Keep mask attributes out of overlay results unless the public API is redesigned
Tested: npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
Tested: npm run typecheck
EOF
)"
```

## Task 3: Add Public Named Overlay Helpers

**Files:**
- Create: `src/duckdb/duckdb-overlay-ops.ts`
- Create: `src/duckdb/duckdb-overlay-ops.test.ts`

- [ ] **Step 1: Add failing helper tests**

Create `src/duckdb/duckdb-overlay-ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toArrowTable } from '../formats/dataset-to-table';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import {
  differenceDatasetWithDuckDb,
  getDuckDbOverlayOperationSpec,
  intersectionDatasetWithDuckDb,
} from './duckdb-overlay-ops';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

const FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

async function dataset(): Promise<MapshaperDataset> {
  return datasetFromGeoJSON(FC);
}

class CaptureConnection implements DuckDbConnection {
  readonly queries: string[] = [];

  constructor(private readonly resultTable: ReturnType<typeof toArrowTable>) {}

  async insertArrowTable(): Promise<void> {}

  async query(sql: string) {
    this.queries.push(sql);
    return this.resultTable;
  }

  async close(): Promise<void> {}
}

class CaptureRuntime implements DuckDbRuntime {
  readonly connection: CaptureConnection;

  constructor(resultTable: ReturnType<typeof toArrowTable>) {
    this.connection = new CaptureConnection(resultTable);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {}
}

describe('DuckDB overlay named helpers', () => {
  it('looks up fixed operation specs', () => {
    expect(getDuckDbOverlayOperationSpec('intersection')).toEqual({
      duckDbFunction: 'ST_Intersection',
      id: 'intersection',
    });
    expect(getDuckDbOverlayOperationSpec('difference')).toEqual({
      duckDbFunction: 'ST_Difference',
      id: 'difference',
    });
  });

  it('rejects unsupported operations', () => {
    expect(() => getDuckDbOverlayOperationSpec('union')).toThrow(DuckDbOperationError);
  });

  it('dispatches intersection and preserves configurable output layer', async () => {
    const input = await dataset();
    const mask = await dataset();
    const runtime = new CaptureRuntime(toArrowTable(input, { encoding: 'wkb' }));

    const result = await intersectionDatasetWithDuckDb(
      input,
      mask,
      { outputLayer: 'clipped' },
      runtime,
    );

    expect(runtime.connection.queries[0]).toContain('ST_Intersection');
    expect(result.layers[0]?.name).toBe('clipped');
  });

  it('dispatches difference', async () => {
    const input = await dataset();
    const mask = await dataset();
    const runtime = new CaptureRuntime(toArrowTable(input, { encoding: 'wkb' }));

    await differenceDatasetWithDuckDb(input, mask, {}, runtime);

    expect(runtime.connection.queries[0]).toContain('ST_Difference');
  });
});
```

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay-ops.test.ts
```

Expected: FAIL because the helper module is missing.

- [ ] **Step 2: Create named helper module**

Create `src/duckdb/duckdb-overlay-ops.ts`:

```ts
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import {
  processOverlayWithDuckDb,
  type DuckDbOverlayOperationSpec,
  type DuckDbOverlayOptions,
} from './duckdb-overlay-op';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';

export type DuckDbOverlayOperationId = 'intersection' | 'difference';

const OVERLAY_OPERATION_SPECS = {
  intersection: {
    id: 'intersection',
    duckDbFunction: 'ST_Intersection',
  },
  difference: {
    id: 'difference',
    duckDbFunction: 'ST_Difference',
  },
} as const satisfies Record<DuckDbOverlayOperationId, DuckDbOverlayOperationSpec>;

export type DuckDbOverlayHelperOptions = DuckDbOverlayOptions;

export function getDuckDbOverlayOperationSpec(operation: string): DuckDbOverlayOperationSpec {
  const spec = OVERLAY_OPERATION_SPECS[operation as DuckDbOverlayOperationId];
  if (!spec) {
    throw new DuckDbOperationError(
      'validation',
      `Unsupported DuckDB overlay operation: ${operation}`,
    );
  }
  return spec;
}

function runOverlayHelper(
  operation: DuckDbOverlayOperationId,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  return processOverlayWithDuckDb(
    inputDataset,
    maskDataset,
    opts,
    getDuckDbOverlayOperationSpec(operation),
    runtime,
  );
}

export function intersectionDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runOverlayHelper('intersection', inputDataset, maskDataset, opts, runtime);
}

export function differenceDatasetWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return runOverlayHelper('difference', inputDataset, maskDataset, opts, runtime);
}
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay-ops.test.ts
rtk npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
rtk git add src/duckdb/duckdb-overlay-ops.ts src/duckdb/duckdb-overlay-ops.test.ts
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
rtk git commit -m "$(cat <<'EOF'
Expose named DuckDB overlay helpers

Named helpers keep the public API constrained to intersection and
difference while reusing one executor for the shared input-mask overlay
pipeline.

Constraint: First overlay batch excludes union and symmetric difference
Rejected: Generic string operation helper | public callers should not select arbitrary DuckDB functions
Confidence: high
Scope-risk: narrow
Tested: npm run test:run -- src/duckdb/duckdb-overlay-ops.test.ts
Tested: npm run test:run -- src/duckdb/duckdb-overlay-op.test.ts
Tested: npm run typecheck
EOF
)"
```

## Task 4: Add Real DuckDB-Wasm Overlay Coverage

**Files:**
- Create: `src/duckdb/duckdb-overlay.integration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing integration tests**

Create `src/duckdb/duckdb-overlay.integration.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import { setDuckDbRuntime } from './duckdb-runtime';
import {
  differenceDatasetWithDuckDb,
  intersectionDatasetWithDuckDb,
} from './duckdb-overlay-ops';
import { createDuckDbTestRuntime } from './duckdb-query.integration.test';

const INPUT = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, name: 'keep' },
      geometry: {
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
      },
    },
  ],
};

const MASK = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { maskName: 'clip' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [5, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

describe('DuckDB overlay integration', () => {
  beforeAll(async () => {
    setDuckDbRuntime(await createDuckDbTestRuntime());
  });

  it('clips polygon geometry with intersection and preserves input attributes', async () => {
    const input = await datasetFromGeoJSON(INPUT);
    input.info = { ...input.info, crs_string: 'EPSG:3857' };
    const mask = await datasetFromGeoJSON(MASK);

    const result = await intersectionDatasetWithDuckDb(input, mask, {
      outputLayer: 'clipped',
    });

    expect(result.layers[0]?.name).toBe('clipped');
    expect(result.layers[0]?.data?.getRecords()).toEqual([{ id: 1, name: 'keep' }]);
    expect(result.info?.crs_string).toBe('EPSG:3857');
    expect(result.layers[0]?.shapes).toHaveLength(1);
  });

  it('erases mask coverage with difference and omits mask attributes', async () => {
    const input = await datasetFromGeoJSON(INPUT);
    const mask = await datasetFromGeoJSON(MASK);

    const result = await differenceDatasetWithDuckDb(input, mask, {
      outputLayer: 'erased',
    });

    expect(result.layers[0]?.name).toBe('erased');
    expect(result.layers[0]?.data?.getRecords()).toEqual([{ id: 1, name: 'keep' }]);
    expect(result.layers[0]?.data?.getFields()).not.toContain('maskName');
    expect(result.layers[0]?.shapes).toHaveLength(1);
  });

  it('returns no intersection rows for an empty mask dataset', async () => {
    const input = await datasetFromGeoJSON(INPUT);
    const mask = await datasetFromGeoJSON({ type: 'FeatureCollection', features: [] });

    const result = await intersectionDatasetWithDuckDb(input, mask, {
      outputLayer: 'empty_clip',
    });

    expect(result.layers[0]?.name).toBe('empty_clip');
    expect(result.layers[0]?.shapes).toHaveLength(0);
    expect(result.layers[0]?.data?.getRecords()).toEqual([]);
  });

  it('keeps non-null input rows for difference with an empty mask dataset', async () => {
    const input = await datasetFromGeoJSON(INPUT);
    const mask = await datasetFromGeoJSON({ type: 'FeatureCollection', features: [] });

    const result = await differenceDatasetWithDuckDb(input, mask, {
      outputLayer: 'unchanged',
    });

    expect(result.layers[0]?.name).toBe('unchanged');
    expect(result.layers[0]?.data?.getRecords()).toEqual([{ id: 1, name: 'keep' }]);
    expect(result.layers[0]?.shapes).toHaveLength(1);
  });
});
```

Run:

```bash
rtk npm run test:run -- src/duckdb/duckdb-overlay.integration.test.ts
```

Expected: PASS after Tasks 1-3; if the empty-mask conversion exposes a zero-row schema issue, fix the executor or SQL in this task and keep the public behavior unchanged.

- [ ] **Step 2: Add integration test to the DuckDB suite script**

Modify `package.json` `test:duckdb` to include:

```json
"src/duckdb/duckdb-overlay.integration.test.ts"
```

Keep existing integration files in the script.

- [ ] **Step 3: Run DuckDB integration suite**

Run:

```bash
rtk npm run test:duckdb
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
rtk git add src/duckdb/duckdb-overlay.integration.test.ts package.json
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
rtk git commit -m "$(cat <<'EOF'
Verify overlay helpers against real DuckDB-Wasm

The integration suite now covers actual DuckDB Spatial intersection and
difference results, including empty mask behavior and input-attribute
ownership.

Constraint: Overlay correctness depends on DuckDB Spatial runtime behavior, not only generated SQL
Rejected: Fake-runtime-only coverage | it cannot prove Spatial function execution or Arrow round-trip behavior
Confidence: high
Scope-risk: moderate
Tested: npm run test:duckdb
Tested: npm run typecheck
EOF
)"
```

## Task 5: Add Map Operation Wrapper

**Files:**
- Modify: `src/duckdb/map-op.ts`
- Modify: `src/duckdb/map-op.test.ts`

- [ ] **Step 1: Run impact for map-op symbols before editing**

Run:

```bash
rtk node .gitnexus/run.cjs impact --repo emap DuckDbMapOpSource
rtk node .gitnexus/run.cjs impact --repo emap DuckDbMapOpContext
rtk node .gitnexus/run.cjs impact --repo emap duckDbRelationLayer
rtk node .gitnexus/run.cjs impact --repo emap duckDbGeoParquetQueryLayer
```

Expected: no HIGH or CRITICAL risk. If a risk is high, report it before editing.

- [ ] **Step 2: Add failing map-op tests**

Append to `src/duckdb/map-op.test.ts`:

```ts
describe('duckDbOverlayLayer', () => {
  it('writes overlay result to output source id', async () => {
    const input = await polygonDataset();
    const mask = await polygonDataset();
    const resultTable = toArrowTable(input, { encoding: 'wkb' });
    const runtime = new FakeRuntime(resultTable);
    const ctx = makeContext({ parcels: input, mask });

    const result = await duckDbOverlayLayer(ctx, {
      src: 'parcels',
      mask: 'mask',
      operation: 'intersection',
      output: { sourceId: 'clipped' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputs.get('clipped')).toBeDefined();
    expect(runtime.connection.queries.some((sql) => sql.includes('ST_Intersection'))).toBe(true);
  });

  it('returns not-found when mask source is missing', async () => {
    const ctx = makeContext({ parcels: await polygonDataset() });

    const result = await duckDbOverlayLayer(ctx, {
      src: 'parcels',
      mask: 'missing',
      operation: 'difference',
      output: { sourceId: 'erased' },
      runtime: new FakeRuntime(toArrowTable(await polygonDataset(), { encoding: 'wkb' })),
    });

    expect(result).toMatchObject({ ok: false, error: { kind: 'not-found' } });
    expect(ctx.outputs.has('erased')).toBe(false);
  });

  it('validates output source id before writing', async () => {
    const ctx = makeContext({
      parcels: await polygonDataset(),
      mask: await polygonDataset(),
    });

    const result = await duckDbOverlayLayer(ctx, {
      src: 'parcels',
      mask: 'mask',
      operation: 'intersection',
    } as never);

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  it('does not write output when DuckDB fails', async () => {
    const ctx = makeContext({
      parcels: await polygonDataset(),
      mask: await polygonDataset(),
    });

    const result = await duckDbOverlayLayer(ctx, {
      src: 'parcels',
      mask: 'mask',
      operation: 'difference',
      output: { sourceId: 'erased' },
      runtime: new FakeRuntime(toArrowTable(await polygonDataset(), { encoding: 'wkb' }), new Error('boom')),
    });

    expect(result.ok).toBe(false);
    expect(ctx.outputs.has('erased')).toBe(false);
  });
});
```

Adjust names if `map-op.test.ts` already uses different fake context field names; keep the assertions equivalent.

Run:

```bash
rtk npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: FAIL because `duckDbOverlayLayer` is not implemented.

- [ ] **Step 3: Add overlay imports, option types, and wrapper**

In `src/duckdb/map-op.ts`, import:

```ts
import {
  differenceDatasetWithDuckDb,
  intersectionDatasetWithDuckDb,
  type DuckDbOverlayHelperOptions,
  type DuckDbOverlayOperationId,
} from './duckdb-overlay-ops';
```

Add types near the existing relation options:

```ts
export interface DuckDbOverlayLayerOptions {
  src: string;
  mask: string;
  operation: DuckDbOverlayOperationId;
  inputLayer?: string | number;
  maskLayer?: string | number;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime | null;
}

export type DuckDbOverlayLayerResult = OpResult<{ sourceId: string; dataset: MapshaperDataset }>;
```

Add a small option mapper:

```ts
function overlayOptions(opts: DuckDbOverlayLayerOptions): DuckDbOverlayHelperOptions {
  return {
    inputLayer: opts.inputLayer,
    maskLayer: opts.maskLayer,
    outputLayer: opts.output?.sourceId,
  };
}
```

Add operation dispatch:

```ts
async function runOverlayOperation(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayLayerOptions,
): Promise<MapshaperDataset> {
  const helperOpts = overlayOptions(opts);
  switch (opts.operation) {
    case 'intersection':
      return intersectionDatasetWithDuckDb(inputDataset, maskDataset, helperOpts, opts.runtime);
    case 'difference':
      return differenceDatasetWithDuckDb(inputDataset, maskDataset, helperOpts, opts.runtime);
    default:
      throw new DuckDbOperationError(
        'validation',
        `Unsupported DuckDB overlay operation: ${String(opts.operation)}`,
      );
  }
}
```

Add the public map operation:

```ts
export async function duckDbOverlayLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbOverlayLayerOptions,
): Promise<DuckDbOverlayLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;
  const mask = readInputDataset(ctx, opts.mask, 'mask');
  if (!mask.ok) return mask.result;
  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await runOverlayOperation(input.dataset, mask.dataset, opts);
    ctx.setSource(sourceId, { dataset });
    return { ok: true, value: { sourceId, dataset } };
  } catch (err) {
    return duckDbErrorToOpResult(err, `DuckDB ${opts.operation} overlay layer`);
  }
}
```

- [ ] **Step 4: Run map-op tests**

Run:

```bash
rtk npm run test:run -- src/duckdb/map-op.test.ts
rtk npm run test:run -- src/duckdb/duckdb-overlay-ops.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
rtk git add src/duckdb/map-op.ts src/duckdb/map-op.test.ts
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
rtk git commit -m "$(cat <<'EOF'
Expose DuckDB overlay through map operations

The map adapter now reads input and mask sources, dispatches the fixed
overlay helper, and writes the resulting dataset only after successful
DuckDB processing.

Constraint: Map-op failures must not write partial output sources
Rejected: Encode overlay as relation operation | overlay modifies geometry and has different attribute ownership
Confidence: high
Scope-risk: moderate
Tested: npm run test:run -- src/duckdb/map-op.test.ts
Tested: npm run test:run -- src/duckdb/duckdb-overlay-ops.test.ts
Tested: npm run typecheck
EOF
)"
```

## Task 6: Export And Document Overlay Operations

**Files:**
- Modify: `src/duckdb/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Export overlay modules**

In `src/duckdb/index.ts`, add:

```ts
export * from './duckdb-overlay-op';
export * from './duckdb-overlay-ops';
```

- [ ] **Step 2: Add README examples**

In the README DuckDB section, add concise examples:

```ts
import {
  differenceDatasetWithDuckDb,
  duckDbOverlayLayer,
  intersectionDatasetWithDuckDb,
} from '@zwishing/emap/duckdb';

const clipped = await intersectionDatasetWithDuckDb(parcels, floodplain, {
  inputLayer: 'parcels',
  maskLayer: 'floodplain',
  outputLayer: 'parcels_clipped',
});

const erased = await differenceDatasetWithDuckDb(parcels, floodplain, {
  outputLayer: 'parcels_erased',
});

await duckDbOverlayLayer(ctx, {
  src: 'parcels',
  mask: 'floodplain',
  operation: 'intersection',
  output: { sourceId: 'parcels-clipped' },
});
```

Document these semantics near the example:

- Mask geometries are unioned before overlay.
- Output keeps input attributes only.
- Mask attributes are not copied.
- Output CRS metadata inherits from the input dataset.
- Input and mask datasets must already use the same CRS.

- [ ] **Step 3: Run documentation-adjacent checks**

Run:

```bash
rtk npm run typecheck
rtk npm run format:check
rtk git diff --check
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

Run:

```bash
rtk git add src/duckdb/index.ts README.md
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
rtk git commit -m "$(cat <<'EOF'
Document DuckDB overlay helpers

The public DuckDB entrypoint and README now describe the overlay helper
surface and the input-owned attribute semantics.

Constraint: Overlay API is public through @zwishing/emap/duckdb
Rejected: Leave helper undocumented | CRS and mask-attribute behavior are easy to misuse
Confidence: high
Scope-risk: narrow
Tested: npm run typecheck
Tested: npm run format:check
Tested: git diff --check
EOF
)"
```

## Task 7: Final Verification And Release-Readiness Pass

**Files:**
- No planned source edits. If this task finds a defect, fix it in the smallest owned file set and create a Lore commit for the fix.

- [ ] **Step 1: Run full verification**

Run:

```bash
rtk npm run test:run
rtk npm run test:duckdb
rtk npm run typecheck
rtk npm run build
rtk npm run format:check
rtk git diff --check
rtk git status --short
```

Expected:

- All commands pass.
- Only intentional overlay-related changes are present.
- Pre-existing unrelated dirty files are not staged.

- [ ] **Step 2: Inspect changed symbols**

Run:

```bash
rtk node .gitnexus/run.cjs detect_changes --repo emap --scope staged
```

Expected: affected symbols are limited to the new overlay operation path, `duckdb-sql.ts` overlay builder addition, map-op overlay wrapper, exports, README, and test/script updates.

- [ ] **Step 3: Manual review checklist**

Verify:

- `intersection` uses `ST_Intersection`.
- `difference` uses `ST_Difference`.
- Mask geometries are unioned with `ST_Union_Agg`.
- No mask attributes appear in output records.
- Input attributes remain intact.
- Output CRS inherits input CRS.
- Missing `src`, missing `mask`, missing output, unsupported operation, runtime failure, query failure, conversion failure, and cleanup failure all have deterministic behavior.
- Geographic CRS is not rejected.
- Relation, attribute, unary geometry, buffer, query, and GeoParquet helpers remain source-compatible.

## Implementation Notes

- DuckDB Spatial functions used by this plan: `ST_Union_Agg`, `ST_Intersection`, `ST_Difference`, and `ST_IsEmpty`.
- The first implementation keeps overlay output geometry in the input geometry column name.
- This plan intentionally does not add pairwise overlay, mask attributes, `union`, or symmetric difference.
- This plan intentionally does not reproject input/mask CRS. The caller remains responsible for CRS compatibility.
- If real DuckDB tests show `i.* EXCLUDE ("geometry")` is rejected with table aliases, change only `buildOverlaySql()` and its SQL tests to the DuckDB-supported aliased projection form, then rerun all overlay tests before committing that task.
