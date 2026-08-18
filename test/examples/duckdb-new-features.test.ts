import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../packages/examples/vite.config';

const duckDbBundle = readFileSync(resolve(__dirname, '../../dist/emap-duckdb.mjs'), 'utf8');
const duckDbExamples = [
  readExample('duckdb-buffer'),
  readExample('duckdb-geoparquet-query'),
  readExample('duckdb-overlay'),
  readExample('duckdb-query'),
  readExample('duckdb-spatial-aggregate-join'),
];
const duckDbSpatialRunner = readFileSync(
  resolve(__dirname, '../../packages/examples/src/duckdb-spatial-example.ts'),
  'utf8',
);
const geoParquetExamples = [readExample('export-formats'), readExample('geoparquet-viewer')];

function readExample(id: string): string {
  return readFileSync(
    resolve(__dirname, `../../packages/examples/examples/${id}/index.html`),
    'utf8',
  );
}

function importedDuckDbNames(source: string): string[] {
  const importMatch = source.match(/import\s+\{([^}]+)\}\s+from\s+["']@mapseekai\/emap\/duckdb["']/);
  if (!importMatch) throw new Error('DuckDB module import not found');
  return importMatch[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.split(/\s+as\s+/)[0].trim());
}

function exportedDuckDbNames(): Set<string> {
  const exportMatches = [...duckDbBundle.matchAll(/export\s*\{([^}]+)\}/g)];
  const exportMatch = exportMatches.at(-1);
  if (!exportMatch) throw new Error('DuckDB module export list not found');
  return new Set(
    exportMatch[1]
      .split(',')
      .map(
        (name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .at(-1)
            ?.trim() ?? '',
      )
      .filter(Boolean),
  );
}

const freshnessGuard = /if\s*\(\s*!isCurrent\(\)\s*\)\s*return\s+undefined\s*;/g;

function hasFreshnessGuardBetween(source: string, after: number, before: number): boolean {
  return [...source.matchAll(freshnessGuard)].some((match) => {
    const index = match.index ?? -1;
    return index > after && index < before;
  });
}

function removeFreshnessGuardBetween(source: string, after: number, before: number): string {
  return source.replace(freshnessGuard, (match, index: number) =>
    index > after && index < before ? '' : match,
  );
}

function hasInputRunInvalidationBeforeLoad(source: string): boolean {
  const invalidation = source.indexOf('invalidateAggregateRuns();');
  const load = source.indexOf('await loadDatasetFromFile(');
  return invalidation > -1 && load > invalidation;
}

function hasIdentityAwareOutputCleanup(source: string): boolean {
  const mapAdd = source.indexOf('await map.addSource(OUTPUT_SOURCE_ID, source);');
  const cleanup = source.indexOf('map.getSource(OUTPUT_SOURCE_ID) === source');
  return mapAdd > -1 && cleanup > mapAdd;
}

function hasIdentityAwareContextDiscard(source: string): boolean {
  return source.includes('contextSources.get(OUTPUT_SOURCE_ID)?.getDataset?.() === dataset');
}

function scopedBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing source marker: ${marker}`);
  const open = source.indexOf('{', markerIndex);
  if (open < 0) throw new Error(`Missing opening brace after: ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(markerIndex, index + 1);
  }
  throw new Error(`Unclosed block after: ${marker}`);
}

function usesAggregateQueryCoordinator(runHandler: string): boolean {
  const options = scopedBlock(runHandler, 'await runCoordinator.run(');
  const outsideCoordinator = runHandler.replace(options, '');
  return (
    options.includes('execute: executeAggregateQuery') &&
    options.includes('register: registerAggregateOutput') &&
    !outsideCoordinator.includes('executeAggregateQuery(') &&
    !outsideCoordinator.includes('registerAggregateOutput(') &&
    !outsideCoordinator.includes('duckDbSpatialAggregateJoinLayer(') &&
    !outsideCoordinator.includes('spatialAggregateJoinDatasetWithDuckDb(')
  );
}


  it('registers only the two split distance routes in the Vite build inputs', () => {
    const input = viteConfig.build?.rollupOptions?.input;
    if (!input || Array.isArray(input) || typeof input === 'string') {
      throw new Error('Expected keyed example build inputs');
    }

    expect(Object.keys(input)).toEqual(
      expect.arrayContaining([
        'examples/duckdb/relation/distance/index',
        'examples/duckdb/relation/distance-within/index',
      ]),
    );
    expect(Object.keys(input)).not.toContain('examples/duckdb-spatial-ops/index');
  });
