# GeoParquet CRS Compatibility impl Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the current GeoParquet/CRS WIP so exported files preserve source coordinates, emit standards-compatible CRS and bbox metadata, and fail before writing bytes when a CRS cannot be expressed as GeoParquet PROJJSON.

**Architecture:** Keep the change inside the existing format boundary. `TopologySource` stamps specification-implied WGS84 only when import metadata is absent, `exportGeoParquet()` resolves strict GeoParquet CRS policy, `epsg-projjson.ts` loads full EPSG PROJJSON assets on demand, and `toArrowTable()` only builds Arrow geometry, attribute, and bbox columns from resolved inputs. Low-level Arrow conversion may still represent truly missing source CRS as `crs:null`; the browser GeoParquet export path must not downgrade a present CRS label into unknown CRS.

**Tech Stack:** TypeScript, Vitest, apache-arrow, parquet-wasm, @zwishing/epsg-index assets, mapshaper datasets, GitNexus/CodeGraph for impact and change review.

---

## File Structure

- Modify `src/formats/geoparquet-metadata.ts`: CRS string to PROJJSON policy, strict error type, GeoParquet metadata writer.
- Modify `src/formats/geoparquet-metadata.test.ts`: unit coverage for strict CRS resolution and default CRS omission.
- Modify `src/formats/epsg-projjson.ts`: EPSG asset fetch failure diagnostics and cache behavior.
- Create `src/formats/epsg-projjson.test.ts`: isolated tests for path lookup, local asset fetch, HTTP failure, malformed JSON, and missing `fetch`.
- Modify `src/formats/geoparquet-io.ts`: strict CRS export wiring, bbox default, field metadata stripping before Parquet write.
- Modify `src/formats/geoparquet-io.test.ts`: export-level failure and external-reader metadata assertions.
- Modify `src/formats/dataset-to-table.ts`: bbox covering column and collision behavior only if current WIP fails the tests below.
- Modify `src/formats/dataset-to-table.test.ts`: bbox collision, disabled bbox, and null geometry row tests.
- Modify `src/source/topology-source.ts`: specification-implied WGS84 stamping only when metadata is absent.
- Modify `src/source/topology-source.test.ts`: import-boundary CRS tests.
- Create `docs/superpowers/verification/2026-06-17-geoparquet-crs-compat.md`: release verification commands and GDAL/DuckDB/QGIS smoke notes.

---

## Task 0: Pre-Change Impact Baseline

- Inspect: `src/formats/geoparquet-metadata.ts`
- Inspect: `src/formats/epsg-projjson.ts`
- Inspect: `src/formats/geoparquet-io.ts`
- Inspect: `src/formats/dataset-to-table.ts`
- Inspect: `src/source/topology-source.ts`

- [ ] **Step 1: Run symbol impact before editing CRS metadata functions**

Use GitNexus before modifying these functions:

