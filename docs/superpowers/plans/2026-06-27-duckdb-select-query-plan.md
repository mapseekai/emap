# DuckDB Restricted SELECT Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conservative DuckDB-Wasm read-only SELECT query helper over existing map layers that preserves original geometry by internal row id.

**Architecture:** The query feature is split into three focused units: SQL contract checking and rewriting, dataset-to-DuckDB query execution, and map-op integration. Query execution registers one generated DuckDB table for the requested input layer, runs a rewritten single-table SELECT, converts scalar result columns to records, and reconstructs geometry from the original input layer using an internal row id column. The first batch does not call `runtime.ensureSpatial()` because result geometry is copied from the source dataset, not computed by DuckDB spatial functions.

**Tech Stack:** TypeScript, DuckDB-Wasm runtime abstraction, Apache Arrow, Mapshaper datasets, Vitest, GitNexus, CodeGraph.

---

## File Structure

- Create: `src/duckdb/duckdb-query-sql.ts`
  - Owns the restricted SELECT contract, identifier quoting, projection expansion, and SQL rewrite from logical table `input` to a generated physical temp table.
- Create: `src/duckdb/duckdb-query-sql.test.ts`
  - Unit tests for accepted and rejected SQL shapes.
- Create: `src/duckdb/duckdb-query-op.ts`
  - Owns runtime lookup, one-layer Arrow conversion with row ids, DuckDB lifecycle, result record conversion, geometry reconstruction, cleanup, and `DuckDbOperationError` mapping.
- Create: `src/duckdb/duckdb-query-op.test.ts`
  - Fake-runtime tests for lifecycle order, row-id projection, geometry reconstruction, metadata preservation, and failure mapping.
- Create: `src/duckdb/duckdb-query.integration.test.ts`
  - Real DuckDB-Wasm tests for WHERE, projection, ORDER BY, LIMIT, scalar roundtrips, and blocked unsafe SQL.
- Modify: `src/formats/table-to-dataset.ts`
  - Export a scalar Arrow result helper so query results can become records without requiring a geometry column.
- Modify: `src/formats/table-to-dataset.test.ts`
  - Lock scalar Arrow-to-record behavior before refactoring the existing private record builder.
- Modify: `src/duckdb/map-op.ts`
  - Add `DuckDbQueryLayerOptions`, `DuckDbQueryLayerResult`, and `duckDbQueryLayer()`.
- Modify: `src/duckdb/map-op.test.ts`
  - Cover map-op success, missing source, missing output id, SQL rejection, and query failure.
- Modify: `src/duckdb/index.ts`
  - Export the new query helper and SQL helper.
- Modify: `package.json`
  - Add `src/duckdb/duckdb-query.integration.test.ts` to `test:duckdb`.
- Modify: `README.md`
  - Document the restricted SELECT helper and map-op entry point.

## Pre-Implementation Rules

- Before modifying any existing function, class, or method, run GitNexus impact for that exact symbol and note the risk in the task log. Required symbols include `toArrowTable`, `duckDbRelationLayer` or nearby `map-op.ts` helpers if edited, and any exported helper touched during implementation.
- If GitNexus reports HIGH or CRITICAL risk for an edit, stop the implementation task and surface the risk before writing code.
- Before each commit, run `mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })` and confirm only expected symbols or documentation changed.
- Use `git add -f docs/superpowers/...` only for ignored plan/spec docs. Do not add `.codegraph/`, `.gstack/`, `.serena/`, or `.superpowers/`.

## Task 1: Export Scalar Arrow Records

**Files:**
- Modify: `src/formats/table-to-dataset.ts`
- Modify: `src/formats/table-to-dataset.test.ts`

- [ ] **Step 1: Run impact before editing**

Run:

```ts
mcp__gitnexus.impact({
  repo: "emap",
  target: "fromArrowTable",
  file_path: "src/formats/table-to-dataset.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before editing.

- [ ] **Step 2: Write failing scalar-record tests**

Append these tests to `src/formats/table-to-dataset.test.ts`. Extend the existing `apache-arrow` import with `Bool`, `Int32`, `Utf8` if those names are not already imported, and merge `recordsFromArrowTable` into the existing `./table-to-dataset` import:

```ts
import { Bool, Int32, Utf8 } from 'apache-arrow';
import { fromArrowTable, recordsFromArrowTable, resetTableImportWarnings } from './table-to-dataset';

it('converts scalar Arrow columns to records without geometry metadata', () => {
  const rowIds = vectorFromArray([1, 0], new Int32());
  const names = vectorFromArray(['beta', 'alpha'], new Utf8());
  const population = vectorFromArray([200, 100], new Int32());
  const active = vectorFromArray([true, false], new Bool());
  const table = tableFromColumns([
    { field: new Field('__emap_rowid', new Int32(), false), data: rowIds.data[0] },
    { field: new Field('name', new Utf8(), true), data: names.data[0] },
    { field: new Field('population', new Int32(), true), data: population.data[0] },
    { field: new Field('active', new Bool(), true), data: active.data[0] },
  ]);

  expect(recordsFromArrowTable(table, { skipColumns: ['__emap_rowid'] })).toEqual([
    { name: 'beta', population: 200, active: true },
    { name: 'alpha', population: 100, active: false },
  ]);
});

it('returns an empty record array for empty scalar results', () => {
  const names = vectorFromArray([], new Utf8());
  const table = tableFromColumns([
    { field: new Field('name', new Utf8(), true), data: names.data[0] },
  ]);

  expect(recordsFromArrowTable(table)).toEqual([]);
});
```

If the existing test file already has overlapping Arrow imports, merge the imports instead of duplicating them.

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```bash
npm run test:run -- src/formats/table-to-dataset.test.ts
```

Expected: FAIL with an error that `recordsFromArrowTable` is not exported or not defined.

- [ ] **Step 4: Export `recordsFromArrowTable`**

In `src/formats/table-to-dataset.ts`, add this exported helper and route the existing private record builder through it. Keep the existing `fromArrowTable()` behavior unchanged.

```ts
export interface RecordsFromArrowTableOptions {
  skipColumns?: readonly string[];
}

