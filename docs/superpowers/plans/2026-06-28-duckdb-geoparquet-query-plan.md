# DuckDB GeoParquet Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DuckDB-Wasm helper and map operation that query GeoParquet bytes through DuckDB's parquet reader and return a `MapshaperDataset`.

**Architecture:** The implementation extends the existing restricted `SELECT` validator so one caller can allow geometry projection while existing dataset-backed queries keep row-id geometry reconstruction. A new GeoParquet query helper registers bytes in DuckDB's virtual filesystem, creates a temporary `read_parquet()` view, validates `SELECT ... FROM input ...`, executes the rewritten SQL, and converts the Arrow result with `fromArrowTable()`. Map-op integration adds a byte-source path beside the existing dataset-source operations.

**Tech Stack:** TypeScript, DuckDB-Wasm, Apache Arrow, GeoParquet, Mapshaper datasets, Vitest, GitNexus, CodeGraph.

---

## File Structure

- Modify: `src/duckdb/duckdb-query-sql.ts`
  - Add an opt-in geometry projection mode and an opt-out row-id mode for file-backed queries.
- Modify: `src/duckdb/duckdb-query-sql.test.ts`
  - Lock current dataset-backed behavior and add GeoParquet SQL contract coverage.
- Modify: `src/duckdb/duckdb-runtime.ts`
  - Add `registerFileBuffer()` and `dropFile()` to the runtime abstraction and DuckDB-Wasm adapter.
- Create: `src/duckdb/duckdb-geoparquet-query-op.ts`
  - Own byte normalization, virtual file registration, temporary view lifecycle, SQL validation, query execution, Arrow result conversion, and cleanup errors.
- Create: `src/duckdb/duckdb-geoparquet-query-op.test.ts`
  - Fake-runtime unit tests for helper lifecycle, SQL restrictions, conversion failures, and cleanup precedence.
- Modify: `src/duckdb/duckdb-query.integration.test.ts`
  - Extend the real DuckDB-Wasm test runtime with file registration methods.
- Create: `src/duckdb/duckdb-geoparquet-query.integration.test.ts`
  - Real DuckDB-Wasm tests that export small GeoParquet bytes and query them with DuckDB's parquet reader.
- Modify: `src/duckdb/map-op.ts`
  - Add byte-source support and `duckDbGeoParquetQueryLayer()`.
- Modify: `src/duckdb/map-op.test.ts`
  - Cover byte source success, missing source, non-byte source, missing output, and helper failure mapping.
- Modify: `src/duckdb/index.ts`
  - Export the new helper through the existing DuckDB entrypoint.
- Modify: `package.json`
  - Include the new integration test in `test:duckdb`.
- Modify: `README.md`
  - Document the GeoParquet bytes query helper and map operation.

## Pre-Implementation Rules

- Before modifying an existing function, class, or method, run GitNexus impact for that exact symbol and record the risk in the task log. Required symbols include `validateDuckDbSelectSql`, `createDuckDbRuntimeFromJsDelivr`, `duckDbQueryLayer`, and `DuckDbMapOpSource`.
- If impact analysis reports HIGH or CRITICAL risk, stop that task and surface the risk before editing.
- Before every commit, run `node .gitnexus/run.cjs detect_changes --repo emap --scope staged`.
- Stage only files listed in that task. Do not stage `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.codegraph/`, `.gstack/`, `.serena/`, or `.superpowers/`.
- Use Lore commit messages with `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, and `Not-tested:` trailers where useful.

## Task 1: Extend Restricted SELECT Validation For Geometry Projection

**Files:**
- Modify: `src/duckdb/duckdb-query-sql.ts`
- Modify: `src/duckdb/duckdb-query-sql.test.ts`

- [ ] **Step 1: Run impact before editing**

Run:

```bash
node .gitnexus/run.cjs impact --repo emap validateDuckDbSelectSql
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before editing.

- [ ] **Step 2: Add failing GeoParquet-mode validator tests**

Append this helper and tests inside `src/duckdb/duckdb-query-sql.test.ts`:

```ts
function validateGeoParquet(sql: string) {
  return validateDuckDbSelectSql(sql, {
    allowGeometryProjection: true,
    availableColumns: columns,
    geometryColumn: 'geometry',
    inputTableName: 'input',
    physicalTableName: 'emap_duckdb_geoparquet_input_1',
    rowIdColumn: null,
  });
}

describe('validateDuckDbSelectSql for GeoParquet results', () => {
  it('allows geometry projection without adding an internal row id', () => {
    expect(validateGeoParquet('SELECT geometry, name FROM input WHERE population > 10')).toEqual({
      outputColumns: ['geometry', 'name'],
      rowIdColumn: null,
      sql: 'SELECT "input"."geometry" AS "geometry", "input"."name" AS "name" FROM "emap_duckdb_geoparquet_input_1" AS "input" WHERE population > 10',
    });
  });

  it('expands star to include geometry when geometry projection is allowed', () => {
    expect(validateGeoParquet('SELECT * FROM input LIMIT 1')).toEqual({
      outputColumns: ['name', 'population', 'active', 'geometry'],
      rowIdColumn: null,
      sql: 'SELECT "input"."name" AS "name", "input"."population" AS "population", "input"."active" AS "active", "input"."geometry" AS "geometry" FROM "emap_duckdb_geoparquet_input_1" AS "input" LIMIT 1',
    });
  });

  it('still rejects geometry in WHERE and ORDER BY clauses', () => {
    expect(() => validateGeoParquet('SELECT geometry FROM input WHERE geometry = 1')).toThrow(
      DuckDbOperationError,
    );
    expect(() => validateGeoParquet('SELECT geometry FROM input ORDER BY geometry')).toThrow(
      DuckDbOperationError,
    );
  });

  it('rejects direct read_parquet calls in user SQL', () => {
    expect(() =>
      validateGeoParquet("SELECT geometry FROM read_parquet('file.parquet')"),
    ).toThrow(DuckDbOperationError);
  });
});
```

Keep the existing test named `rejects geometry projection`; it must still pass in default dataset-query mode.

- [ ] **Step 3: Run the focused SQL test and confirm failure**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-sql.test.ts
```

Expected: FAIL because `allowGeometryProjection` and `rowIdColumn: null` are not supported.

- [ ] **Step 4: Update the validator option and return types**

In `src/duckdb/duckdb-query-sql.ts`, change the option and result interfaces to:

```ts
export interface ValidateDuckDbSelectSqlOptions {
  allowGeometryProjection?: boolean;
  availableColumns: readonly string[];
  geometryColumn?: string;
  inputTableName?: string;
  physicalTableName: string;
  rowIdColumn?: string | null;
}

export interface ValidatedDuckDbSelectSql {
  outputColumns: string[];
  rowIdColumn: string | null;
  sql: string;
}
```

Replace the current column-set setup and select-list construction inside `validateDuckDbSelectSql()` with:

```ts
  const rowIdColumn =
    opts.rowIdColumn === null ? null : (opts.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN);
  const geometryColumn = opts.geometryColumn ?? DEFAULT_GEOMETRY_COLUMN;
  const scalarColumns = selectableColumnSet(opts.availableColumns, {
    allowGeometryProjection: false,
    geometryColumn,
    rowIdColumn,
  });
  const projectionColumns = selectableColumnSet(opts.availableColumns, {
    allowGeometryProjection: opts.allowGeometryProjection === true,
    geometryColumn,
    rowIdColumn,
  });
```

Keep `validateTail(tail, maskedTail, scalarColumns)` so geometry stays forbidden in `WHERE` and `ORDER BY`.

Replace:

```ts
  const outputColumns = parseProjection(projectionSql, scalarColumns);
  const selectList = [
    `${quoteIdentifier(inputTableName)}.${quoteIdentifier(rowIdColumn)} AS ${quoteIdentifier(rowIdColumn)}`,
    ...outputColumns.map(
      (column) =>
        `${quoteIdentifier(inputTableName)}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`,
    ),
  ].join(', ');
```

with:

```ts
  const outputColumns = parseProjection(projectionSql, projectionColumns);
  const rowIdSelect = rowIdColumn
    ? [
        `${quoteIdentifier(inputTableName)}.${quoteIdentifier(rowIdColumn)} AS ${quoteIdentifier(rowIdColumn)}`,
      ]
    : [];
  const selectList = [
    ...rowIdSelect,
    ...outputColumns.map(
      (column) =>
        `${quoteIdentifier(inputTableName)}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`,
    ),
  ].join(', ');