```text
mcp__gitnexus.impact({
  repo: "emap",
  target: "crsStringToProjjson",
  file_path: "src/formats/geoparquet-metadata.ts",
  direction: "upstream",
  summaryOnly: true
})

mcp__gitnexus.impact({
  repo: "emap",
  target: "crsStringToProjjsonAsync",
  file_path: "src/formats/geoparquet-metadata.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected result:

```text
risk is LOW or MEDIUM
direct callers include dataset-to-table and geoparquet-io
no HIGH or CRITICAL risk
```

If risk is HIGH or CRITICAL, stop edits and report the affected callers and processes.

- [ ] **Step 2: Run symbol impact before editing EPSG asset lookup**

```text
mcp__gitnexus.impact({
  repo: "emap",
  target: "findEpsgProjjsonAsync",
  file_path: "src/formats/epsg-projjson.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected result:

```text
risk is LOW or MEDIUM
direct caller includes findAuthorityProjjsonAsync
```

- [ ] **Step 3: Run symbol impact before editing GeoParquet export**

```text
mcp__gitnexus.impact({
  repo: "emap",
  target: "exportGeoParquet",
  file_path: "src/formats/geoparquet-io.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected result:

```text
risk is LOW or MEDIUM
direct callers are tests and source export wiring
```

- [ ] **Step 4: Run symbol impact before editing Arrow table conversion**

```text
mcp__gitnexus.impact({
  repo: "emap",
  target: "toArrowTable",
  file_path: "src/formats/dataset-to-table.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected result:

```text
risk is LOW or MEDIUM
direct callers include geoarrow/geoparquet export tests and format entrypoints
```

- [ ] **Step 5: Run symbol impact before editing TopologySource**

```text
mcp__gitnexus.impact({
  repo: "emap",
  target: "TopologySource",
  file_path: "src/source/topology-source.ts",
  direction: "upstream",
  summaryOnly: true
})
```

Expected result:

```text
risk is LOW or MEDIUM
callers are source tests and public source construction sites
```

---

## Task 1: Strict CRS Resolution Semantics

- Modify: `src/formats/geoparquet-metadata.test.ts`
- Modify: `src/formats/geoparquet-metadata.ts`

- [ ] **Step 1: Add failing tests for strict known EPSG and custom CRS rejection**

Append these tests inside `describe('GeoParquet CRS metadata semantics', ...)` in `src/formats/geoparquet-metadata.test.ts`:

```typescript
  it('rejects known EPSG CRS when strict PROJJSON resolution fails', async () => {
    await expect(
      crsStringToProjjsonAsync('EPSG:4490', async () => undefined, { strict: true }),
    ).rejects.toThrow('GeoParquet export requires PROJJSON for EPSG:4490');
  });

  it('rejects custom CRS labels in strict GeoParquet export mode', async () => {
    await expect(
      crsStringToProjjsonAsync('+proj=utm +zone=10', undefined, { strict: true }),
    ).rejects.toThrow(
      "GeoParquet export cannot express CRS '+proj=utm +zone=10' as PROJJSON",
    );
  });

  it('keeps permissive Arrow metadata behavior for custom CRS labels', () => {
    expect(crsStringToProjjson('+proj=utm +zone=10')).toBeNull();
  });
```

- [ ] **Step 2: Run the focused failing test**

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts
```

Expected output:

```text
FAIL src/formats/geoparquet-metadata.test.ts
rejects known EPSG CRS when strict PROJJSON resolution fails
rejects custom CRS labels in strict GeoParquet export mode
```

- [ ] **Step 3: Add the strict option and error type**

In `src/formats/geoparquet-metadata.ts`, add these exports after `CrsProjjsonAsyncLookup`:

```typescript
export interface CrsStringToProjjsonOptions {
  strict?: boolean;
}

export class GeoParquetCrsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoParquetCrsError';
  }
}
```

Then add these helpers before `crsStringToProjjson()`:

```typescript
function unsupportedCrsResult(
  crsString: string,
  opts: CrsStringToProjjsonOptions | undefined,
): null {
  const message = `GeoParquet export cannot express CRS '${crsString}' as PROJJSON`;
  if (opts?.strict) throw new GeoParquetCrsError(message);
  console.warn(`emap formats: cannot express CRS '${crsString}' as PROJJSON; marking unknown`);
  return null;
}

function unresolvedEpsgResult(
  code: string,
  opts: CrsStringToProjjsonOptions | undefined,
): null {
  const message = `GeoParquet export requires PROJJSON for EPSG:${code}, but it could not be resolved`;
  if (opts?.strict) throw new GeoParquetCrsError(message);
  console.warn(`emap formats: EPSG:${code} PROJJSON not found; marking CRS unknown`);
  return null;
}
```

- [ ] **Step 4: Update sync CRS conversion to use the option**

Replace the `crsStringToProjjson` signature and unresolved branches in `src/formats/geoparquet-metadata.ts` with this shape:

```typescript
export function crsStringToProjjson(
  crsString: string | undefined,
  lookup?: CrsProjjsonLookup,
  opts?: CrsStringToProjjsonOptions,
): unknown {
  if (!crsString) return null;
  const m = /^(EPSG|OGC):([\w]+)$/i.exec(crsString.trim());
  if (!m) return unsupportedCrsResult(crsString, opts);
  const authority = m[1].toUpperCase();
  const code = m[2];
  if (
    (authority === 'EPSG' && code === '4326') ||
    (authority === 'OGC' && code.toUpperCase() === 'CRS84')
  ) {
    return undefined;
  }

  const resolved = lookup?.(authority, code);
  if (resolved !== undefined) return normalizeProjjsonForExport(resolved);

  if (authority === 'EPSG' && code === '3857') {
    return EPSG_3857_PROJJSON;
  }

  if (authority === 'EPSG') return unresolvedEpsgResult(code, opts);
  return unsupportedCrsResult(crsString, opts);
}
```

- [ ] **Step 5: Update async CRS conversion to use the option**

Replace the `crsStringToProjjsonAsync` signature and unresolved branches with this shape:

```typescript
export async function crsStringToProjjsonAsync(
  crsString: string | undefined,
  lookup?: CrsProjjsonAsyncLookup,
  opts?: CrsStringToProjjsonOptions,
): Promise<unknown> {
  if (!crsString) return null;
  const m = /^(EPSG|OGC):([\w:]+)$/i.exec(crsString.trim());
  if (!m) return unsupportedCrsResult(crsString, opts);
  const authority = m[1].toUpperCase();
  const code = m[2];
  if (
    (authority === 'EPSG' && code === '4326') ||
    (authority === 'OGC' && code.toUpperCase() === 'CRS84')
  ) {
    return undefined;
  }

  if (authority === 'EPSG' && code === '3857') {
    return EPSG_3857_PROJJSON;
  }

  const resolved = await lookup?.(authority, code);
  if (resolved !== undefined) return normalizeProjjsonForExport(resolved);

  if (authority === 'EPSG') return unresolvedEpsgResult(code, opts);
  return unsupportedCrsResult(crsString, opts);
}
```

- [ ] **Step 6: Run the focused test**

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-metadata.test.ts
```

- [ ] **Step 7: Commit strict CRS metadata behavior**

```bash
git add src/formats/geoparquet-metadata.ts src/formats/geoparquet-metadata.test.ts
git commit -m "Require resolvable CRS metadata for GeoParquet export" -m "GeoParquet export needs a clear distinction between missing source CRS and present CRS labels that cannot be serialized as PROJJSON. The low-level Arrow path remains able to represent unknown source CRS as crs:null, while strict export mode now rejects custom CRS labels and unresolved EPSG codes before Parquet bytes are written." -m "Constraint: GeoParquet 1.1 CRS metadata must be PROJJSON, null, or omitted for the default CRS84 semantics" -m "Rejected: Continue warning and writing crs:null for EPSG lookup failure | hides data CRS from GDAL, QGIS, and DuckDB readers" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: npm run test:run -- src/formats/geoparquet-metadata.test.ts"
```

---

## Task 2: EPSG Asset Fetch Diagnostics

- Create: `src/formats/epsg-projjson.test.ts`
- Modify: `src/formats/epsg-projjson.ts`

- [ ] **Step 1: Create failing EPSG asset tests**

Create `src/formats/epsg-projjson.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  findAuthorityProjjsonAsync,
  findEpsgProjjsonAsync,
  findEpsgProjjsonPath,
} from './epsg-projjson';

const localEpsgIndexFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const match = /\/s\/([^/]+\.json)$/.exec(url.pathname);
  if (!match) return new Response(null, { status: 404 });
  const bytes = await readFile(
    new URL(`../../node_modules/@zwishing/epsg-index/s/${match[1]}`, import.meta.url),
  );
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

describe('EPSG PROJJSON asset lookup', () => {
  it('maps EPSG codes to epsg-index asset paths', () => {
    expect(findEpsgProjjsonPath('4490')).toMatch(/^s\/.+\.json$/);
    expect(findEpsgProjjsonPath(' EPSG:4490 ')).toBeUndefined();
  });

  it('loads complete PROJJSON through an injected fetch', async () => {
    const crs = (await findAuthorityProjjsonAsync('EPSG', '4490', {
      fetch: localEpsgIndexFetch,
      baseUrl: 'https://local-epsg.test/pkg/',
    })) as Record<string, unknown>;

    expect(crs).toMatchObject({
      type: 'GeographicCRS',
      name: 'China Geodetic Coordinate System 2000',
      id: { authority: 'EPSG', code: 4490 },
    });
    expect(crs).toHaveProperty('coordinate_system');
  });

  it('rejects when the EPSG asset response is not OK', async () => {
    await expect(
      findEpsgProjjsonAsync('4490', {
        baseUrl: 'https://http-failure.example/pkg/',
        fetch: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow('EPSG:4490 PROJJSON fetch failed with HTTP 404 Not Found');
  });

  it('rejects when the EPSG asset is not JSON', async () => {
    await expect(
      findEpsgProjjsonAsync('4490', {
        baseUrl: 'https://json-failure.example/pkg/',
        fetch: async () => new Response('{', { status: 200 }),
      }),
    ).rejects.toThrow('EPSG:4490 PROJJSON asset could not be parsed');
  });

  it('returns undefined for numeric EPSG codes that are absent from the path table', async () => {
    await expect(
      findEpsgProjjsonAsync('999999', {
        baseUrl: 'https://absent.example/pkg/',
        fetch: localEpsgIndexFetch,
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the new failing test**

```bash
npm run test:run -- src/formats/epsg-projjson.test.ts
```

Expected output:

```text
FAIL src/formats/epsg-projjson.test.ts
rejects when the EPSG asset response is not OK
rejects when the EPSG asset is not JSON
```

- [ ] **Step 3: Add fetch error caching and messages**

In `src/formats/epsg-projjson.ts`, replace the cache declaration:

```typescript
const projjsonCache = new Map<string, unknown | null>();
```

with:

```typescript
const projjsonCache = new Map<string, unknown | Error>();

export class EpsgProjjsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpsgProjjsonError';
  }
}
```

- [ ] **Step 4: Update `findEpsgProjjsonAsync()`**

Replace the body of `findEpsgProjjsonAsync()` with:

```typescript
export async function findEpsgProjjsonAsync(
  code: string,
  opts: EpsgProjjsonFetchOptions = {},
): Promise<unknown | undefined> {
  const normalized = code.trim();
  const path = findEpsgProjjsonPath(normalized);
  if (!path) return undefined;

  const baseUrl = opts.baseUrl ?? DEFAULT_EPSG_PROJJSON_BASE_URL;
  const url = new URL(path, baseUrl).toString();
  const cached = projjsonCache.get(url);
  if (cached instanceof Error) throw cached;
  if (cached !== undefined) return cached;

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    const error = new EpsgProjjsonError(`EPSG:${normalized} PROJJSON fetch requires a fetch implementation`);
    projjsonCache.set(url, error);
    throw error;
  }

  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      const error = new EpsgProjjsonError(
        `EPSG:${normalized} PROJJSON fetch failed with HTTP ${response.status} ${response.statusText}`.trim(),
      );
      projjsonCache.set(url, error);
      throw error;
    }
    const projjson = await response.json();
    projjsonCache.set(url, projjson);
    return projjson;
  } catch (err) {
    if (err instanceof EpsgProjjsonError) throw err;
    const error = new EpsgProjjsonError(`EPSG:${normalized} PROJJSON asset could not be parsed`);
    projjsonCache.set(url, error);
    throw error;
  }
}
```

- [ ] **Step 5: Run the EPSG asset test**

```bash
npm run test:run -- src/formats/epsg-projjson.test.ts
```

Expected output:

```text
PASS src/formats/epsg-projjson.test.ts
```

- [ ] **Step 6: Run CRS metadata tests to catch contract drift**

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-metadata.test.ts
```