export function recordsFromArrowTable(
  table: Table,
  opts: RecordsFromArrowTableOptions = {},
): Array<Record<string, unknown>> {
  const skipColumns = new Set(opts.skipColumns ?? []);
  const records: Array<Record<string, unknown>> = [];
  for (let row = 0; row < table.numRows; row += 1) {
    const record: Record<string, unknown> = {};
    for (const field of table.schema.fields) {
      if (skipColumns.has(field.name)) continue;
      const vector = table.getChild(field.name);
      record[field.name] = toRecordValue(vector?.get(row));
    }
    records.push(record);
  }
  return records;
}

function buildRecords(
  table: Table,
  geometryIndex: number,
  skipIndexes: Set<number>,
): Array<Record<string, unknown>> {
  const skipColumns = table.schema.fields
    .filter((_, idx) => idx === geometryIndex || skipIndexes.has(idx))
    .map((field) => field.name);
  return recordsFromArrowTable(table, { skipColumns });
}
```

If the existing `buildRecords()` uses the same loop, replace it with the wrapper above and leave `toRecordValue()` private.

- [ ] **Step 5: Run the focused test and confirm it passes**

Run:

```bash
npm run test:run -- src/formats/table-to-dataset.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run staged detect before committing:

```ts
mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })
```

Then commit:

```bash
git add src/formats/table-to-dataset.ts src/formats/table-to-dataset.test.ts
git commit -m "Expose Arrow scalar record conversion for DuckDB queries" \
  -m "DuckDB SELECT query results do not carry output geometry, so they need the existing Arrow scalar conversion path without forcing GeoArrow metadata." \
  -m "Constraint: Output geometry is reconstructed from source row ids, not from DuckDB result geometry." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run test:run -- src/formats/table-to-dataset.test.ts"
```

## Task 2: Create Restricted SELECT SQL Helper

**Files:**
- Create: `src/duckdb/duckdb-query-sql.ts`
- Create: `src/duckdb/duckdb-query-sql.test.ts`

- [ ] **Step 1: Write failing accepted-query tests**

Create `src/duckdb/duckdb-query-sql.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DuckDbOperationError } from './duckdb-errors';
import { validateDuckDbSelectSql } from './duckdb-query-sql';

const columns = ['name', 'population', 'active', 'geometry', '__emap_rowid'];

function validate(sql: string) {
  return validateDuckDbSelectSql(sql, {
    availableColumns: columns,
    geometryColumn: 'geometry',
    inputTableName: 'input',
    physicalTableName: 'emap_duckdb_query_input_1',
    rowIdColumn: '__emap_rowid',
  });
}

describe('validateDuckDbSelectSql', () => {
  it('rewrites SELECT star to safe scalar columns plus row id', () => {
    const result = validate('SELECT * FROM input');

    expect(result.outputColumns).toEqual(['name', 'population', 'active']);
    expect(result.sql).toBe(
      'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name", "input"."population" AS "population", "input"."active" AS "active" FROM "emap_duckdb_query_input_1" AS "input"',
    );
  });

  it('rewrites selected attributes while preserving WHERE, ORDER BY, and LIMIT', () => {
    const result = validate(
      'select name, population from input where population > 100 order by population desc limit 2',
    );

    expect(result.outputColumns).toEqual(['name', 'population']);
    expect(result.sql).toBe(
      'SELECT "input"."__emap_rowid" AS "__emap_rowid", "input"."name" AS "name", "input"."population" AS "population" FROM "emap_duckdb_query_input_1" AS "input" where population > 100 order by population desc limit 2',
    );
  });

  it('accepts quoted identifiers and multiline formatting', () => {
    const result = validate('SELECT\\n  "name",\\n  "active"\\nFROM input\\nWHERE active = true');

    expect(result.outputColumns).toEqual(['name', 'active']);
    expect(result.sql).toContain('"input"."name" AS "name"');
    expect(result.sql).toContain('WHERE active = true');
  });
});
```

- [ ] **Step 2: Write failing rejected-query tests**

Append these tests inside the same `describe` block:

```ts
it.each([
  ['multiple statements', 'SELECT name FROM input; SELECT population FROM input'],
  ['join', 'SELECT input.name FROM input JOIN other ON input.id = other.id'],
  ['non-input table', 'SELECT name FROM parcels'],
  ['cte', 'WITH x AS (SELECT name FROM input) SELECT name FROM x'],
  ['subquery', 'SELECT name FROM input WHERE id IN (SELECT id FROM other)'],
  ['insert', 'INSERT INTO input VALUES (1)'],
  ['copy', 'COPY input TO \\'out.parquet\\''],
  ['attach', "ATTACH 'db.duckdb' AS other"],
  ['install', 'INSTALL spatial'],
  ['load', 'LOAD spatial'],
  ['pragma', 'PRAGMA version'],
  ['missing from input', 'SELECT name'],
  ['geometry projection', 'SELECT geometry FROM input'],
  ['unknown projection', 'SELECT missing_field FROM input'],
  ['alias projection', 'SELECT name AS label FROM input'],
  ['table alias', 'SELECT name FROM input AS i'],
])('rejects %s', (_, sql) => {
  expect(() => validate(sql)).toThrow(DuckDbOperationError);
  expect(() => validate(sql)).toThrow(/DuckDB query/i);
});
```

- [ ] **Step 3: Run the SQL test and confirm it fails**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-sql.test.ts
```

Expected: FAIL with module resolution error for `./duckdb-query-sql`.

- [ ] **Step 4: Implement `duckdb-query-sql.ts`**

Create `src/duckdb/duckdb-query-sql.ts` with these exported types and helper names:

```ts
import { DuckDbOperationError } from './duckdb-errors';