describe('DuckDB new feature examples', () => {
  const examples = {
    geoparquetQuery: readExample('duckdb-geoparquet-query'),
    overlay: readExample('duckdb-overlay'),
    query: readExample('duckdb-query'),
    spatialAggregateJoin: readExample('duckdb-spatial-aggregate-join'),
  };

  it('lets Vite resolve DuckDB and Arrow dependencies', () => {
    for (const html of duckDbExamples) {
      expect(html).toContain("from '@mapseekai/emap/duckdb'");
      expect(html).not.toContain('<script type="importmap">');
      expect(html).not.toContain('Arrow.dom.mjs');
    }
  });

  it('initializes formats and parquet-wasm through the Vite-managed module', () => {
    for (const html of geoParquetExamples) {
      expect(html).toContain('loadExampleArrow');
      expect(html).toContain('await emapArrow.initParquetWasm()');
      expect(html).not.toContain('parquet-wasm@');
      expect(html).not.toContain('emap-arrow.js');
    }
  });

  it('imports only exported DuckDB browser module names', () => {
    const exported = exportedDuckDbNames();
    for (const [name, html] of Object.entries(examples)) {
      for (const importedName of importedDuckDbNames(html)) {
        expect(exported.has(importedName), `${name}: ${importedName} is not exported`).toBe(true);
      }
    }
    for (const importedName of importedDuckDbNames(duckDbSpatialRunner)) {
      expect(exported.has(importedName), `duckdb spatial runner: ${importedName} is not exported`).toBe(true);
    }
  });

  it('covers restricted dataset SELECT helper and map-op entrypoints', () => {
    const html = examples.query;
    expect(html).toContain('queryDatasetWithDuckDb');
    expect(html).toContain('duckDbQueryLayer');
    expect(html).toContain('validateDuckDbSelectSql');
    expect(html).toContain('SELECT * FROM input LIMIT 50');
    expect(html).toContain('src: SOURCE_ID');
    expect(html).toContain('output: { sourceId: OUTPUT_ID }');
  });

  it('covers GeoParquet query source and map-op entrypoints', () => {
    const html = examples.geoparquetQuery;
    expect(html).toContain('createDuckDbGeoParquetQuerySource');
    expect(html).toContain('DuckDbGeoParquetQuerySource.query');
    expect(html).toContain('duckDbGeoParquetQueryLayer');
    expect(html).toContain('getGeoParquetQuerySource: () => geoParquetQuerySource');
    expect(html).toContain('resultDataset = await querySource.query(opts)');
    expect(html).toContain('SELECT * FROM input LIMIT 100');
    expect(html).toContain('id="geometry-column" type="text" placeholder="留空自动检测"');
    expect(html).toContain('geometryColumn: geometryColumnInput.value.trim() || undefined');
    expect(html).toContain('output: { sourceId: OUTPUT_ID }');
  });

  it('queries and renders GeoParquet after fixture injection or a user upload', () => {
    const html = examples.geoparquetQuery;
    const queryStart = html.indexOf('async function runGeoParquetQuery()');
    const changeStart = html.indexOf('fileInput.addEventListener("change"');
    const buttonStart = html.indexOf('runButton.addEventListener("click"');

    expect(queryStart).toBeGreaterThan(-1);
    expect(changeStart).toBeGreaterThan(queryStart);
    expect(buttonStart).toBeGreaterThan(changeStart);
    expect(html.slice(queryStart, changeStart)).toContain(
      'const outputSource = await addDatasetSource(OUTPUT_ID, resultDataset)',
    );
    expect(html.slice(queryStart, changeStart)).toContain(
      'map.setExtent(outputSource.getExtent())',
    );
    expect(html.slice(changeStart, buttonStart)).toContain('await runGeoParquetQuery()');
    expect(html).toContain('runButton.addEventListener("click", runGeoParquetQuery)');
  });

  it('covers overlay helper and map-op entrypoints', () => {
    const html = examples.overlay;
    expect(html).toContain('intersectionDatasetWithDuckDb');
    expect(html).toContain('differenceDatasetWithDuckDb');
    expect(html).toContain('duckDbOverlayLayer');
    expect(html).toContain('<option value="intersection">intersectionDatasetWithDuckDb</option>');
    expect(html).toContain('<option value="difference">differenceDatasetWithDuckDb</option>');
    expect(html).toContain('function clearOverlayOutput()');
    expect(html).toContain('contextSources.delete(OUTPUT_SOURCE_ID)');
    expect(html).toContain('src: INPUT_SOURCE_ID');
    expect(html).toContain('mask: MASK_SOURCE_ID');
    expect(html).toContain('output: { sourceId: OUTPUT_SOURCE_ID }');
  });

  it('covers spatial aggregate join helper and map-op entrypoints', () => {
    const html = examples.spatialAggregateJoin;
    expect(html).toContain('spatialAggregateJoinDatasetWithDuckDb');
    expect(html).toContain('duckDbSpatialAggregateJoinLayer');
    expect(html).toContain("predicate: 'contains'");
    expect(html).toContain('<option value="left">left</option>');
    expect(html).toContain('<option value="inner">inner</option>');
    for (const descriptor of [
      '{ operation: "count", outputColumn: "match_count" }',
      '{ operation: "sum", field: "sales", outputColumn: "sales_total" }',
      '{ operation: "avg", field: "score", outputColumn: "score_avg" }',
      '{ operation: "min", field: "sales", outputColumn: "sales_min" }',
      '{ operation: "max", field: "sales", outputColumn: "sales_max" }',
    ]) {
      expect(html).toContain(descriptor);
    }
    expect(html).toContain('targetLayer: Number(targetLayerSelect.value)');
    expect(html).toContain('joinLayer: Number(joinLayerSelect.value)');
    expect(html).toContain('src: TARGET_SOURCE_ID');
    expect(html).toContain('join: JOIN_SOURCE_ID');
    expect(html).toContain('output: { sourceId: OUTPUT_SOURCE_ID }');
  });

  it('renders the aggregate join result and reports all five outputs', () => {
    const html = examples.spatialAggregateJoin;
    expect(html).toContain('async function registerAggregateOutput(dataset, isCurrent)');
    expect(html).toContain('map.setExtent(registration.source.getExtent())');
    for (const column of ['match_count', 'sales_total', 'score_avg', 'sales_min', 'sales_max']) {
      expect(html).toContain(column);
    }
  });

  it('keeps aggregate controls safe while both inputs load and fits their combined extent', () => {
    const html = examples.spatialAggregateJoin;
    const targetHandler = html.indexOf("targetFile.addEventListener('change'");
    const joinHandler = html.indexOf("joinFile.addEventListener('change'");
    const runHandler = html.indexOf("runButton.addEventListener('click'");
    const loaderStart = html.indexOf('async function loadDatasetFromFile');

    expect(html).toContain('<p id="status" class="emap-example-status" aria-live="polite">');
    expect(html).toContain('function fitLoadedExtents()');
    expect(html).toContain('const extent = targetExtent.clone();');
    expect(html).toContain('extent.merge(joinExtent);');
    expect(html).toContain('map.setExtent(extent);');
    expect(targetHandler).toBeGreaterThan(-1);
    expect(joinHandler).toBeGreaterThan(targetHandler);
    expect(runHandler).toBeGreaterThan(joinHandler);
    expect(loaderStart).toBeGreaterThan(-1);
    expect(html.slice(targetHandler, joinHandler)).toContain('targetDataset = undefined;');
    expect(html.slice(targetHandler, joinHandler)).toContain(
      'const loadVersion = ++targetLoadVersion;',
    );
    expect(html.slice(targetHandler, joinHandler)).toContain(
      'if (loadVersion !== targetLoadVersion) return;',
    );
    expect(html.slice(targetHandler, joinHandler)).toContain('updateRunState();');
    expect(html.slice(joinHandler, runHandler)).toContain('joinDataset = undefined;');
    expect(html.slice(joinHandler, runHandler)).toContain('const loadVersion = ++joinLoadVersion;');
    expect(html.slice(joinHandler, runHandler)).toContain(
      'if (loadVersion !== joinLoadVersion) return;',
    );
    expect(html.slice(joinHandler, runHandler)).toContain('updateRunState();');

    const loader = html.slice(loaderStart, targetHandler);
    const arrayBufferAwait = loader.indexOf('await file.arrayBuffer()');
    const sourceRemoval = loader.indexOf('removeSourceWithLayers(sourceId);');
    const setDataAwait = loader.indexOf('await source.setData(');
    const datasetRead = loader.indexOf('const dataset = source.getDataset();');

    expect(arrayBufferAwait).toBeGreaterThan(-1);
    expect(sourceRemoval).toBeGreaterThan(arrayBufferAwait);
    expect(setDataAwait).toBeGreaterThan(sourceRemoval);
    expect(datasetRead).toBeGreaterThan(setDataAwait);
    expect(hasFreshnessGuardBetween(loader, arrayBufferAwait, sourceRemoval)).toBe(true);
    expect(hasFreshnessGuardBetween(loader, setDataAwait, datasetRead)).toBe(true);
    expect(
      hasFreshnessGuardBetween(
        removeFreshnessGuardBetween(loader, arrayBufferAwait, sourceRemoval),
        arrayBufferAwait,
        sourceRemoval,
      ),
    ).toBe(false);
    expect(
      hasFreshnessGuardBetween(
        removeFreshnessGuardBetween(loader, setDataAwait, datasetRead),
        setDataAwait,
        datasetRead,
      ),
    ).toBe(false);
  });

  it('routes both aggregate query entrypoints through the shared stale-run coordinator', () => {
    const html = examples.spatialAggregateJoin;
    const targetHandlerStart = html.indexOf("targetFile.addEventListener('change'");
    const joinHandlerStart = html.indexOf("joinFile.addEventListener('change'");
    const runHandlerStart = html.indexOf("runButton.addEventListener('click'");
    const targetHandler = html.slice(targetHandlerStart, joinHandlerStart);
    const joinHandler = html.slice(joinHandlerStart, runHandlerStart);
    const runHandler = scopedBlock(html, "runButton.addEventListener('click'");
    const coordinatorOptions = scopedBlock(runHandler, 'await runCoordinator.run(');
    const queryExecutor = scopedBlock(html, 'async function executeAggregateQuery');
    const removeOutput = scopedBlock(html, 'function removeSourceWithLayers');
    const registrationStart = html.indexOf('async function registerAggregateOutput');
    const registrationEnd = html.indexOf('function populateLayerSelect', registrationStart);
    const registration = html.slice(registrationStart, registrationEnd);

    expect(html).toContain("from '/src/duckdb-spatial-aggregate-run-coordinator.ts'");
    expect(html).toContain('const runCoordinator = createDuckDbSpatialAggregateRunCoordinator(');
    expect(html).toContain('removeDuckDbSpatialAggregateSource');
    expect(hasInputRunInvalidationBeforeLoad(targetHandler)).toBe(true);
    expect(hasInputRunInvalidationBeforeLoad(joinHandler)).toBe(true);
    expect(hasIdentityAwareOutputCleanup(registration)).toBe(true);
    expect(hasIdentityAwareContextDiscard(runHandler)).toBe(true);
    expect(removeOutput).toContain('removeDuckDbSpatialAggregateSource(map, id);');
    expect(
      hasInputRunInvalidationBeforeLoad(targetHandler.replace('invalidateAggregateRuns();', '')),
    ).toBe(false);
    expect(
      hasIdentityAwareOutputCleanup(
        registration.replace('map.getSource(OUTPUT_SOURCE_ID) === source', 'true'),
      ),
    ).toBe(false);
    expect(
      hasIdentityAwareContextDiscard(
        runHandler.replace(
          'contextSources.get(OUTPUT_SOURCE_ID)?.getDataset?.() === dataset',
          'true',
        ),
      ),
    ).toBe(false);
    expect(usesAggregateQueryCoordinator(runHandler)).toBe(true);
    expect(coordinatorOptions).toContain('discardResult(dataset)');
    expect(coordinatorOptions).toContain('publish({ dataset, registration })');
    expect(coordinatorOptions).toContain('publishError(err)');
    expect(coordinatorOptions).toContain('finish: updateRunState');
    expect(queryExecutor).toContain('runMapOp: () => duckDbSpatialAggregateJoinLayer(');
    expect(queryExecutor).toContain('runHelper: () => spatialAggregateJoinDatasetWithDuckDb(');
    expect(queryExecutor).not.toContain('await runCoordinator.run(');
    expect(
      usesAggregateQueryCoordinator(
        runHandler.replace('execute: executeAggregateQuery', 'execute: runQueryOutsideCoordinator'),
      ),
    ).toBe(false);
    expect(
      usesAggregateQueryCoordinator(
        runHandler.replace(
          'register: registerAggregateOutput',
          'register: runQueryOutsideCoordinator',
        ),
      ),
    ).toBe(false);
    for (const bypassedEntrypoint of [
      'await spatialAggregateJoinDatasetWithDuckDb();',
      'await duckDbSpatialAggregateJoinLayer();',
    ]) {
      expect(
        usesAggregateQueryCoordinator(
          runHandler.replace(
            'await runCoordinator.run(',
            `${bypassedEntrypoint}\n        await runCoordinator.run(`,
          ),
        ),
      ).toBe(false);
    }
  });
});