- [ ] **Step 7: Commit EPSG asset diagnostics**

```bash
git add src/formats/epsg-projjson.ts src/formats/epsg-projjson.test.ts
git commit -m "Surface EPSG PROJJSON asset failures" -m "Known EPSG codes should either resolve to complete PROJJSON or fail with enough context for app developers to fix fetch/baseUrl wiring. Returning undefined for HTTP and JSON failures made export errors less precise." -m "Constraint: @zwishing/epsg-index stores full records as package assets, so browser export can only load non-bundled EPSG records through fetch" -m "Rejected: Cache failed fetches as null | second call would lose the URL/status diagnostic" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: npm run test:run -- src/formats/epsg-projjson.test.ts src/formats/geoparquet-metadata.test.ts"
```

---

## Task 3: Strict GeoParquet Export Wiring

- Modify: `src/formats/geoparquet-io.test.ts`
- Modify: `src/formats/geoparquet-io.ts`

- [ ] **Step 1: Add export-level rejection tests**

Append these tests inside `describe('GeoParquet round trip', ...)` in `src/formats/geoparquet-io.test.ts`:

```typescript
  it('rejects export when a known EPSG CRS cannot resolve to PROJJSON', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: 'EPSG:4490' };

    await expect(
      exportGeoParquet(dataset, {
        baseUrl: 'https://export-epsg-failure.example/pkg/',
        fetch: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow('EPSG:4490 PROJJSON fetch failed with HTTP 404 Not Found');
  });

  it('rejects export for custom CRS labels instead of writing unknown CRS', async () => {
    const dataset = await datasetFromGeoJSON(FC);
    dataset.info = { ...dataset.info, crs_string: '+proj=utm +zone=10' };

    await expect(exportGeoParquet(dataset)).rejects.toThrow(
      "GeoParquet export cannot express CRS '+proj=utm +zone=10' as PROJJSON",
    );
  });
```