export interface ValidateDuckDbSelectSqlOptions {
  availableColumns: readonly string[];
  geometryColumn?: string;
  inputTableName?: string;
  physicalTableName: string;
  rowIdColumn?: string;
}

export interface ValidatedDuckDbSelectSql {
  outputColumns: string[];
  rowIdColumn: string;
  sql: string;
}

const DEFAULT_INPUT_TABLE = 'input';
const DEFAULT_ROW_ID_COLUMN = '__emap_rowid';
const FORBIDDEN_KEYWORDS = [
  'alter',
  'attach',
  'copy',
  'create',
  'delete',
  'detach',
  'drop',
  'insert',
  'install',
  'join',
  'load',
  'pragma',
  'replace',
  'set',
  'update',
  'with',
] as const;
```

Use these exact behaviors:

```ts
export function validateDuckDbSelectSql(
  sql: string,
  opts: ValidateDuckDbSelectSqlOptions,
): ValidatedDuckDbSelectSql {
  const inputTableName = opts.inputTableName ?? DEFAULT_INPUT_TABLE;
  const rowIdColumn = opts.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN;
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const trimmed = sql.trim();

  if (trimmed.length === 0) throw validationError('DuckDB query SQL is empty');
  if (trimmed.includes(';')) throw validationError('DuckDB query must be a single SELECT statement');
  if (trimmed.includes('--') || trimmed.includes('/*') || trimmed.includes('*/')) {
    throw validationError('DuckDB query comments are not supported');
  }

  const lowered = maskQuotedSql(trimmed).toLowerCase();
  if (!lowered.startsWith('select ')) throw validationError('DuckDB query must start with SELECT');
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (containsKeyword(lowered, keyword)) {
      throw validationError(`DuckDB query keyword '${keyword.toUpperCase()}' is not allowed`);
    }
  }
  if (countKeyword(lowered, 'select') !== 1) {
    throw validationError('DuckDB query must contain exactly one SELECT');
  }

  const fromMatch = findFromInput(lowered, inputTableName);
  if (!fromMatch) throw validationError(`DuckDB query must read from ${inputTableName}`);

  const projectionText = trimmed.slice('select'.length, fromMatch.fromStart).trim();
  const tail = trimmed.slice(fromMatch.inputEnd);
  assertAllowedTail(tail);
  const outputColumns = expandProjection(projectionText, opts.availableColumns, {
    geometryColumn,
    rowIdColumn,
  });

  if (referencesIdentifier(lowered, geometryColumn)) {
    throw validationError(`DuckDB query cannot reference geometry column '${geometryColumn}'`);
  }

  const projectionSql = [rowIdColumn, ...outputColumns]
    .map((column) => `${quoteIdentifier(inputTableName)}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`)
    .join(', ');
  const rewritten = `SELECT ${projectionSql} FROM ${quoteIdentifier(opts.physicalTableName)} AS ${quoteIdentifier(inputTableName)}${tail}`;
  return { outputColumns, rowIdColumn, sql: rewritten };
}
```

Add private helpers in the same file:

```ts
function validationError(message: string): DuckDbOperationError {
  return new DuckDbOperationError('validation', message, { field: 'sql' });
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function containsKeyword(sql: string, keyword: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])${keyword}([^a-z0-9_]|$)`, 'i').test(sql);
}

function countKeyword(sql: string, keyword: string): number {
  return [...sql.matchAll(new RegExp(`(^|[^a-z0-9_])${keyword}([^a-z0-9_]|$)`, 'gi'))].length;
}

function maskQuotedSql(sql: string): string {
  return sql.replace(/'([^']|'')*'/g, "''").replace(/"([^"]|"")*"/g, '""');
}

function referencesIdentifier(sql: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
  return new RegExp(`(^|[^a-z0-9_"])${escaped}([^a-z0-9_"]|$)`, 'i').test(sql);
}

function assertAllowedTail(tail: string): void {
  const trimmed = tail.trimStart().toLowerCase();
  if (
    trimmed.length > 0 &&
    !trimmed.startsWith('where ') &&
    !trimmed.startsWith('order by ') &&
    !trimmed.startsWith('limit ')
  ) {
    throw validationError('DuckDB query table aliases are not supported');
  }
}

function findFromInput(
  loweredSql: string,
  inputTableName: string,
): { fromStart: number; inputEnd: number } | null {
  const pattern = new RegExp(`\\bfrom\\s+${inputTableName}\\b`, 'i');
  const match = pattern.exec(loweredSql);
  if (!match) return null;
  return { fromStart: match.index, inputEnd: match.index + match[0].length };
}

function expandProjection(
  projectionText: string,
  availableColumns: readonly string[],
  opts: { geometryColumn: string; rowIdColumn: string },
): string[] {
  const allowed = new Set(availableColumns.filter((c) => c !== opts.geometryColumn && c !== opts.rowIdColumn));
  if (projectionText === '*') return [...allowed];
  const parts = projectionText.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw validationError('DuckDB query SELECT list is empty');
  return parts.map((part) => {
    const column = normalizeProjectedIdentifier(part);
    if (column === opts.geometryColumn || column === opts.rowIdColumn) {
      throw validationError(`DuckDB query cannot project internal or geometry column '${column}'`);
    }
    if (!allowed.has(column)) throw validationError(`DuckDB query references unknown column '${column}'`);
    return column;
  });
}

function normalizeProjectedIdentifier(value: string): string {
  const unquoted = /^"([^"]+)"$/.exec(value);
  if (unquoted) return unquoted[1].replace(/""/g, '"');
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value;
  throw validationError(`DuckDB query projection '${value}' is not supported`);
}
```

If a test shows this helper incorrectly rejects a required accepted shape from the design, adjust the smallest helper needed and add a test for that shape.

