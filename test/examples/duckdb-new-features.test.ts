import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const duckDbBundle = readFileSync(resolve(__dirname, '../../dist/emap-duckdb.mjs'), 'utf8');

function readExample(name: string): string {
  return readFileSync(resolve(__dirname, name), 'utf8');
}

function importedDuckDbNames(html: string): string[] {
  const importMatch = html.match(
    /import\s+\{([\s\S]*?)\}\s+from\s+["']..\/..\/dist\/emap-duckdb\.mjs["']/,
  );
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
    geoparquetQuery: readExample('duckdb-geoparquet-query.html'),
    overlay: readExample('duckdb-overlay.html'),
    query: readExample('duckdb-query.html'),
  };

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

  it('covers GeoParquet byte SELECT helper and map-op entrypoints', () => {
    const html = examples.geoparquetQuery;
    expect(html).toContain('queryGeoParquetWithDuckDb');
    expect(html).toContain('duckDbGeoParquetQueryLayer');
    expect(html).toContain('getBytes: () => geoParquetBytes');
    expect(html).toContain('SELECT * FROM input LIMIT 100');
    expect(html).toContain('id="geometry-column" type="text" placeholder="留空自动检测"');
    expect(html).toContain('geometryColumn: geometryColumnInput.value.trim() || undefined');
    expect(html).toContain('output: { sourceId: OUTPUT_ID }');
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