```

Replace `scalarColumnSet()` with:

```ts
function selectableColumnSet(
  availableColumns: readonly string[],
  opts: {
    allowGeometryProjection: boolean;
    geometryColumn: string;
    rowIdColumn: string | null;
  },
): ReadonlySet<string> {
  return new Set(
    availableColumns.filter((column) => {
      if (opts.rowIdColumn && column === opts.rowIdColumn) return false;
      if (!opts.allowGeometryProjection && column === opts.geometryColumn) return false;
      return true;
    }),
  );
}
```

Add `read_parquet` to `UNSUPPORTED_KEYWORD_PATTERNS`:

```ts
  /\bread_parquet\s*\(/i,
```

- [ ] **Step 5: Run the focused SQL test and confirm pass**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-sql.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/duckdb/duckdb-query-sql.ts src/duckdb/duckdb-query-sql.test.ts
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Allow restricted DuckDB queries to project geometry when requested" \
  -m "GeoParquet-backed queries need the result Arrow table to carry geometry, while dataset-backed queries still reconstruct geometry from row ids. The validator now keeps geometry projection opt-in and row-id projection configurable." \
  -m "Constraint: Existing dataset query SQL must continue rejecting geometry projection by default" \
  -m "Rejected: Allow geometry predicates now | the current validator only proves scalar predicates safe" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep allowGeometryProjection false for dataset-backed query helpers" \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-query-sql.test.ts" \
  -m "Not-tested: Real DuckDB GeoParquet query execution"
```

## Task 2: Add DuckDB Virtual File Runtime Methods

**Files:**
- Modify: `src/duckdb/duckdb-runtime.ts`
- Modify: `src/duckdb/duckdb-query.integration.test.ts`

- [ ] **Step 1: Run impact before editing runtime**

Run:

```bash
node .gitnexus/run.cjs impact --repo emap createDuckDbRuntimeFromJsDelivr
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before editing.

- [ ] **Step 2: Write a compile-time shape test through the existing integration fake**

In `src/duckdb/duckdb-query.integration.test.ts`, extend `BlockingDuckDbConnectionLike` only after this task's runtime interface exists. First, add the runtime methods to the object returned by `createBlockingDuckDbRuntime()`:

```ts
    async registerFileBuffer() {
      throw new Error('queryDatasetWithDuckDb should not register files');
    },
    async dropFile() {
      throw new Error('queryDatasetWithDuckDb should not drop files');
    },
```

Place these next to `ensureSpatial()` and `close()`. The current type should fail until `DuckDbRuntime` allows these methods.

- [ ] **Step 3: Run typecheck and confirm failure**

Run:

```bash
npm run typecheck
```

Expected: FAIL because `DuckDbRuntime` does not declare `registerFileBuffer()` and `dropFile()`.

- [ ] **Step 4: Extend `DuckDbRuntime` and DuckDB-Wasm adapter**

In `src/duckdb/duckdb-runtime.ts`, update the runtime interfaces:

```ts
export interface DuckDbRuntime {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  dropFile?(name: string): Promise<void>;
  close?(): Promise<void>;
}
```

Update `DuckDbWasmDatabaseLike`:

```ts
type DuckDbWasmDatabaseLike = {
  connect(): Promise<unknown>;
  dropFile?(name: string): Promise<unknown>;
  instantiate(mainModule: string, pthreadWorker?: string): Promise<unknown>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  terminate(): Promise<unknown>;
};
```

Add these methods to the object returned by `createDuckDbRuntimeFromJsDelivr()`:

```ts
    async registerFileBuffer(name, buffer) {
      if (typeof db.registerFileBuffer !== 'function') {
        throw new Error('DuckDB-Wasm runtime does not support registerFileBuffer');
      }
      await db.registerFileBuffer(name, buffer);
    },
    async dropFile(name) {
      await db.dropFile?.(name);
    },
```

- [ ] **Step 5: Update the real blocking integration runtime wrapper**

In `src/duckdb/duckdb-query.integration.test.ts`, add database methods to the returned runtime:

```ts
    async registerFileBuffer(name, buffer) {
      const fileDb = db as {
        registerFileBuffer(name: string, buffer: Uint8Array): void;
      };
      fileDb.registerFileBuffer(name, buffer);
    },
    async dropFile(name) {
      const fileDb = db as { dropFile?: (name: string) => void };
      fileDb.dropFile?.(name);
    },
```

- [ ] **Step 6: Run typecheck and existing DuckDB query integration**

Run:

```bash
npm run typecheck
DUCKDB_WASM_INTEGRATION=1 npm run test:run -- src/duckdb/duckdb-query.integration.test.ts
```

Expected: both pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/duckdb/duckdb-runtime.ts src/duckdb/duckdb-query.integration.test.ts
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Expose DuckDB virtual file registration through the runtime" \
  -m "GeoParquet query execution needs DuckDB-Wasm to read registered parquet bytes. The runtime abstraction now exposes optional file registration and cleanup methods without changing existing Arrow-table query paths." \
  -m "Constraint: Existing runtimes should continue compiling without virtual file support" \
  -m "Rejected: Register files through DuckDbConnection | duckdb-wasm exposes file registration on the database runtime, not a connection" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run typecheck; DUCKDB_WASM_INTEGRATION=1 npm run test:run -- src/duckdb/duckdb-query.integration.test.ts" \
  -m "Not-tested: GeoParquet helper runtime flow"
```

## Task 3: Add GeoParquet Query Helper Unit Tests

**Files:**
- Create: `src/duckdb/duckdb-geoparquet-query-op.test.ts`

- [ ] **Step 1: Create fake runtime tests**

Create `src/duckdb/duckdb-geoparquet-query-op.test.ts`:

```ts
import { tableFromArrays, type Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { DuckDbOperationError } from './duckdb-errors';
import { queryGeoParquetWithDuckDb } from './duckdb-geoparquet-query-op';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';

class FakeConnection implements DuckDbConnection {
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly resultTable: Table,
    private readonly opts: {
      closeError?: unknown;
      createViewError?: unknown;
      dropViewError?: unknown;
      queryError?: unknown;
    } = {},
  ) {}

  async insertArrowTable(): Promise<void> {
    throw new Error('queryGeoParquetWithDuckDb should not insert Arrow tables');
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (sql.startsWith('CREATE VIEW') && this.opts.createViewError) throw this.opts.createViewError;
    if (sql.startsWith('DROP VIEW') && this.opts.dropViewError) throw this.opts.dropViewError;
    if (!sql.startsWith('CREATE VIEW') && !sql.startsWith('DROP VIEW') && this.opts.queryError) {
      throw this.opts.queryError;
    }
    if (sql.includes('LIMIT 0')) return tableFromArrays({ geometry: [] });
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.opts.closeError) throw this.opts.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;
  readonly registered: Array<{ name: string; buffer: Uint8Array }> = [];
  readonly droppedFiles: string[] = [];
  ensureSpatialCalls = 0;

  constructor(
    resultTable: Table,
    private readonly opts: {
      closeError?: unknown;
      createViewError?: unknown;
      dropFileError?: unknown;
      dropViewError?: unknown;
      queryError?: unknown;
      registerError?: unknown;
      withoutFileRegistration?: boolean;
    } = {},
  ) {
    this.connection = new FakeConnection(resultTable, opts);
    if (opts.withoutFileRegistration) {
      this.registerFileBuffer = undefined;
    }
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.ensureSpatialCalls += 1;
  }

  async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
    if (this.opts.registerError) throw this.opts.registerError;
    this.registered.push({ name, buffer });
  }

  async dropFile(name: string): Promise<void> {
    if (this.opts.dropFileError) throw this.opts.dropFileError;
    this.droppedFiles.push(name);
  }
}

async function expectDuckDbError(
  promise: Promise<unknown>,
  kind: DuckDbOperationError['kind'],
): Promise<DuckDbOperationError> {
  await expect(promise).rejects.toBeInstanceOf(DuckDbOperationError);
  try {
    await promise;
  } catch (err) {
    expect((err as DuckDbOperationError).kind).toBe(kind);
    return err as DuckDbOperationError;
  }
  throw new Error('Expected DuckDbOperationError');
}

describe('queryGeoParquetWithDuckDb', () => {
  it('registers GeoParquet bytes, queries a restricted SELECT, and cleans up', async () => {
    const runtime = new FakeRuntime(tableFromArrays({ geometry: [new Uint8Array([1])], name: ['a'] }));

    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([80, 65, 82, 49]), {
        sql: 'SELECT geometry, name FROM input LIMIT 1',
      }, runtime),
      'conversion-failed',
    );

    expect(runtime.ensureSpatialCalls).toBe(0);
    expect(runtime.registered).toHaveLength(1);
    expect(runtime.registered[0]!.name).toMatch(/^emap_duckdb_geoparquet_\d+\.parquet$/);
    expect(runtime.connection.queries[0]).toContain('CREATE VIEW');
    expect(runtime.connection.queries[0]).toContain('read_parquet');
    expect(runtime.connection.queries[1]).toContain('LIMIT 0');
    expect(runtime.connection.queries[2]).toContain('FROM "emap_duckdb_geoparquet_input_');
    expect(runtime.connection.queries.at(-1)).toMatch(/^DROP VIEW IF EXISTS "/);
    expect(runtime.connection.closed).toBe(true);
    expect(runtime.droppedFiles).toEqual([runtime.registered[0]!.name]);
  });

  it('maps a missing runtime to runtime-unavailable', async () => {
    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([1]), { sql: 'SELECT geometry FROM input' }, null),
      'runtime-unavailable',
    );
  });

  it('maps missing file registration support to runtime-unavailable', async () => {
    const runtime = new FakeRuntime(tableFromArrays({ geometry: [] }), {
      withoutFileRegistration: true,
    });

    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([1]), { sql: 'SELECT geometry FROM input' }, runtime),
      'runtime-unavailable',
    );
  });

  it('blocks direct read_parquet before executing the user query', async () => {
    const runtime = new FakeRuntime(tableFromArrays({ geometry: [] }));

    await expectDuckDbError(
      queryGeoParquetWithDuckDb(new Uint8Array([1]), {
        sql: "SELECT geometry FROM read_parquet('x.parquet')",
      }, runtime),
      'validation',
    );

    expect(runtime.connection.queries.some((sql) => sql.includes("read_parquet('x.parquet')"))).toBe(false);
  });
});
```

The fake result table intentionally uses invalid geometry bytes and expects
`conversion-failed`; the real success path is covered by the DuckDB-Wasm
integration test in Task 5.

- [ ] **Step 2: Run the new test and confirm failure**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-geoparquet-query-op.test.ts
```

Expected: FAIL because `src/duckdb/duckdb-geoparquet-query-op.ts` does not exist.

- [ ] **Step 3: Commit only the failing tests if the repository accepts red commits**

If the project policy allows red TDD commits, run:

```bash
git add src/duckdb/duckdb-geoparquet-query-op.test.ts
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Cover DuckDB GeoParquet query helper contract" \
  -m "The helper contract is locked before implementation: file registration, restricted SQL rewrite, cleanup, and error mapping." \
  -m "Constraint: This is an intentional red TDD commit if committed before implementation" \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-geoparquet-query-op.test.ts (expected fail)" \
  -m "Not-tested: Passing implementation"
```

If red commits are not allowed, leave the test staged for Task 4 and commit the helper and tests together.

## Task 4: Implement GeoParquet Query Helper

**Files:**
- Create: `src/duckdb/duckdb-geoparquet-query-op.ts`
- Modify: `src/duckdb/duckdb-geoparquet-query-op.test.ts`
- Modify: `src/duckdb/index.ts`

- [ ] **Step 1: Implement the helper**

Create `src/duckdb/duckdb-geoparquet-query-op.ts`:

```ts
import type { Table } from 'apache-arrow';
import { fromArrowTable, type FromArrowTableOptions } from '../formats/table-to-dataset';
import { detectGeometryColumn } from '../formats/geometry-column';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbRuntime } from './duckdb-runtime';
import { validateDuckDbSelectSql } from './duckdb-query-sql';