- [ ] **Step 5: Run SQL tests and confirm they pass**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-sql.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run staged detect before committing:

```ts
mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })
```

Then commit:

```bash
git add src/duckdb/duckdb-query-sql.ts src/duckdb/duckdb-query-sql.test.ts
git commit -m "Constrain DuckDB SELECT query SQL" \
  -m "The query layer accepts a single logical input table, so the SQL helper rewrites a narrow projection into a generated physical table and rejects unsafe statement shapes before runtime execution." \
  -m "Constraint: First batch preserves geometry by row id and does not execute arbitrary DuckDB SQL." \
  -m "Rejected: Raw SQL passthrough | would expose table names, mutating statements, and geometry output ambiguity." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-query-sql.test.ts"
```

## Task 3: Query Core With Fake Runtime

**Files:**
- Create: `src/duckdb/duckdb-query-op.ts`
- Create: `src/duckdb/duckdb-query-op.test.ts`

- [ ] **Step 1: Run impact before editing shared conversion imports**

Run:

```ts
mcp__gitnexus.impact({
  repo: "emap",
  target: "toArrowTable",
  file_path: "src/formats/dataset-to-table.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before importing or changing call behavior.

- [ ] **Step 2: Write failing fake-runtime tests**

Create `src/duckdb/duckdb-query-op.test.ts`:

```ts
import { tableFromArrays, type Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import { queryDatasetWithDuckDb } from './duckdb-query-op';

const POINTS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'alpha', population: 100, active: false }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', properties: { name: 'beta', population: 200, active: true }, geometry: { type: 'Point', coordinates: [1, 1] } },
    { type: 'Feature', properties: { name: 'gamma', population: 300, active: true }, geometry: { type: 'Point', coordinates: [2, 2] } },
  ],
};

class FakeConnection implements DuckDbConnection {
  readonly inserted: Array<{ table: Table; opts: { name: string } }> = [];
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly resultTable: Table,
    private readonly queryError?: unknown,
    private readonly closeError?: unknown,
  ) {}

  async insertArrowTable(table: Table, opts: { name: string }): Promise<void> {
    this.inserted.push({ table, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (this.queryError) throw this.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.closeError) throw this.closeError;
  }
}

class FakeRuntime implements DuckDbRuntime {
  readonly connection: FakeConnection;
  ensureSpatialCalls = 0;

  constructor(resultTable: Table, queryError?: unknown, closeError?: unknown) {
    this.connection = new FakeConnection(resultTable, queryError, closeError);
  }

  async connect(): Promise<DuckDbConnection> {
    return this.connection;
  }

  async ensureSpatial(): Promise<void> {
    this.ensureSpatialCalls += 1;
  }
}

async function pointsDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POINTS);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  return dataset;
}

describe('queryDatasetWithDuckDb', () => {
  it('queries selected attributes and rebuilds shapes by returned row id order', async () => {
    const dataset = await pointsDataset();
    const runtime = new FakeRuntime(
      tableFromArrays({
        __emap_rowid: [2, 0],
        name: ['gamma', 'alpha'],
      }),
    );

    const result = await queryDatasetWithDuckDb(
      dataset,
      { sql: 'SELECT name FROM input ORDER BY population DESC LIMIT 2', outputLayer: 'filtered' },
      runtime,
    );

    expect(runtime.ensureSpatialCalls).toBe(0);
    expect(runtime.connection.inserted).toHaveLength(1);
    expect(runtime.connection.queries[0]).toContain('FROM "emap_duckdb_query_input_');
    expect(runtime.connection.queries[0]).toContain('"input"."__emap_rowid" AS "__emap_rowid"');
    expect(runtime.connection.queries[1]).toMatch(/^DROP TABLE IF EXISTS "emap_duckdb_query_input_\\d+"$/);
    expect(runtime.connection.closed).toBe(true);
    expect(result.layers[0]?.name).toBe('filtered');
    expect(result.layers[0]?.data?.getRecords?.()).toEqual([{ name: 'gamma' }, { name: 'alpha' }]);
    expect(result.layers[0]?.shapes).toEqual([dataset.layers[0].shapes?.[2], dataset.layers[0].shapes?.[0]]);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  });

  it('maps missing runtime to runtime-unavailable', async () => {
    await expect(queryDatasetWithDuckDb(await pointsDataset(), { sql: 'SELECT name FROM input' }, null)).rejects.toMatchObject({
      kind: 'runtime-unavailable',
    });
  });

  it('maps rejected SQL to validation', async () => {
    const runtime = new FakeRuntime(tableFromArrays({ __emap_rowid: [], name: [] }));

    await expect(
      queryDatasetWithDuckDb(await pointsDataset(), { sql: 'DROP TABLE input' }, runtime),
    ).rejects.toMatchObject({ kind: 'validation', field: 'sql' });
    expect(runtime.connection.queries).toHaveLength(0);
  });

  it('maps DuckDB query failures to query-failed and still closes', async () => {
    const runtime = new FakeRuntime(tableFromArrays({ __emap_rowid: [], name: [] }), new Error('boom'));

    await expect(
      queryDatasetWithDuckDb(await pointsDataset(), { sql: 'SELECT name FROM input' }, runtime),
    ).rejects.toMatchObject({ kind: 'query-failed' });
    expect(runtime.connection.closed).toBe(true);
  });

  it('keeps the primary error when cleanup fails', async () => {
    const runtime = new FakeRuntime(
      tableFromArrays({ __emap_rowid: [], name: [] }),
      new Error('query boom'),
      new Error('close boom'),
    );

    await expect(
      queryDatasetWithDuckDb(await pointsDataset(), { sql: 'SELECT name FROM input' }, runtime),
    ).rejects.toMatchObject({ kind: 'query-failed' });
  });

  it('maps invalid row ids to conversion-failed', async () => {
    const runtime = new FakeRuntime(tableFromArrays({ __emap_rowid: [99], name: ['bad'] }));

    await expect(
      queryDatasetWithDuckDb(await pointsDataset(), { sql: 'SELECT name FROM input' }, runtime),
    ).rejects.toMatchObject({ kind: 'conversion-failed' });
  });
});
```

- [ ] **Step 3: Run the fake-runtime query test and confirm it fails**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-op.test.ts
```