- [ ] **Step 2: Run the focused failing export test**

```bash
npm run test:run -- src/formats/geoparquet-io.test.ts
```

Expected output:

```text
FAIL src/formats/geoparquet-io.test.ts
rejects export when a known EPSG CRS cannot resolve to PROJJSON
rejects export for custom CRS labels instead of writing unknown CRS
```

- [ ] **Step 3: Pass strict mode into async CRS resolution**

In `src/formats/geoparquet-io.ts`, update the call to `crsStringToProjjsonAsync()`:

```typescript
      : await crsStringToProjjsonAsync(
          sourceCrsString,
          async (authority, code) => {
            const explicit = opts.crsProjjsonLookup?.(authority, code);
            if (explicit !== undefined) return explicit;
            return findAuthorityProjjsonAsync(authority, code, {
              baseUrl: opts.baseUrl,
              fetch: opts.fetch,
            });
          },
          { strict: true },
        );
```

Do not change `toArrowTable()` to strict mode in this task; its tests intentionally allow `crs:null` for Arrow-only conversion.

- [ ] **Step 4: Run the focused export test**

```bash
npm run test:run -- src/formats/geoparquet-io.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-io.test.ts
```

- [ ] **Step 5: Run CRS conversion tests together**

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.test.ts src/formats/geoparquet-io.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-metadata.test.ts
PASS src/formats/epsg-projjson.test.ts
PASS src/formats/geoparquet-io.test.ts
```

- [ ] **Step 6: Commit export strictness**

```bash
git add src/formats/geoparquet-io.ts src/formats/geoparquet-io.test.ts
git commit -m "Fail GeoParquet export on unresolved CRS" -m "The public GeoParquet writer is the standards-facing path, so it must reject present CRS labels that cannot become PROJJSON. This keeps low-level Arrow conversion permissive while preventing externally visible files with silently unknown CRS." -m "Constraint: GeoParquet readers treat omitted CRS, null CRS, and PROJJSON CRS differently" -m "Rejected: Make toArrowTable strict by default | would break Arrow/GeoArrow callers that use crs:null to represent truly unknown source metadata" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: npm run test:run -- src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.test.ts src/formats/geoparquet-io.test.ts"
```

---

## Task 4: BBox Covering Completeness

- Modify: `src/formats/dataset-to-table.test.ts`
- Modify: `src/formats/dataset-to-table.ts`
- Modify: `src/formats/geoparquet-io.test.ts`

- [ ] **Step 1: Add bbox column collision and disabled-covering tests**

Append these tests inside `describe('toArrowTable', ...)` in `src/formats/dataset-to-table.test.ts`:

```typescript
  it('uses a unique bbox covering column name when attributes already contain bbox', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { bbox: 'kept', id: 1 },
          geometry: { type: 'Point', coordinates: [3, 4] },
        },
      ],
    });

    const table = toArrowTable(dataset, { bboxColumn: 'bbox' });
    const names = table.schema.fields.map((field) => field.name);
    expect(names).toContain('bbox');
    expect(names).toContain('bbox_1');
    expect(table.getChild('bbox')!.get(0)).toBe('kept');
    expect(table.getChild('bbox_1')!.get(0)?.toJSON()).toEqual({
      xmin: 3,
      ymin: 4,
      xmax: 3,
      ymax: 4,
    });

    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.covering?.bbox).toEqual({
      xmin: ['bbox_1', 'xmin'],
      ymin: ['bbox_1', 'ymin'],
      xmax: ['bbox_1', 'xmax'],
      ymax: ['bbox_1', 'ymax'],
    });
  });

  it('omits bbox covering metadata when bboxColumn is false', async () => {
    const dataset = await datasetFromGeoJSON(TWO_LAYER_INPUT);
    const table = toArrowTable(dataset, { bboxColumn: false });
    const names = table.schema.fields.map((field) => field.name);
    expect(names).not.toContain('bbox');
    const column = parseGeoMetadata(table.schema.metadata)?.columns.geometry;
    expect(column?.covering).toBeUndefined();
  });

  it('writes null bbox struct rows for null geometries', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
          geometry: { type: 'Point', coordinates: [1, 2] },
        },
        { type: 'Feature', properties: { id: 2 }, geometry: null },
      ],
    });

    const table = toArrowTable(dataset, { bboxColumn: 'bbox' });
    const bbox = table.getChild('bbox')!;
    expect(bbox.isValid(0)).toBe(true);
    expect(bbox.isValid(1)).toBe(false);
  });