export interface DuckDbGeoParquetQueryOptions extends FromArrowTableOptions {
  sql: string;
}

let geoParquetQuerySequence = 0;

function nextGeoParquetQueryName(prefix: string): string {
  geoParquetQuerySequence += 1;
  return `${prefix}_${geoParquetQuerySequence}`;
}

function normalizeBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function tableFieldNames(table: Table): string[] {
  return table.schema.fields.map((field) => field.name);
}

export async function queryGeoParquetWithDuckDb(
  data: Uint8Array | ArrayBuffer,
  opts: DuckDbGeoParquetQueryOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<import('../types/mapshaper-types').MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  }
  if (typeof runtime.registerFileBuffer !== 'function') {
    throw new DuckDbOperationError(
      'runtime-unavailable',
      'DuckDB runtime does not support GeoParquet file registration',
    );
  }

  const fileName = `${nextGeoParquetQueryName('emap_duckdb_geoparquet')}.parquet`;
  const viewName = nextGeoParquetQueryName('emap_duckdb_geoparquet_input');
  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined;
  let primaryError: unknown;

  try {
    await runtime.registerFileBuffer(fileName, normalizeBytes(data));
    conn = await runtime.connect();
    await conn.query(
      `CREATE VIEW ${quoteIdentifier(viewName)} AS SELECT * FROM read_parquet(${quoteSqlString(fileName)})`,
    );

    const schemaTable = await conn.query(`SELECT * FROM ${quoteIdentifier(viewName)} LIMIT 0`);
    const validated = validateDuckDbSelectSql(opts.sql, {
      allowGeometryProjection: true,
      availableColumns: tableFieldNames(schemaTable),
      geometryColumn: opts.geometryColumn,
      physicalTableName: viewName,
      rowIdColumn: null,
    });
    const resultTable = await conn.query(validated.sql);

    try {
      if (!detectGeometryColumn(resultTable, opts.geometryColumn)) {
        throw new Error('DuckDB GeoParquet query result has no geometry column');
      }
      return fromArrowTable(resultTable, {
        geometryColumn: opts.geometryColumn,
        layerName: opts.layerName,
        noTopology: opts.noTopology,
      });
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        'DuckDB GeoParquet query result could not be converted to a dataset',
        { cause: err },
      );
    }
  } catch (err) {
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', 'DuckDB GeoParquet query failed', {
      cause: err,
    });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    let cleanupError: unknown;
    if (conn) {
      try {
        await conn.query(`DROP VIEW IF EXISTS ${quoteIdentifier(viewName)}`);
      } catch (err) {
        cleanupError = err;
      }
    }
    const closeError = await conn?.close?.().catch((err) => err);
    const dropFileError = await runtime.dropFile?.(fileName).catch((err) => err);
    if ((cleanupError || closeError || dropFileError) && !primaryError) {
      throw new DuckDbOperationError('query-failed', 'DuckDB GeoParquet query cleanup failed', {
        cause: cleanupError ?? closeError ?? dropFileError,
      });
    }
  }
}
```

If TypeScript rejects the inline `import('../types/mapshaper-types').MapshaperDataset` return type, add a normal type import at the top:

```ts
import type { MapshaperDataset } from '../types/mapshaper-types';
```

and return `Promise<MapshaperDataset>`.

- [ ] **Step 2: Fix unit-test geometry fixture**

If `fromArrowTable()` cannot convert the fake binary geometry bytes, keep the lifecycle test expecting `conversion-failed` and add an assertion that the query still ran and cleanup still happened. Add a separate success test later in the real DuckDB-Wasm integration test, where geometry bytes come from `exportGeoParquet()`.

- [ ] **Step 3: Export the helper**

No change is needed in `src/duckdb/index.ts` if the file is covered by `export *` only after adding this line:

```ts
export * from './duckdb-geoparquet-query-op';
```

- [ ] **Step 4: Run focused helper tests**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-sql.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/duckdb/duckdb-geoparquet-query-op.ts src/duckdb/duckdb-geoparquet-query-op.test.ts src/duckdb/index.ts
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Query registered GeoParquet bytes through DuckDB" \
  -m "The new helper registers GeoParquet bytes with DuckDB-Wasm, exposes them through a temporary read_parquet view, validates logical FROM input SQL, and converts result Arrow geometry back to a Mapshaper dataset." \
  -m "Constraint: First batch accepts bytes only and requires result geometry projection" \
  -m "Rejected: Decode GeoParquet through parquet-wasm before querying | that bypasses DuckDB parquet execution" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep direct read_parquet hidden behind helper-owned temporary views" \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-query-sql.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts; npm run typecheck" \
  -m "Not-tested: Real DuckDB-Wasm GeoParquet query"
```