Expected: FAIL with module resolution error for `./duckdb-query-op`.

- [ ] **Step 4: Implement `duckdb-query-op.ts` public API**

Create `src/duckdb/duckdb-query-op.ts` with these imports and exports:

```ts
import type { Table } from 'apache-arrow';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { toArrowTable } from '../formats/dataset-to-table';
import { recordsFromArrowTable } from '../formats/table-to-dataset';
import type { FeatureShape, MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import { DuckDbOperationError } from './duckdb-errors';
import { getDuckDbRuntime, type DuckDbConnection, type DuckDbRuntime } from './duckdb-runtime';
import { validateDuckDbSelectSql } from './duckdb-query-sql';

export interface DuckDbQueryOptions {
  geometryColumn?: string;
  inputLayer?: string | number;
  outputLayer?: string;
  rowIdColumn?: string;
  sql: string;
}

const DEFAULT_GEOMETRY_COLUMN = 'geometry';
const DEFAULT_ROW_ID_COLUMN = '__emap_rowid';
let queryCounter = 0;

export async function queryDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbQueryOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (!runtime) {
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not configured');
  }

  const input = prepareQueryInput(dataset, opts);
  const tableName = `emap_duckdb_query_input_${++queryCounter}`;
  let conn: DuckDbConnection | null = null;
  let primaryError: unknown;

  try {
    const arrow = buildQueryArrowTable(input.dataset, opts.geometryColumn ?? DEFAULT_GEOMETRY_COLUMN);
    const validated = validateDuckDbSelectSql(opts.sql, {
      availableColumns: arrow.schema.fields.map((field) => field.name),
      geometryColumn: opts.geometryColumn ?? DEFAULT_GEOMETRY_COLUMN,
      physicalTableName: tableName,
      rowIdColumn: input.rowIdColumn,
    });

    conn = await runtime.connect();
    await conn.insertArrowTable(arrow, { name: tableName });
    const result = await conn.query(validated.sql);
    return buildQueryResult(dataset, input.layer, result, {
      outputLayer: opts.outputLayer,
      rowIdColumn: input.rowIdColumn,
    });
  } catch (err) {
    primaryError = err;
    throw mapQueryError(err);
  } finally {
    await cleanupQueryConnection(conn, tableName, primaryError);
  }
}
```

- [ ] **Step 5: Implement input preparation and result reconstruction**

Add these private helpers in `src/duckdb/duckdb-query-op.ts`:

```ts
function buildQueryArrowTable(dataset: MapshaperDataset, geometryColumn: string): Table {
  try {
    return toArrowTable(dataset, {
      encoding: 'wkb',
      geometryColumn,
      layer: 0,
    });
  } catch (err) {
    throw new DuckDbOperationError('conversion-failed', 'DuckDB query failed to convert input layer to Arrow', {
      cause: err,
    });
  }
}

function prepareQueryInput(
  dataset: MapshaperDataset,
  opts: DuckDbQueryOptions,
): { dataset: MapshaperDataset; layer: MapshaperLayer; rowIdColumn: string } {
  const layer = resolveQueryLayer(dataset, opts.inputLayer);
  const shapes = layer.shapes ?? [];
  const records = layer.data?.getRecords?.() ?? [];
  const rowIdColumn = uniqueRowIdColumn(records, opts.rowIdColumn ?? DEFAULT_ROW_ID_COLUMN);
  const adapter = getDefaultMapshaperAdapter();
  const queryRecords = shapes.map((_, index) => ({ ...(records[index] ?? {}), [rowIdColumn]: index }));
  return {
    dataset: {
      arcs: dataset.arcs,
      info: dataset.info ? { ...dataset.info } : undefined,
      layers: [
        {
          ...layer,
          data: adapter.createDataTable(queryRecords),
          shapes,
        },
      ],
    },
    layer,
    rowIdColumn,
  };
}

function resolveQueryLayer(dataset: MapshaperDataset, selector?: string | number): MapshaperLayer {
  const layers = dataset.layers ?? [];
  if (layers.length === 0) {
    throw new DuckDbOperationError('validation', 'DuckDB query requires a dataset layer', { field: 'inputLayer' });
  }
  if (typeof selector === 'number') {
    const layer = layers[selector];
    if (!layer) {
      throw new DuckDbOperationError('validation', `DuckDB query layer index ${selector} is out of range`, {
        field: 'inputLayer',
      });
    }
    return layer;
  }
  if (typeof selector === 'string') {
    const layer = layers.find((candidate) => candidate.name === selector || candidate.id === selector);
    if (!layer) {
      throw new DuckDbOperationError('validation', `DuckDB query layer '${selector}' was not found`, {
        field: 'inputLayer',
      });
    }
    return layer;
  }
  return layers[0];
}

function uniqueRowIdColumn(records: Array<Record<string, unknown>>, preferred: string): string {
  const names = new Set<string>();
  for (const record of records) {
    for (const name of Object.keys(record)) names.add(name);
  }
  if (!names.has(preferred)) return preferred;
  let suffix = 1;
  while (names.has(`${preferred}_${suffix}`)) suffix += 1;
  return `${preferred}_${suffix}`;
}

function buildQueryResult(
  sourceDataset: MapshaperDataset,
  sourceLayer: MapshaperLayer,
  table: Table,
  opts: { outputLayer?: string; rowIdColumn: string },
): MapshaperDataset {
  const rowIds = readRowIds(table, opts.rowIdColumn, sourceLayer.shapes?.length ?? 0);
  const records = recordsFromArrowTable(table, { skipColumns: [opts.rowIdColumn] });
  const adapter = getDefaultMapshaperAdapter();
  return {
    arcs: sourceDataset.arcs,
    info: sourceDataset.info ? { ...sourceDataset.info } : undefined,
    layers: [
      {
        ...sourceLayer,
        name: opts.outputLayer ?? sourceLayer.name,
        data: adapter.createDataTable(records),
        shapes: rowIds.map((rowId) => cloneShape(sourceLayer.shapes?.[rowId] ?? null)),
      },
    ],
  };
}

function readRowIds(table: Table, rowIdColumn: string, shapeCount: number): number[] {
  const vector = table.getChild(rowIdColumn);
  if (!vector) {
    throw new DuckDbOperationError('conversion-failed', `DuckDB query result is missing '${rowIdColumn}'`);
  }
  const ids: number[] = [];
  for (let row = 0; row < table.numRows; row += 1) {
    const value = vector.get(row);
    const id = typeof value === 'bigint' ? Number(value) : Number(value);
    if (!Number.isInteger(id) || id < 0 || id >= shapeCount) {
      throw new DuckDbOperationError('conversion-failed', `DuckDB query returned invalid row id '${String(value)}'`);
    }
    ids.push(id);
  }
  return ids;
}

function cloneShape(shape: FeatureShape | null): FeatureShape | null {
  if (shape == null) return null;
  if (Array.isArray(shape)) {
    return shape.map((part) => (Array.isArray(part) ? [...part] : part)) as FeatureShape;
  }
  return shape;
}
```

