// @vitest-environment jsdom
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { examplePublicHref, renderCatalog } from '../../packages/examples/src/catalog';

const expectedIds = [
  'getting-started/geojson-viewer',
  'getting-started/points',
  'getting-started/point-style',
  'getting-started/lines',
  'getting-started/polygons',
  'getting-started/polygon-fill',
  'getting-started/shapefile-viewer',
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
    expect(examplePublicHref('buffer')).toBe('/mapseekai/emap/examples/buffer/');
    expect(examplePublicHref('getting-started/points')).toBe(
      '/mapseekai/emap/examples/getting-started/points/',
    );
    expect(examplePublicHref('/buffer/')).toBe('/mapseekai/emap/examples/buffer/');
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
      expect(example.description.zh, `${example.id} exposes a source path`).not.toContain(
        'packages/examples/',
      );
      expect(example.description.en, `${example.id} exposes a source path`).not.toContain(
        'packages/examples/',
      );
      expect(example.learningGoals.zh, `${example.id} zh learning goals`).not.toHaveLength(0);
      expect(example.learningGoals.en, `${example.id} en learning goals`).not.toHaveLength(0);
      expect(example.docs.length, `${example.id} docs`).toBeGreaterThanOrEqual(1);
      expect(example.api, `${example.id} api`).toHaveLength(1);
      expect(example.tags, `${example.id} tags`).not.toHaveLength(0);
      expect(example.featureFlags, `${example.id} feature flags`).toBeDefined();
      expect(example.fixtures, `${example.id} fixtures`).toBeDefined();
      expect(example.success.trim(), `${example.id} success`).not.toBe('');
      expect(example.success, `${example.id} exposes a source path`).not.toContain(
        'packages/examples/',
      );
      expect(example.route).toBe(`/examples/${example.id}/`);
      expect(example).not.toHaveProperty('load');
      expect(example.source.html).toBe(`packages/examples/examples/${example.id}/index.html`);
    }

    expect(new Set(examples.map((example) => example.description.zh)).size).toBe(examples.length);
    expect(new Set(examples.map((example) => example.description.en)).size).toBe(examples.length);
  });

  it('preserves representative fixture and feature associations', () => {
    const byId = new Map(examples.map((example) => [example.id, example]));

    expect(byId.get('getting-started/points')?.fixtures).toEqual([
      'fixtures/task-7-polygons.geojson',
    ]);
    expect(byId.get('getting-started/point-style')?.fixtures).toEqual([
      'fixtures/getting-started-points.geojson',
    ]);
    expect(byId.get('getting-started/lines')?.fixtures).toEqual([
      'fixtures/getting-started-lines.geojson',
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

    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a.example-card'));
    expect(links).toHaveLength(examples.length);

    const hrefs = links.map((link) => link.getAttribute('href'));
    for (const example of examples) {
      expect(hrefs).toContain(`/mapseekai/emap/examples/${example.id}/`);
    }
    for (const link of links) {
      expect(link.getAttribute('href')).not.toContain('#');
    }
  });

  it('groups examples by category and filters from the category rail', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);

    expect(root.querySelectorAll('.catalog-category-button')).toHaveLength(11);
    expect(root.querySelectorAll('.catalog-group')).toHaveLength(10);
    expect(root.querySelectorAll('a.example-card')).toHaveLength(54);

    root.querySelector<HTMLButtonElement>('[data-category="data"]')?.click();

    expect(root.querySelectorAll('.catalog-group')).toHaveLength(1);
    expect(root.querySelector('.catalog-group-title')?.textContent).toBe('数据');
    expect(root.querySelectorAll('a.example-card')).toHaveLength(9);
    expect(root.querySelector('[data-category="data"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.catalog-results-summary')?.textContent).toContain('9');
  });

  it('searches localized text, ids, tags, and API identifiers', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);
    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');

    search.value = '自动缩放到全部要素范围';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      Array.from(root.querySelectorAll('.example-card-title'), ({ textContent }) => textContent),
    ).toEqual(['GeoJSON 查看器']);

    search.value = '  topologySOURCE.FROMbytes  ';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      Array.from(root.querySelectorAll('.example-card-title'), ({ textContent }) => textContent),
    ).toEqual(['GeoParquet / GeoArrow 查看器', '导出 GeoParquet / GeoArrow', '导出往返']);

    search.value = 'getting-started/lines';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(1);

    search.value = 'box-select';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(2);

    const language = root.querySelector<HTMLSelectElement>('.catalog-language select');
    if (!language) throw new Error('Catalog language selector was not rendered');
    language.value = 'en';
    language.dispatchEvent(new Event('change'));
    const englishSearch = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!englishSearch) throw new Error('English catalog search was not rendered');
    englishSearch.value = 'immediately reimports a dataset';
    englishSearch.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      Array.from(root.querySelectorAll('.example-card-title'), ({ textContent }) => textContent),
    ).toEqual(['Export roundtrip']);
  });

  it('combines filters, clears search, and renders an empty result', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);
    root.querySelector<HTMLButtonElement>('[data-category="data"]')?.click();
    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');

    search.value = 'TopologySource.fromBytes';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(3);

    search.value = 'no-such-example';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.catalog-empty')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.catalog-empty-clear')?.click();
    expect(root.querySelectorAll('a.example-card')).toHaveLength(9);
    expect(root.querySelector<HTMLInputElement>('.catalog-search-input')?.value).toBe('');
  });

  it('preserves control focus and the live result region across catalog updates', () => {
    const root = document.createElement('div');
    document.body.append(root);

    try {
      renderCatalog(root, examples);
      const dataButton = root.querySelector<HTMLButtonElement>('[data-category="data"]');
      if (!dataButton) throw new Error('Data category button was not rendered');
      dataButton.focus();
      dataButton.click();

      expect(document.activeElement).toBe(
        root.querySelector<HTMLButtonElement>('[data-category="data"]'),
      );

      const liveRegion = root.querySelector('.catalog-results-summary');
      const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
      if (!search) throw new Error('Catalog search was not rendered');
      search.value = 'TopologySource.fromBytes';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(root.querySelector('.catalog-results-summary')).toBe(liveRegion);

      const language = root.querySelector<HTMLSelectElement>('.catalog-language select');
      if (!language) throw new Error('Catalog language selector was not rendered');
      language.focus();
      language.value = 'en';
      language.dispatchEvent(new Event('change'));
      expect(document.activeElement).toBe(
        root.querySelector<HTMLSelectElement>('.catalog-language select'),
      );
    } finally {
      root.remove();
    }
  });

  it('renders the technical catalog shell and compact card metadata', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);

    expect(document.body.classList.contains('catalog-root')).toBe(true);
    expect(root.querySelector('.catalog-brand img')?.getAttribute('src')).toBe(
      '/mapseekai/emap/examples/emap.svg',
    );
    expect(root.querySelector('.catalog-total-count')?.textContent).toContain('54');

    const firstCard = root.querySelector<HTMLAnchorElement>(
      'a.example-card[href="/mapseekai/emap/examples/getting-started/geojson-viewer/"]',
    );
    expect(firstCard?.querySelector('.example-api-chip')?.textContent).toBe('Emap');
    expect(firstCard?.querySelector('.example-card-arrow')?.getAttribute('aria-hidden')).toBe(
      'true',
    );

    const mobileCategory = root.querySelector<HTMLSelectElement>('.catalog-mobile-category select');
    expect(mobileCategory?.options).toHaveLength(11);
    if (!mobileCategory) throw new Error('Mobile category selector was not rendered');
    mobileCategory.value = 'duckdb';
    mobileCategory.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(5);
  });

  it('defaults to Chinese and switches the complete catalog to English', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);

    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('Emap 文档示例');
    expect(root.querySelector('h1')?.textContent).toBe('Emap 文档示例');
    expect(root.querySelector('.example-card-title')?.textContent).toBe(examples[0].title.zh);
    expect(root.querySelector('.example-description')?.textContent).toBe(
      examples[0].description.zh,
    );
    expect(root.querySelector('a.example-card')?.getAttribute('aria-label')).toBe(
      `打开示例：${examples[0].title.zh}`,
    );
    expect(root.textContent).not.toContain('packages/examples/');

    const language = root.querySelector<HTMLSelectElement>('.catalog-language select');
    expect(language?.value).toBe('zh');
    if (!language) throw new Error('Catalog language selector was not rendered');
    language.value = 'en';
    language.dispatchEvent(new Event('change'));

    expect(document.documentElement.lang).toBe('en');
    expect(root.querySelector('.example-card-title')?.textContent).toBe(examples[0].title.en);
    expect(root.querySelector('.example-description')?.textContent).toBe(
      examples[0].description.en,
    );
    expect(document.title).toBe('Emap Documentation Example');
    expect(root.querySelector('h1')?.textContent).toBe('Emap Documentation Example');
    expect(root.querySelector('a.example-card')?.getAttribute('aria-label')).toBe(
      `Open example: ${examples[0].title.en}`,
    );
    expect(root.textContent).not.toContain('packages/examples/');
  });

  it('preserves the selected category and query when switching locale', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);
    root.querySelector<HTMLButtonElement>('[data-category="data"]')?.click();

    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');
    search.value = 'export';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const language = root.querySelector<HTMLSelectElement>('.catalog-language select');
    if (!language) throw new Error('Catalog language selector was not rendered');
    language.value = 'en';
    language.dispatchEvent(new Event('change'));

    expect(root.querySelector<HTMLInputElement>('.catalog-search-input')?.value).toBe('export');
    expect(root.querySelector('[data-category="data"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(
      Array.from(root.querySelectorAll('.example-card-title'), ({ textContent }) => textContent),
    ).toEqual(['Export GeoParquet / GeoArrow', 'Export roundtrip']);
  });

  it('ships one canonical runnable HTML page for every metadata entry', async () => {
    for (const example of examples) {
      const htmlPath = resolve(example.source.html);
      await expect(access(htmlPath), `${example.id} HTML exists`).resolves.toBeUndefined();
      const html = await readFile(htmlPath, 'utf8');
      const parsed = new DOMParser().parseFromString(html, 'text/html');

      expect(html, `${example.id} has a map surface`).toContain('id="map"');
      expect(parsed.querySelector('#header'), `${example.id} has a top banner`).not.toBeNull();
      expect(
        parsed.querySelector('#header > .emap-example-banner-brand'),
        `${example.id} places its emap brand first in the banner`,
      ).toBe(parsed.querySelector('#header')?.firstElementChild);
      expect(
        parsed
          .querySelector<HTMLImageElement>('.emap-example-banner-brand img')
          ?.getAttribute('src'),
        `${example.id} uses the canonical emap brand asset`,
      ).toBe('/mapseekai/emap/examples/emap.svg');
      expect(html, `${example.id} installs the shared map UI`).toContain('installExampleMapUi(map');
      expect(html, `${example.id} keeps a user upload`).toMatch(/type=["']file["']/);
      expect(html, `${example.id} avoids source-tree assets`).not.toMatch(
        /\.\.\/\.\.\/(?:dist|src)\//,
      );
      expect(html, `${example.id} uses local starter data`).not.toContain('https://geojson.cn/');
    }
  });

  it('keeps the Shapefile viewer map-first with one banner and one floating workbench', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/getting-started/shapefile-viewer/index.html'),
      'utf8',
    );
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const workbench = parsed.querySelector('body > details.shp-workbench.panel');

    expect(parsed.body.classList.contains('emap-example-with-floating-header')).toBe(true);
    expect(parsed.querySelectorAll('header, #header')).toHaveLength(1);
    expect(parsed.querySelector('body > #header')).not.toBeNull();
    expect(parsed.querySelector('body > #map')).not.toBeNull();
    expect(workbench?.hasAttribute('open')).toBe(true);
    expect(workbench?.querySelector('#shp-load-form')).not.toBeNull();
    expect(workbench?.querySelector('#shp-metadata')).not.toBeNull();
    expect(parsed.querySelector('.shp-page, .shp-topbar, .shp-content, .shp-workspace')).toBeNull();
  });

  it('exposes live line color, width, and dash controls', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/getting-started/lines/index.html'),
      'utf8',
    );
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const dashValues = Array.from(
      parsed.querySelectorAll<HTMLOptionElement>('#line-dash option'),
      ({ value }) => value,
    );

    expect(parsed.querySelector('#line-color')).not.toBeNull();
    expect(parsed.querySelector('#line-width')).not.toBeNull();
    expect(dashValues).toEqual(['', '8,4', '2,4', '12,4,3,4', 'arrow-dot']);
    expect(html).toContain("updatePaint('line-dasharray', currentDash())");
    expect(html).toContain("updatePaint('line-dashstyle', currentDashStyle())");
    expect(parsed.querySelector('#arrow-spacing')).not.toBeNull();
    expect(parsed.querySelector('#arrow-size')).not.toBeNull();
  });

  it('removes the draw-snap display layer before replacing uploaded source data', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/draw-snap-clear/index.html'),
      'utf8',
    );

    expect(html).toMatch(
      /getLayer\('reference-line'\)[\s\S]*removeLayer\('reference-line'\)[\s\S]*removeSource\(SOURCE_ID\)/,
    );
  });
});