## Task 5: Add Real DuckDB-Wasm GeoParquet Integration Coverage

**Files:**
- Create: `src/duckdb/duckdb-geoparquet-query.integration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the integration test**

Create `src/duckdb/duckdb-geoparquet-query.integration.test.ts`:

```ts
import { createRequire } from 'node:module';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import { exportGeoParquet } from '../formats/geoparquet-io';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import { queryGeoParquetWithDuckDb } from './duckdb-geoparquet-query-op';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

const require = createRequire(import.meta.url);
let runtime: DuckDbRuntime | undefined;

const POINT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'alpha', population: 100, active: false },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      properties: { name: 'beta', population: 200, active: true },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { name: 'gamma', population: 300, active: true },
      geometry: { type: 'Point', coordinates: [2, 2] },
    },
  ],
};

type BlockingDuckDbConnectionLike = {
  query(sql: string): import('apache-arrow').Table;
  close(): void;
};

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const duckdb = await import('@duckdb/duckdb-wasm/blocking');
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: '',
    },
    eh: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker: '',
    },
  } satisfies DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable() {
        throw new Error('GeoParquet query integration should not insert Arrow tables');
      },
      async query(sql) {
        return conn.query(sql);
      },
      async close() {
        conn.close();
      },
    };
  }

  return {
    async connect() {
      return wrapConnection();
    },
    async ensureSpatial() {
      throw new Error('GeoParquet query helper should not load the DuckDB spatial extension');
    },
    async registerFileBuffer(name, buffer) {
      const fileDb = db as { registerFileBuffer(name: string, buffer: Uint8Array): void };
      fileDb.registerFileBuffer(name, buffer);
    },
    async dropFile(name) {
      const fileDb = db as { dropFile?: (name: string) => void };
      fileDb.dropFile?.(name);
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

afterAll(async () => {
  await runtime?.close?.();
  runtime = undefined;
});

async function geoParquetBytes(): Promise<Uint8Array> {
  const dataset = await datasetFromGeoJSON(POINT_FC);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  return exportGeoParquet(dataset, { reprojectToWgs84: false });
}

describeDuckDbIntegration('DuckDB-Wasm GeoParquet query integration', () => {
  it('filters GeoParquet bytes with DuckDB read_parquet and returns a map layer', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const bytes = await geoParquetBytes();

    const result = await queryGeoParquetWithDuckDb(
      bytes,
      {
        layerName: 'active_points',
        sql: 'SELECT geometry, name, population FROM input WHERE active = true ORDER BY population DESC LIMIT 1',
      },
      duckDbRuntime,
    );

    expect(result.layers[0]?.name).toBe('active_points');
    expect(result.layers[0]?.geometry_type).toBe('point');
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([
      { name: 'gamma', population: 300 },
    ]);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  }, 60_000);

  it('fails when the projection omits geometry', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const bytes = await geoParquetBytes();

    await expect(
      queryGeoParquetWithDuckDb(bytes, { sql: 'SELECT name FROM input' }, duckDbRuntime),
    ).rejects.toMatchObject({ kind: 'conversion-failed' });
  }, 60_000);

  it('blocks direct read_parquet SQL before execution', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const bytes = await geoParquetBytes();

    await expect(
      queryGeoParquetWithDuckDb(
        bytes,
        { sql: "SELECT geometry FROM read_parquet('other.parquet')" },
        duckDbRuntime,
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
  }, 60_000);
});
```

- [ ] **Step 2: Add the test to `test:duckdb`**

In `package.json`, add the new integration file beside the existing DuckDB integration tests:

```json
"src/duckdb/duckdb-geoparquet-query.integration.test.ts"
```

- [ ] **Step 3: Run the integration test**

Run:

```bash
DUCKDB_WASM_INTEGRATION=1 npm run test:run -- src/duckdb/duckdb-geoparquet-query.integration.test.ts
npm run test:duckdb
```

Expected: both pass.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add src/duckdb/duckdb-geoparquet-query.integration.test.ts package.json
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Cover GeoParquet byte queries with DuckDB-Wasm" \
  -m "The integration test verifies the helper uses DuckDB's parquet reader against registered bytes and converts geometry-bearing Arrow results into map layers." \
  -m "Constraint: Integration coverage is gated by DUCKDB_WASM_INTEGRATION=1" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: DUCKDB_WASM_INTEGRATION=1 npm run test:run -- src/duckdb/duckdb-geoparquet-query.integration.test.ts; npm run test:duckdb" \
  -m "Not-tested: Browser worker runtime with uploaded files"
```

## Task 6: Add GeoParquet Query Map Operation

**Files:**
- Modify: `src/duckdb/map-op.ts`
- Modify: `src/duckdb/map-op.test.ts`

- [ ] **Step 1: Run impact before editing map-op source contracts**

Run:

```bash
node .gitnexus/run.cjs impact --repo emap DuckDbMapOpSource
node .gitnexus/run.cjs impact --repo emap duckDbQueryLayer
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before editing.

- [ ] **Step 2: Add failing map-op tests**

In `src/duckdb/map-op.test.ts`, update `FakeSource`:

```ts
class FakeSource implements DuckDbMapOpSource {
  constructor(
    private readonly dataset: MapshaperDataset | null | undefined,
    private readonly bytes?: Uint8Array | ArrayBuffer | null,
  ) {}

  getDataset(): MapshaperDataset | null | undefined {
    return this.dataset;
  }

  getBytes(): Uint8Array | ArrayBuffer | null | undefined {
    return this.bytes;
  }
}
```

Add this helper:

```ts
function makeByteContext(sourceId: string, bytes: Uint8Array | ArrayBuffer | null | undefined): FakeContext {
  const ctx = new FakeContext();
  ctx.sources.set(sourceId, new FakeSource(undefined, bytes));
  return ctx;
}
```

Import `duckDbGeoParquetQueryLayer` from `./map-op`, then add:

```ts
describe('duckDbGeoParquetQueryLayer', () => {
  it('writes an output source dataset after a successful GeoParquet query', async () => {
    const dataset = await polygonDataset();
    const ctx = makeByteContext('src', new Uint8Array([80, 65, 82, 49]));
    const runtime = new FakeRuntime(toArrowTable(dataset, { encoding: 'wkb' }));

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry, name FROM input',
      output: { sourceId: 'query' },
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(ctx.outputDatasets.has('query')).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('query');
      expect(result.value.dataset).toBe(ctx.outputDatasets.get('query'));
    }
  });

  it('returns not-found when the byte source is missing', async () => {
    const result = await duckDbGeoParquetQueryLayer(new FakeContext(), {
      src: 'missing',
      sql: 'SELECT geometry FROM input',
      output: { sourceId: 'query' },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not-found', what: 'source', id: 'missing' },
    });
  });

  it('returns validation when the source does not expose bytes', async () => {
    const ctx = makeContext('src', await polygonDataset());

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry FROM input',
      output: { sourceId: 'query' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'src',
        reason: "Source 'src' does not expose GeoParquet bytes",
      },
    });
  });

  it('returns validation when output source id is missing', async () => {
    const ctx = makeByteContext('src', new Uint8Array([1]));

    const result = await duckDbGeoParquetQueryLayer(ctx, {
      src: 'src',
      sql: 'SELECT geometry FROM input',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        field: 'output.sourceId',
        reason: 'DuckDB operation requires output.sourceId',
      },
    });
  });
});
```

If the fake runtime cannot satisfy the helper because it does not implement `registerFileBuffer`, replace the success test runtime with a minimal fake that exercises `duckDbGeoParquetQueryLayer()` through a mocked helper only if the project already uses Vitest module mocks. Otherwise keep success covered by integration tests and assert validation/error mapping here.

- [ ] **Step 3: Run map-op test and confirm failure**

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: FAIL because `duckDbGeoParquetQueryLayer` and `getBytes()` support do not exist.

- [ ] **Step 4: Implement source byte support and map operation**

In `src/duckdb/map-op.ts`, add the helper import:

```ts
import {
  queryGeoParquetWithDuckDb,
  type DuckDbGeoParquetQueryOptions,
} from './duckdb-geoparquet-query-op';
```

Change `DuckDbMapOpSource`:

```ts
export interface DuckDbMapOpSource {
  getBytes?(): Uint8Array | ArrayBuffer | null | undefined;
  getDataset(): MapshaperDataset | null | undefined;
}
```

Add options/result types:

```ts
export interface DuckDbGeoParquetQueryLayerOptions extends DuckDbGeoParquetQueryOptions {
  src: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export type DuckDbGeoParquetQueryLayerResult = OpResult<DuckDbLayerSuccess>;
```

Add byte reading:

```ts
function readInputBytes(
  ctx: DuckDbMapOpContext,
  src: string,
  field = 'src',
): { ok: true; bytes: Uint8Array | ArrayBuffer } | { ok: false; result: OpResult<never> } {
  const source = ctx.getSource(src);
  if (!source) return { ok: false, result: Err.notFound('source', src) };

  const bytes = source.getBytes?.();
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    return {
      ok: false,
      result: Err.validation(field, `Source '${src}' does not expose GeoParquet bytes`),
    };
  }