- [ ] **Step 6: Implement error mapping and cleanup**

Add these private helpers in `src/duckdb/duckdb-query-op.ts`:

```ts
function mapQueryError(err: unknown): DuckDbOperationError {
  if (err instanceof DuckDbOperationError) return err;
  return new DuckDbOperationError('query-failed', 'DuckDB query failed', { cause: err });
}

async function cleanupQueryConnection(
  conn: DuckDbConnection | null,
  tableName: string,
  primaryError: unknown,
): Promise<void> {
  if (!conn) return;
  let cleanupError: unknown;
  try {
    await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
  } catch (err) {
    cleanupError = err;
  }
  try {
    await conn.close?.();
  } catch (err) {
    cleanupError ??= err;
  }
  if (!primaryError && cleanupError) {
    throw new DuckDbOperationError('query-failed', 'DuckDB query cleanup failed', {
      cause: cleanupError,
    });
  }
}
```

- [ ] **Step 7: Run fake-runtime tests and confirm they pass**

Run:

```bash
npm run test:run -- src/duckdb/duckdb-query-op.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run staged detect before committing:

```ts
mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })
```

Then commit:

```bash
git add src/duckdb/duckdb-query-op.ts src/duckdb/duckdb-query-op.test.ts
git commit -m "Execute restricted DuckDB SELECT queries over datasets" \
  -m "The helper registers one generated input table, runs a validated SELECT, and reconstructs output geometry from returned row ids so SQL never owns result geometry." \
  -m "Constraint: First query batch must not require DuckDB spatial extension setup." \
  -m "Directive: Do not route query result geometry through DuckDB without revisiting CRS and topology semantics." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: npm run test:run -- src/duckdb/duckdb-query-op.test.ts"
```

## Task 4: Real DuckDB-Wasm Integration Tests

**Files:**
- Create: `src/duckdb/duckdb-query.integration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write integration tests**

Create `src/duckdb/duckdb-query.integration.test.ts` using the existing blocking DuckDB-Wasm runtime pattern from `src/duckdb/duckdb-relation.integration.test.ts`:

```ts
import { createRequire } from 'node:module';
import { tableToIPC, type Table } from 'apache-arrow';
import type * as DuckDBBundles from '@duckdb/duckdb-wasm/blocking';
import { afterAll, describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { DuckDbConnection, DuckDbRuntime } from './duckdb-runtime';
import { queryDatasetWithDuckDb } from './duckdb-query-op';

const describeDuckDbIntegration =
  process.env.DUCKDB_WASM_INTEGRATION === '1' ? describe : describe.skip;

let runtime: DuckDbRuntime | undefined;

type BlockingDuckDbConnectionLike = {
  insertArrowFromIPCStream(buffer: Uint8Array, opts: { name: string; create?: boolean }): void;
  query(sql: string): Table;
  close(): void;
};

async function createBlockingDuckDbRuntime(): Promise<DuckDbRuntime> {
  const require = createRequire(import.meta.url);
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
  } satisfies DuckDBBundles.DuckDBBundles;
  const db = await duckdb.createDuckDB(bundles, new duckdb.ConsoleLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();

  function wrapConnection(): DuckDbConnection {
    const conn = db.connect() as BlockingDuckDbConnectionLike;
    return {
      async insertArrowTable(table, opts) {
        conn.insertArrowFromIPCStream(tableToIPC(table), {
          name: opts.name,
          create: true,
        });
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
    async connect(): Promise<DuckDbConnection> {
      return wrapConnection();
    },
    async ensureSpatial(): Promise<void> {
      throw new Error('DuckDB query integration should not request spatial extension setup');
    },
    async close() {
      await (db as { terminate?: () => Promise<unknown> }).terminate?.();
    },
  };
}

afterAll(async () => {
  await runtime?.close?.();
  runtime = undefined;
});

async function getIntegrationRuntime(): Promise<DuckDbRuntime> {
  runtime ??= await createBlockingDuckDbRuntime();
  return runtime;
}

const POINTS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'alpha', population: 100, active: false }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', properties: { name: 'beta', population: 200, active: true }, geometry: { type: 'Point', coordinates: [1, 1] } },
    { type: 'Feature', properties: { name: 'gamma', population: 300, active: true }, geometry: { type: 'Point', coordinates: [2, 2] } },
  ],
};

async function pointsDataset(): Promise<MapshaperDataset> {
  const dataset = await datasetFromGeoJSON(POINTS);
  dataset.info = { ...dataset.info, crs_string: 'EPSG:4326' };
  return dataset;
}

function records(dataset: MapshaperDataset): Array<Record<string, unknown>> {
  return dataset.layers[0]?.data?.getRecords?.() ?? [];
}

describeDuckDbIntegration('DuckDB SELECT query integration', () => {
  it('filters, projects, orders, and limits rows with real DuckDB-Wasm', async () => {
    const duckDbRuntime = await getIntegrationRuntime();
    const result = await queryDatasetWithDuckDb(
      await pointsDataset(),
      {
        sql: 'SELECT name, population, active FROM input WHERE active = true ORDER BY population DESC LIMIT 1',
        outputLayer: 'top_active',
      },
      duckDbRuntime,
    );

    expect(result.layers[0]?.name).toBe('top_active');
    expect(records(result)).toEqual([{ name: 'gamma', population: 300, active: true }]);
    expect(result.layers[0]?.shapes).toHaveLength(1);
    expect(result.info?.crs_string).toBe('EPSG:4326');
  }, 60_000);

  it('blocks unsafe SQL before DuckDB execution', async () => {
    const duckDbRuntime = await getIntegrationRuntime();

    await expect(
      queryDatasetWithDuckDb(await pointsDataset(), { sql: 'DROP TABLE input' }, duckDbRuntime),
    ).rejects.toMatchObject({ kind: 'validation' });
  }, 60_000);
});
```

