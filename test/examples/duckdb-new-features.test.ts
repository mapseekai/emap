import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const duckDbBundle = readFileSync(resolve(__dirname, '../../dist/emap-duckdb.mjs'), 'utf8');
const duckDbExamples = [
  readExample('duckdb-buffer'),
  readExample('duckdb-geoparquet-query'),
  readExample('duckdb-overlay'),
  readExample('duckdb-query'),
  readExample('duckdb-spatial-ops'),
];
const geoParquetExamples = [readExample('export-geoparquet'), readExample('geoparquet-viewer')];

function readExample(id: string): string {
  return readFileSync(
    resolve(__dirname, `../../packages/examples/examples/${id}/index.html`),
    'utf8',
  );
}

function importedDuckDbNames(html: string): string[] {
  const importMatch = html.match(/import\s+\{([^}]+)\}\s+from\s+["']@mapseekai\/emap\/duckdb["']/);
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

describe('DuckDB new feature examples', () => {
  const examples = {
    geoparquetQuery: readExample('duckdb-geoparquet-query'),
    overlay: readExample('duckdb-overlay'),
    query: readExample('duckdb-query'),
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
});