  return { ok: true, bytes };
}
```

Add the map operation:

```ts
export async function duckDbGeoParquetQueryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbGeoParquetQueryLayerOptions,
): Promise<DuckDbGeoParquetQueryLayerResult> {
  const input = readInputBytes(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await queryGeoParquetWithDuckDb(input.bytes, opts, opts.runtime);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, 'duckdb-geoparquet-query');
  }
}
```

- [ ] **Step 5: Run focused map-op tests**

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/duckdb/map-op.ts src/duckdb/map-op.test.ts
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Expose GeoParquet byte queries as a DuckDB map operation" \
  -m "Hosts can now route in-memory GeoParquet bytes through the DuckDB query helper and write the resulting dataset into the existing source graph." \
  -m "Constraint: Byte sources are separate from existing dataset-backed DuckDB operations" \
  -m "Rejected: Overload getDataset for GeoParquet files | it would hide source type errors until conversion time" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep duckDbGeoParquetQueryLayer requiring getBytes until URL/file-handle sources are designed" \
  -m "Tested: npm run test:run -- src/duckdb/map-op.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts; npm run typecheck" \
  -m "Not-tested: Browser UI source wiring"
```

## Task 7: Document And Verify The GeoParquet Query Integration

**Files:**
- Modify: `README.md`
- Modify: `package.json` if Task 5 did not already update `test:duckdb`