```

- [ ] **Step 2: Add export-level bbox collision test**

Append this test inside `describe('GeoParquet round trip', ...)` in `src/formats/geoparquet-io.test.ts`:

```typescript
  it('keeps an existing bbox attribute and writes covering metadata to a suffixed bbox column', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { bbox: 'attribute', id: 1 },
          geometry: { type: 'Point', coordinates: [7, 8] },
        },
      ],
    });

    const bytes = await exportGeoParquet(dataset);
    const table = tableFromIPC(wasm.readParquet(bytes).intoIPCStream());
    expect(table.schema.fields.map((field) => field.name)).toContain('bbox_1');
    expect(table.getChild('bbox')!.get(0)).toBe('attribute');
    expect(table.getChild('bbox_1')!.get(0)?.toJSON()).toEqual({
      xmin: 7,
      ymin: 8,
      xmax: 7,
      ymax: 8,
    });

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes]));
    const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
    const column = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry;
    expect(column?.covering?.bbox).toEqual({
      xmin: ['bbox_1', 'xmin'],
      ymin: ['bbox_1', 'ymin'],
      xmax: ['bbox_1', 'xmax'],
      ymax: ['bbox_1', 'ymax'],
    });
  });
```

- [ ] **Step 3: Run focused bbox tests**

```bash
npm run test:run -- src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts
```

Expected output when current WIP already satisfies behavior:

```text
PASS src/formats/dataset-to-table.test.ts
PASS src/formats/geoparquet-io.test.ts
```

If it fails, continue with Steps 4 and 5.

- [ ] **Step 4: Keep bbox column names unique**

In `src/formats/dataset-to-table.ts`, ensure `toArrowTable()` computes the bbox column this way:

```typescript
  const bboxColumn = opts.bboxColumn
    ? uniqueColumnName(opts.bboxColumn, new Set([...fieldNames, geometryColumn]))
    : null;
  if (bboxColumn) {
    const { field, data } = buildBBoxColumn(bboxColumn, outputGeometry);
    fields.push(field);
    children.push(data);
  }
```

Ensure `buildGeoMetadata()` receives the actual chosen name:

```typescript
        bboxColumn: bboxColumn ?? undefined,