- [ ] **Step 2: Run the new integration test directly**

Run:

```bash
DUCKDB_WASM_INTEGRATION=1 npm run test:run -- src/duckdb/duckdb-query.integration.test.ts
```

Expected: PASS with `DUCKDB_WASM_INTEGRATION=1`; without that environment variable the `describe.skip` guard skips the file.

- [ ] **Step 3: Add query integration test to package script**

Modify `package.json` script `test:duckdb` so it includes:

```json
"src/duckdb/duckdb-query.integration.test.ts"
```

Keep the existing DuckDB integration test paths in the script.

- [ ] **Step 4: Run the DuckDB integration script**

Run:

```bash
npm run test:duckdb
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run staged detect before committing:

```ts
mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })
```

Then commit:

```bash
git add package.json src/duckdb/duckdb-query.integration.test.ts
git commit -m "Cover DuckDB SELECT queries with wasm integration tests" \
  -m "Real DuckDB-Wasm coverage verifies that restricted SELECT queries preserve row ordering, scalar output, and source geometry outside the fake runtime." \
  -m "Constraint: Integration coverage remains opt-in through the existing DUCKDB_WASM_INTEGRATION path." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run test:duckdb"
```

## Task 5: Map-Op Integration

**Files:**
- Modify: `src/duckdb/map-op.ts`
- Modify: `src/duckdb/map-op.test.ts`

- [ ] **Step 1: Run impact before editing map-op symbols**

Run:

```ts
mcp__gitnexus.impact({
  repo: "emap",
  target: "duckDbRelationLayer",
  file_path: "src/duckdb/map-op.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before editing.

- [ ] **Step 2: Write failing map-op tests**

Append to `src/duckdb/map-op.test.ts`, reusing its existing `FakeContext`, `FakeRuntime`, `makeContext()`, and `polygonDataset()` helpers. Extend the existing `apache-arrow` import from `import type { Table } from 'apache-arrow';` to `import { tableFromArrays, type Table } from 'apache-arrow';`, and add `duckDbQueryLayer` to the existing `./map-op` import list.

```ts
it('runs DuckDB query layer and writes the output source', async () => {
  const source = await polygonDataset();
  const resultTable = tableFromArrays({ __emap_rowid: [0], name: ['a'] });
  const runtime = new FakeRuntime(resultTable);
  const ctx = makeContext('polygons', source);

  const result = await duckDbQueryLayer(ctx, {
    src: 'polygons',
    sql: 'SELECT name FROM input',
    output: { sourceId: 'filtered' },
    runtime,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sourceId).toBe('filtered');
  expect(ctx.outputDatasets.get('filtered')?.layers[0]?.data?.getRecords?.()).toEqual([
    { name: 'a' },
  ]);
});

it('returns not-found when query source is missing', async () => {
  const ctx = new FakeContext();

  const result = await duckDbQueryLayer(ctx, {
    src: 'missing',
    sql: 'SELECT name FROM input',
    output: { sourceId: 'out' },
    runtime: new FakeRuntime(tableFromArrays({ __emap_rowid: [], name: [] })),
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('not-found');
});

it('returns validation when output source id is missing', async () => {
  const result = await duckDbQueryLayer(makeContext('polygons', await polygonDataset()), {
    src: 'polygons',
    sql: 'SELECT name FROM input',
    runtime: new FakeRuntime(tableFromArrays({ __emap_rowid: [], name: [] })),
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('validation');
});

it('maps SQL rejection to validation OpResult', async () => {
  const result = await duckDbQueryLayer(makeContext('polygons', await polygonDataset()), {
    src: 'polygons',
    sql: 'DROP TABLE input',
    output: { sourceId: 'out' },
    runtime: new FakeRuntime(tableFromArrays({ __emap_rowid: [], name: [] })),
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('validation');
});
```

If `map-op.test.ts` already imports these symbols or has helper names with a different local shape, merge with the existing test style and keep assertions equivalent.

- [ ] **Step 3: Run map-op tests and confirm they fail**

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: FAIL with `duckDbQueryLayer` not exported.

- [ ] **Step 4: Implement map-op API**

In `src/duckdb/map-op.ts`, import `DuckDbQueryOptions` and `queryDatasetWithDuckDb`:

```ts
import { queryDatasetWithDuckDb, type DuckDbQueryOptions } from './duckdb-query-op';
```

Add interfaces near the existing DuckDB layer options:

```ts
export interface DuckDbQueryLayerOptions extends DuckDbQueryOptions {
  src: string;
  output?: { sourceId: string };
  runtime?: DuckDbRuntime;
}

export type DuckDbQueryLayerResult = OpResult<DuckDbLayerSuccess>;
```

Add the function near the other map-op entry points:

```ts
export async function duckDbQueryLayer(
  ctx: DuckDbMapOpContext,
  opts: DuckDbQueryLayerOptions,
): Promise<DuckDbQueryLayerResult> {
  const input = readInputDataset(ctx, opts.src);
  if (!input.ok) return input.result;

  const sourceId = outputSourceId(opts.output);
  if (typeof sourceId !== 'string') return sourceId;

  try {
    const dataset = await queryDatasetWithDuckDb(input.dataset, opts, opts.runtime);
    await ctx.setSourceDataset(sourceId, dataset);
    return okValue({ sourceId, dataset });
  } catch (err) {
    return duckDbErrorToOpResult(err, 'duckdb-query');
  }
}
```

Use `src` for input to match existing `duckDbBufferLayer`, `duckDbGeometryLayer`, `duckDbAttributeLayer`, and `duckDbRelationLayer`; keep `output.sourceId` unchanged.

- [ ] **Step 5: Run map-op tests and confirm they pass**

Run:

```bash
npm run test:run -- src/duckdb/map-op.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run staged detect before committing:

```ts
mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })
```

Then commit:

```bash
git add src/duckdb/map-op.ts src/duckdb/map-op.test.ts
git commit -m "Expose DuckDB SELECT queries as a map operation" \
  -m "Applications can now run the restricted query helper through the existing source context and write the result to output.sourceId." \
  -m "Constraint: Map-op input naming follows existing DuckDB ops by using src." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: npm run test:run -- src/duckdb/map-op.test.ts"