- [ ] **Step 1: Update README DuckDB section**

Add a short subsection near the existing restricted DuckDB SELECT documentation:

````md
### Query GeoParquet bytes with DuckDB

`@zwishing/emap/duckdb` can run the same restricted `SELECT ... FROM input ...`
contract against GeoParquet bytes. The helper registers the bytes with
DuckDB-Wasm, exposes them as the logical `input` table, and converts the
geometry-bearing Arrow result to a `MapshaperDataset`.

```ts
import { queryGeoParquetWithDuckDb } from '@zwishing/emap/duckdb';

const result = await queryGeoParquetWithDuckDb(bytes, {
  layerName: 'active_points',
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

The first batch requires the projection to include a detectable geometry column,
for example `SELECT geometry, name FROM input`. Direct `read_parquet(...)` calls,
joins, mutations, and multiple statements are rejected by the validator.
````

If the README already has a DuckDB query subsection, merge this under that heading instead of duplicating the broader explanation.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-sql.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts src/duckdb/map-op.test.ts
npm run test:duckdb
npm run typecheck
npm run build
npm run format:check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Commit documentation and any package script update**

Run:

```bash
git add README.md package.json
node .gitnexus/run.cjs detect_changes --repo emap --scope staged
git commit -m "Document DuckDB GeoParquet byte queries" \
  -m "The public README now records the bytes-based GeoParquet query helper, its restricted SQL contract, and the geometry projection requirement." \
  -m "Constraint: Documentation must match the first-batch bytes-only scope" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-query-sql.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts src/duckdb/map-op.test.ts; npm run test:duckdb; npm run typecheck; npm run build; npm run format:check; git diff --check" \
  -m "Not-tested: Browser UI workflow"
```

## Final Verification Checklist

- [ ] `npm run test:run -- src/duckdb/duckdb-query-sql.test.ts src/duckdb/duckdb-geoparquet-query-op.test.ts src/duckdb/map-op.test.ts`
- [ ] `npm run test:duckdb`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run format:check`
- [ ] `git diff --check`
- [ ] `node .gitnexus/run.cjs detect_changes --repo emap --scope staged` before the final commit
- [ ] Confirm no unrelated files are staged, especially `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.codegraph/`, `.gstack/`, `.serena/`, and `.superpowers/`

## Plan Self-Review

- Spec coverage: the plan covers GeoParquet bytes input, helper API, map-op API, logical `FROM input`, result geometry requirement, runtime file registration, cleanup behavior, unit tests, integration tests, README documentation, and verification commands.
- Placeholder scan: no unfinished marker text or empty implementation steps are intentionally present.
- Type consistency: `allowGeometryProjection`, `rowIdColumn: null`, `registerFileBuffer`, `dropFile`, `queryGeoParquetWithDuckDb`, `DuckDbGeoParquetQueryOptions`, and `duckDbGeoParquetQueryLayer` are introduced before later tasks consume them.