```

- [ ] **Step 5: Ensure null geometry bbox values remain null**

In `src/formats/dataset-to-table.ts`, ensure `buildBBoxColumn()` builds validity from each feature bbox:

```typescript
function buildBBoxColumn(name: string, geometry: CollectedGeometry): { field: Field; data: Data } {
  const values = geometry.featureBBoxes;
  const children = ['xmin', 'ymin', 'xmax', 'ymax'].map((key, index) =>
    makeVector({
      type: new Float64(),
      data: values.map((bbox) => bbox?.[index] ?? null),
    }).data[0],
  );
  const type = new Struct([
    new Field('xmin', new Float64(), true),
    new Field('ymin', new Float64(), true),
    new Field('xmax', new Float64(), true),
    new Field('ymax', new Float64(), true),
  ]);
  const nullBitmap = values.map((bbox) => bbox !== null);
  return {
    field: new Field(name, type, true),
    data: makeData({
      type,
      children,
      length: values.length,
      nullCount: nullBitmap.filter((valid) => !valid).length,
      nullBitmap,
    }),
  };
}
```

Match the existing Arrow helper style in the file if the exact constructor names differ; preserve the public behavior shown by the tests.

- [ ] **Step 6: Run focused bbox tests again**

```bash
npm run test:run -- src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts
```

Expected output:

```text
PASS src/formats/dataset-to-table.test.ts
PASS src/formats/geoparquet-io.test.ts
```

- [ ] **Step 7: Commit bbox covering completeness**

```bash
git add src/formats/dataset-to-table.ts src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts
git commit -m "Complete GeoParquet bbox covering metadata" -m "GeoParquet 1.1 bbox covering improves external reader filtering, but it must not overwrite user attributes named bbox. The chosen covering column is now deterministic, nullable per feature, and reflected in file metadata." -m "Constraint: GeoParquet covering metadata points to struct child field paths, not only a top-level bbox column name" -m "Rejected: Skip bbox when an attribute already uses bbox | loses useful covering metadata for common datasets" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: npm run test:run -- src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts"
```

---

## Task 5: Parquet Field Metadata Compatibility

- Modify: `src/formats/geoparquet-io.test.ts`
- Modify: `src/formats/geoparquet-io.ts`

- [ ] **Step 1: Strengthen the GDAL/libarrow compatibility assertion**

In the existing `does not declare geoarrow extension types in the embedded arrow schema` test in `src/formats/geoparquet-io.test.ts`, keep the existing field assertion and add file-level metadata checks:

```typescript
    expect(geomField?.metadata.has('ARROW:extension:name')).toBe(false);
    expect(geomField?.metadata.has('ARROW:extension:metadata')).toBe(false);

    const file = await wasm.ParquetFile.fromFile(new Blob([bytes]));
    const fileGeo = file.metadata().fileMetadata().keyValueMetadata().get('geo');
    expect(fileGeo).toEqual(expect.any(String));
    const column = parseGeoMetadata(new Map([['geo', fileGeo as string]]))?.columns.geometry;
    expect(column?.encoding).toBe('WKB');
    expect(column?.crs).toMatchObject({
      id: { authority: 'EPSG', code: 3857 },
    });
```

- [ ] **Step 2: Run the focused compatibility test**

```bash
npm run test:run -- src/formats/geoparquet-io.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-io.test.ts
```

If the test fails because field metadata is still present, use Step 3.

- [ ] **Step 3: Keep stripping field extension metadata before Parquet write**

In `src/formats/geoparquet-io.ts`, ensure `stripFieldExtensionMetadata()` removes only field extension keys and leaves schema metadata intact:

```typescript
function stripFieldExtensionMetadata(table: Table): Table {
  if (!table.schema.fields.some((f) => f.metadata.has(ARROW_EXTENSION_NAME))) return table;
  const fields = table.schema.fields.map((f) => {
    if (!f.metadata.has(ARROW_EXTENSION_NAME)) return f;
    const metadata = new Map(
      [...f.metadata].filter(([k]) => k !== ARROW_EXTENSION_NAME && k !== ARROW_EXTENSION_METADATA),
    );
    return new Field(f.name, f.type, f.nullable, metadata);
  });
  const schema = new Schema(fields, table.schema.metadata);
  return new Table(
    schema,
    table.batches.map((batch) => new RecordBatch(schema, batch.data)),
  );
}
```

- [ ] **Step 4: Run the focused compatibility test again**

```bash
npm run test:run -- src/formats/geoparquet-io.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-io.test.ts
```

- [ ] **Step 5: Commit field metadata compatibility**

```bash
git add src/formats/geoparquet-io.ts src/formats/geoparquet-io.test.ts
git commit -m "Keep GeoParquet metadata compatible with GDAL" -m "GDAL/libarrow can treat GeoArrow field extensions in Parquet as an unsupported native geometry logical type. The Parquet writer keeps geometry truth in file-level GeoParquet metadata and strips Arrow extension keys from embedded field metadata." -m "Constraint: parquet-wasm cannot write the GEOMETRY/GEOGRAPHY logical type expected by GDAL when Arrow extension metadata is present" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: npm run test:run -- src/formats/geoparquet-io.test.ts"
```

---

## Task 6: Specification-Implied WGS84 Import CRS

- Modify: `src/source/topology-source.test.ts`
- Modify: `src/source/topology-source.ts`

- [ ] **Step 1: Ensure tests cover implied and preserved CRS**

If these tests are not already present in `src/source/topology-source.test.ts`, add them inside the import-related `describe` block:

```typescript
  it('marks GeoJSON imports as EPSG:4326 when mapshaper provides no CRS metadata', async () => {
    const runImport = vi.fn(async () => ({ ...FAKE_DATASET, info: {} }));
    const src = new TopologySource('t', { mapshaperRunner: { runImport } });

    await src.setData({ filename: 'a.geojson', content: new Uint8Array([123, 125]) });

    expect(src.getDataset()?.info?.crs_string).toBe('EPSG:4326');
  });

  it('does not mark shapefile imports as EPSG:4326 without CRS metadata', async () => {
    const runImport = vi.fn(async () => ({ ...FAKE_DATASET, info: {} }));
    const src = new TopologySource('t', { mapshaperRunner: { runImport } });

    await src.setData({ filename: 'a.shp', content: new Uint8Array([0]) });

    expect(src.getDataset()?.info?.crs_string).toBeUndefined();
  });

  it('does not override CRS metadata already carried by the imported dataset', async () => {
    const runImport = vi.fn(async () => ({
      ...FAKE_DATASET,
      info: { prj: 'PROJCS["X",AUTHORITY["EPSG","3857"]]' },
    }));
    const src = new TopologySource('t', { mapshaperRunner: { runImport } });

    await src.setData({ filename: 'a.geojson', content: new Uint8Array([123, 125]) });

    expect(src.getDataset()?.info?.crs_string).toBeUndefined();
    expect(src.getCRS()).toBe('EPSG:3857');
  });
