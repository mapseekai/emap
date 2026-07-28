// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { examplePublicHref, renderCatalog } from '../../packages/examples/src/catalog';

const expectedIds = [
  'getting-started/geojson-viewer',
  'getting-started/points',
  'getting-started/lines',
  'getting-started/polygons',
  'getting-started/polygon-fill',
  'attribute-editing',
  'attribute-expressions',
  'data-engineering',
  'feature-attributes',
  'filter-features',
  'geoparquet-viewer',
  'export-geoparquet',
  'export-roundtrip',
  'join',
  'merge-layers',
  'merge-selected',
  'rename-layer',
  'split-layer',
  'interaction-handlers',
  'feature-selection',
  'box-select',
  'lasso-select',
  'china-editing',
  'draw-snap-clear',
  'draw-snap-edge',
  'feature-rotate-scale',
  'feature-translate',
  'snapshot',
  'transaction',
  'undo-redo',
  'vertex-editing',
  'buffer',
  'check-geometry',
  'clip-erase',
  'dissolve',
  'divide',
  'explode',
  'innerlines',
  'mosaic',
  'project',
  'rebuild-topology',
  'simplify-control',
  'simplify',
  'snap-layer',
  'union',
  'crs-switch',
  'web-worker',
  'duckdb-buffer',
  'duckdb-geoparquet-query',
  'duckdb-overlay',
  'duckdb-query',
  'duckdb-spatial-ops',
] as const;

describe('example catalog metadata', () => {
  it('builds stable public hrefs for flat and nested IDs', () => {
    expect(examplePublicHref('buffer')).toBe('/emap/examples/buffer/');
    expect(examplePublicHref('getting-started/points')).toBe(
      '/emap/examples/getting-started/points/',
    );
    expect(examplePublicHref('/buffer/')).toBe('/emap/examples/buffer/');
  });

  it('defines the complete metadata-only catalog', () => {
    expect(examples.map(({ id }) => id)).toEqual(expectedIds);

    const ids = new Set<string>();
    for (const example of examples) {
      expect(ids.has(example.id), `${example.id} is duplicated`).toBe(false);
      ids.add(example.id);

      expect(example.title.zh.trim(), `${example.id} is missing zh title`).not.toBe('');
      expect(example.title.en.trim(), `${example.id} is missing en title`).not.toBe('');
      expect(example.description.zh.trim(), `${example.id} is missing zh description`).not.toBe('');
      expect(example.description.en.trim(), `${example.id} is missing en description`).not.toBe('');
      expect(example.learningGoals.zh, `${example.id} zh learning goals`).not.toHaveLength(0);
      expect(example.learningGoals.en, `${example.id} en learning goals`).not.toHaveLength(0);
      expect(example.docs.length, `${example.id} docs`).toBeGreaterThanOrEqual(1);
      expect(example.api, `${example.id} api`).toHaveLength(1);
      expect(example.tags, `${example.id} tags`).not.toHaveLength(0);
      expect(example.featureFlags, `${example.id} feature flags`).toBeDefined();
      expect(example.fixtures, `${example.id} fixtures`).toBeDefined();
      expect(example.success.trim(), `${example.id} success`).not.toBe('');
      expect(example.route).toBe(`/examples/${example.id}/`);
      expect(example).not.toHaveProperty('load');
      expect(example.source.html).toBe(`packages/examples/examples/${example.id}/index.html`);
    }
  });

  it('preserves representative fixture and feature associations', () => {
    const byId = new Map(examples.map((example) => [example.id, example]));

    expect(byId.get('getting-started/points')?.fixtures).toEqual([
      'fixtures/getting-started-points.geojson',
    ]);
    expect(byId.get('join')?.fixtures).toEqual([
      'fixtures/task-6-polygons.geojson',
      'fixtures/task-6-join.csv',
    ]);
    expect(byId.get('merge-layers')?.fixtures).toEqual([
      'fixtures/task-6-polygons.geojson',
      'fixtures/task-6-polygons-alt.geojson',
    ]);
    expect(byId.get('clip-erase')?.fixtures).toEqual([
      'fixtures/task-7-polygons.geojson',
      'fixtures/task-7-mask.geojson',
    ]);
    expect(byId.get('geoparquet-viewer')?.fixtures).toEqual([
      'fixtures/example-geoparquet.parquet',
    ]);
    expect(byId.get('duckdb-geoparquet-query')?.fixtures).toEqual([
      'fixtures/example-geoparquet.parquet',
    ]);
    expect(byId.get('web-worker')?.featureFlags).toContain('worker');
    expect(byId.get('geoparquet-viewer')?.featureFlags).toContain('formats');
  });

  it('renders catalog cards as direct public routes without hashes', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);

    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.primary-link'));
    expect(links).toHaveLength(examples.length);

    for (const [index, link] of links.entries()) {
      expect(link.getAttribute('href')).toBe(`/emap/examples/${examples[index].id}/`);
      expect(link.getAttribute('href')).not.toContain('#');
    }
  });
});