```

## Task 6: Barrel Exports and Documentation

**Files:**
- Modify: `src/duckdb/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Run impact before editing DuckDB barrel**

Run:

```ts
mcp__gitnexus.impact({
  repo: "emap",
  target: "index.ts",
  file_path: "src/duckdb/index.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected: risk is not HIGH or CRITICAL. If it is HIGH or CRITICAL, report it before editing.

- [ ] **Step 2: Export query helpers**

In `src/duckdb/index.ts`, add:

```ts
export * from './duckdb-query-op';
export * from './duckdb-query-sql';
```

Keep existing exports unchanged.

- [ ] **Step 3: Add README usage example**

In `README.md`, add a short DuckDB query subsection near existing DuckDB docs:

```md
### DuckDB restricted SELECT queries

`@zwishing/emap/duckdb` can run a read-only SELECT over an existing dataset layer while preserving source geometry by row id:

```ts
import { queryDatasetWithDuckDb } from '@zwishing/emap/duckdb';

const filtered = await queryDatasetWithDuckDb(dataset, {
  sql: 'SELECT name, population FROM input WHERE population > 100000 ORDER BY population DESC LIMIT 50',
  outputLayer: 'large_places',
});
```

The query helper accepts a single logical table named `input`. The first batch supports scalar attribute projection, filtering, ordering, and limiting; joins, multiple statements, mutating SQL, and calculated output geometry are rejected before DuckDB execution.
```

If README already has a DuckDB section title style, use that style and keep the same facts.

- [ ] **Step 4: Run typecheck for public exports**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

Run staged detect before committing:

```ts
mcp__gitnexus.detect_changes({ repo: "emap", scope: "staged" })
```

Then commit:

```bash
git add README.md src/duckdb/index.ts
git commit -m "Document DuckDB restricted SELECT queries" \
  -m "The public DuckDB barrel and README now expose the query helper as a supported browser API with its restricted SQL contract." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run typecheck"
```

## Task 7: Full Verification and Regression Review

**Files:**
- No new files.
- Review all files changed by Tasks 1 through 6.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm run test:run -- src/formats/table-to-dataset.test.ts src/duckdb/duckdb-query-sql.test.ts src/duckdb/duckdb-query-op.test.ts src/duckdb/map-op.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run DuckDB integration tests**

Run:

```bash
npm run test:duckdb
```

Expected: PASS.

- [ ] **Step 3: Run project verification**

Run:

```bash
npm run typecheck
npm run build
npm run format:check
git diff --check
```

Expected: all commands PASS and `git diff --check` has no output.

- [ ] **Step 4: Run GitNexus comparison against master**

Run:

```ts
mcp__gitnexus.detect_changes({
  repo: "emap",
  scope: "compare",
  base_ref: "master"
})
```

Expected: affected symbols are limited to DuckDB query integration, scalar Arrow record conversion, map-op query entry point, DuckDB exports, docs, and package script changes.

- [ ] **Step 5: Final cleanup check**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: working tree is clean except ignored local state directories if they existed before the implementation; recent commits correspond to the task commits above.

## Self-Review

**Spec coverage:** This plan covers the approved dataset helper, restricted SQL validator, geometry preservation by row id, attribute filtering/projection/order/limit, runtime cleanup, map-op integration, DuckDB-Wasm integration coverage, exports, and README docs. External file-backed DuckDB sources remain outside this batch as specified.

**Placeholder scan:** The plan uses exact file paths, concrete helper names, explicit command lines, expected test outcomes, and concrete rejected SQL cases. It does not require unspecified future work to complete the approved first batch.

**Type consistency:** The plan consistently uses `queryDatasetWithDuckDb`, `validateDuckDbSelectSql`, `DuckDbQueryOptions`, `DuckDbQueryLayerOptions`, logical input table `input`, default geometry column `geometry`, and default row id column `__emap_rowid`. The map-op input field is `src` to match existing DuckDB map-op conventions, while output remains `output.sourceId`.