```

- [ ] **Step 2: Run the focused source test**

```bash
npm run test:run -- src/source/topology-source.test.ts
```

Expected output:

```text
PASS src/source/topology-source.test.ts
```

If it fails, continue with Steps 3 and 4.

- [ ] **Step 3: Add specification-implied file matching**

In `src/source/topology-source.ts`, keep this constant near the other import helpers:

```typescript
const WGS84_SPEC_FORMAT_RE = /\.(geojson|topojson|json|kml)$/i;
```

- [ ] **Step 4: Stamp CRS only when imported metadata is absent**

After import succeeds and before the dataset is stored, ensure the code checks the primary filenames and existing CRS metadata:

```typescript
      if (
        dataset.info &&
        resolveDatasetCRSMetadata(dataset) === undefined &&
        primaryFiles.every((file) => WGS84_SPEC_FORMAT_RE.test(file.filename))
      ) {
        dataset.info.crs_string = 'EPSG:4326';
      }
```

Use the current local variable names in `setData()`; the behavior must match the tests above.

- [ ] **Step 5: Run the focused source test again**

```bash
npm run test:run -- src/source/topology-source.test.ts
```

Expected output:

```text
PASS src/source/topology-source.test.ts
```

- [ ] **Step 6: Commit import CRS defaults**

```bash
git add src/source/topology-source.ts src/source/topology-source.test.ts
git commit -m "Stamp spec-implied CRS on browser imports" -m "GeoJSON, TopoJSON, JSON-as-GeoJSON, and KML imply WGS84 lon/lat when no CRS metadata is present. Stamping EPSG:4326 at the import boundary lets GeoParquet export omit CRS under CRS84 semantics instead of writing unknown CRS for these formats." -m "Constraint: Shapefile and other sidecar-based formats must keep absent CRS absent unless mapshaper provides metadata" -m "Rejected: Default every import without CRS to EPSG:4326 | would mislabel projected shapefiles and other formats" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: npm run test:run -- src/source/topology-source.test.ts"
```

---

## Task 7: External Verification Notes

- Create: `docs/superpowers/verification/2026-06-17-geoparquet-crs-compat.md`

- [ ] **Step 1: Create verification notes**

Create `docs/superpowers/verification/2026-06-17-geoparquet-crs-compat.md`:

````markdown
# GeoParquet CRS Compatibility Verification

Date: 2026-06-17

## Automated Commands

Run from `/Users/zhang/code/emap`:

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.test.ts src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts src/source/topology-source.test.ts
npm run test:duckdb
npm run typecheck
npm run build
npm pack --dry-run
```

## GDAL Smoke

Generate or reuse CRS84, EPSG:3857, and EPSG:4490 GeoParquet samples from the test harness, then run:

```bash
ogrinfo -al -so /absolute/path/to/crs84.parquet
ogrinfo -al -so /absolute/path/to/epsg3857.parquet
ogrinfo -al -so /absolute/path/to/epsg4490.parquet
```

Expected observations:

- Driver reports Parquet or GeoParquet.
- Geometry column is present.
- Feature count matches the sample.
- Extent matches the sample coordinates.
- EPSG:3857 and EPSG:4490 samples report a CRS.

## DuckDB Smoke

Run with DuckDB spatial and parquet extensions enabled:

```sql
INSTALL spatial;
INSTALL parquet;
LOAD spatial;
LOAD parquet;
SELECT count(*) FROM read_parquet('/absolute/path/to/epsg3857.parquet');
SELECT ST_GeometryType(geometry) FROM read_parquet('/absolute/path/to/epsg3857.parquet') LIMIT 1;
```

Expected observations:

- Row count matches the sample.
- Geometry values are readable.
- Attribute columns are present.

## QGIS Smoke

Open each sample in QGIS:

- Layer loads without a repair prompt.
- CRS is shown as expected.
- Attributes are visible.
- Geometry appears in the expected location.
````

- [ ] **Step 2: Stage verification notes**

`docs/superpowers/` is ignored in this repo. Force-add the file:

```bash
git add -f docs/superpowers/verification/2026-06-17-geoparquet-crs-compat.md
```

- [ ] **Step 3: Commit verification notes**

```bash
git commit -m "Document GeoParquet compatibility verification" -m "The release check needs human-readable commands for GDAL, DuckDB, and QGIS because only the unit and DuckDB wasm portions can run reliably in local CI. The note records exactly what to inspect before publishing." -m "Constraint: QGIS remains a manual smoke test and must not become a required test dependency" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: Document-only change"
```

---

## Task 8: Final Verification and Release Readiness

- Inspect: all modified files
- Run: focused tests, full relevant tests, typecheck, build, package dry-run

- [ ] **Step 1: Run the complete focused GeoParquet/CRS test set**

```bash
npm run test:run -- src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.test.ts src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts src/source/topology-source.test.ts
```

Expected output:

```text
PASS src/formats/geoparquet-metadata.test.ts
PASS src/formats/epsg-projjson.test.ts
PASS src/formats/dataset-to-table.test.ts
PASS src/formats/geoparquet-io.test.ts
PASS src/source/topology-source.test.ts
```

- [ ] **Step 2: Run DuckDB integration tests**

```bash
npm run test:duckdb
```

Expected output:

```text
PASS src/duckdb/duckdb-buffer.integration.test.ts
PASS src/duckdb/duckdb-attribute.integration.test.ts
PASS src/duckdb/duckdb-relation.integration.test.ts
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected output:

```text
no TypeScript errors
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected output:

```text
build completes without errors
dist/ outputs are regenerated as expected by the package scripts
```

- [ ] **Step 5: Run package dry-run**

```bash
npm pack --dry-run
```

Expected output:

```text
npm notice
package tarball contents include dist files and package metadata
no unexpected test fixtures or local state directories are included
```

- [ ] **Step 6: Review changed symbols before the final commit**

```text
mcp__gitnexus.detect_changes({
  repo: "emap",
  scope: "all"
})
```

Expected result:

```text
risk matches the intended formats/source boundary
changed symbols are limited to GeoParquet CRS, EPSG asset lookup, Arrow table export, and TopologySource import CRS stamping
```

- [ ] **Step 7: Check git status**

```bash
git status --short
```

Expected output:

```text
only intended files are modified or staged
unrelated pre-existing files are left untouched
```

- [ ] **Step 8: Make the final implementation commit if previous tasks were batched**

If tasks were committed one by one, skip this step. If implementation was batched, commit with:

```bash
git add src/formats/geoparquet-metadata.ts src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.ts src/formats/epsg-projjson.test.ts src/formats/geoparquet-io.ts src/formats/geoparquet-io.test.ts src/formats/dataset-to-table.ts src/formats/dataset-to-table.test.ts src/source/topology-source.ts src/source/topology-source.test.ts
git add -f docs/superpowers/verification/2026-06-17-geoparquet-crs-compat.md
git commit -m "Finish GeoParquet CRS compatibility" -m "This closes the CRS and metadata bridge needed for GDAL, DuckDB, and QGIS to consume browser-exported GeoParquet files. Export now preserves coordinates by default, resolves known EPSG CRS to PROJJSON, rejects present CRS labels that cannot be represented, writes bbox covering metadata, and stamps specification-implied WGS84 at import." -m "Constraint: GeoParquet CRS metadata must distinguish omitted CRS84, null unknown CRS, and explicit PROJJSON CRS" -m "Rejected: Reproject all exports to WGS84 by default | changes coordinates and surprises projected datasets" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: npm run test:run -- src/formats/geoparquet-metadata.test.ts src/formats/epsg-projjson.test.ts src/formats/dataset-to-table.test.ts src/formats/geoparquet-io.test.ts src/source/topology-source.test.ts" -m "Tested: npm run test:duckdb" -m "Tested: npm run typecheck" -m "Tested: npm run build" -m "Tested: npm pack --dry-run"
```

---

## Design Coverage Check

- Preserve source coordinates by default: Task 3 keeps strict CRS resolution separate from reprojection and does not change the default `reprojectToWgs84` behavior.
- Write full PROJJSON for known EPSG: Tasks 1 and 2 cover EPSG:3857 in-tree and EPSG:4490 through `@zwishing/epsg-index` assets.
- Fail known EPSG when PROJJSON cannot resolve: Tasks 1, 2, and 3 add unit and export-level rejection.
- Fail custom CRS labels in standard export: Tasks 1 and 3 cover the strict path.
- Keep missing source CRS representable as unknown: Task 1 keeps permissive `crs:null` behavior for low-level Arrow conversion.
- Write bbox covering by default: Task 4 covers default column, collision suffix, disabled covering, and null geometry row behavior.
- Keep GDAL-compatible Parquet field metadata: Task 5 verifies file-level `geo` metadata remains after field extension metadata is stripped.
- Stamp specification-implied WGS84 at import: Task 6 covers GeoJSON and Shapefile behavior plus preserving existing CRS metadata.
- External acceptance: Task 7 records GDAL, DuckDB, and QGIS commands and expected observations.
