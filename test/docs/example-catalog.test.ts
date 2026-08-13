// @vitest-environment jsdom
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { examplePublicHref, renderCatalog } from '../../packages/examples/src/catalog';

const expectedIds = [
  'getting-started/geojson-viewer',
  'getting-started/shapefile-viewer',
  'geoparquet-viewer',
  'flatgeobuf-viewer',
  'join',
  'rename-layer',
  'split-layer',
  'merge-layers',
  'export-geoparquet',
  'export-roundtrip',
  'crs-switch',
  'online-map-services',
  'project',
  'web-worker',
  'getting-started/point-style',
  'getting-started/lines',
  'getting-started/polygon-fill',
  'interaction-handlers',
  'feature-attributes',
  'feature-selection',
  'box-select',
  'lasso-select',
  'attribute-editing',
  'undo-redo',
  'attribute-expressions',
  'filter-features',
  'data-engineering',
  'merge-selected',
  'vertex-editing',
  'feature-translate',
  'feature-rotate-scale',
  'draw-snap-clear',
  'draw-snap-edge',
  'china-editing',
  'transaction',
  'snapshot',
  'getting-started/points',
  'getting-started/polygons',
  'explode',
  'buffer',
  'simplify',
  'simplify-control',
  'dissolve',
  'innerlines',
  'union',
  'clip-erase',
  'divide',
  'snap-layer',
  'mosaic',
  'check-geometry',
  'rebuild-topology',
  'duckdb-query',
  'duckdb-geoparquet-query',
  'duckdb-buffer',
  'duckdb-overlay',
  'duckdb-spatial-aggregate-join',
  'duckdb-spatial-ops',
] as const;

const expectedModules = [
  { key: 'map-data', zh: '地图与数据', en: 'Map & Data', count: 14 },
  {
    key: 'style-interaction',
    zh: '样式与交互',
    en: 'Styling & Interaction',
    count: 8,
  },
  { key: 'data-editing', zh: '数据编辑', en: 'Data Editing', count: 14 },
  { key: 'data-analysis', zh: '数据分析', en: 'Data Analysis', count: 21 },
] as const;

async function executeOnlineMapServicesExample(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const moduleScript = parsed.querySelector<HTMLScriptElement>('script[type="module"]');
  if (!moduleScript?.textContent) throw new Error('online-map-services module script is missing');

  const script = moduleScript.textContent.replace(
    /^\s*import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*$/gm,
    '',
  );
  const originalHead = document.head.innerHTML;
  const originalBody = document.body.innerHTML;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;

  const constructorOptions: unknown[] = [];
  const maps: FakeEmap[] = [];
  const controls: unknown[] = [];
  const layers: Array<Record<string, unknown>> = [];
  const sharedUiCalls: Array<{ map: unknown; runtime: unknown }> = [];
  const fixtureRequests: string[] = [];

  class FakeLayerControl {}
  class FakeNavigationControl {}
  class FakeTopologySource {
    public readonly id: string;

    public constructor(id: string) {
      this.id = id;
    }

    public async setData(): Promise<void> {}

    public getExtent(): [number, number, number, number] {
      return [-10, -10, 10, 10];
    }
  }
  class FakeEmap {
    public constructor(options: unknown) {
      constructorOptions.push(options);
      maps.push(this);
    }

    public addControl(control: unknown): void {
      controls.push(control);
    }

    public async addSource(): Promise<void> {}

    public addLayer(layer: Record<string, unknown>): void {
      layers.push(layer);
    }

    public setExtent(): void {}

    public resize(): void {}
  }

  const runtime = {
    Emap: FakeEmap,
    LayerControl: FakeLayerControl,
    NavigationControl: FakeNavigationControl,
    TopologySource: FakeTopologySource,
  };
  const installExampleMapUi = (map: unknown, suppliedRuntime: unknown): void => {
    sharedUiCalls.push({ map, runtime: suppliedRuntime });
  };
  const autoLoadExampleFixtures = async (id: string): Promise<void> => {
    fixtureRequests.push(id);
    const input = document.querySelector<HTMLInputElement>('#file-input');
    if (!input) throw new Error('online-map-services #file-input is missing');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ name: 'task-6-polygons.geojson', arrayBuffer: async () => new ArrayBuffer(0) }],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const loadExampleRuntime = async () => runtime;
  const fakeWindow = { addEventListener: vi.fn() };
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('online-map-services example must not use network in tests'));

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(
      'installExampleMapUi',
      'autoLoadExampleFixtures',
      'loadExampleRuntime',
      'document',
      'window',
      script,
    )(installExampleMapUi, autoLoadExampleFixtures, loadExampleRuntime, document, fakeWindow);

    return {
      constructorOptions,
      maps,
      controls,
      layers,
      sharedUiCalls,
      fixtureRequests,
      fetchCalls: fetchSpy.mock.calls,
      runtime,
      FakeLayerControl,
    };
  } finally {
    fetchSpy.mockRestore();
    document.head.innerHTML = originalHead;
    document.body.innerHTML = originalBody;
  }
}

describe('example catalog metadata', () => {
  it('declares one directly ordered metadata array', async () => {
    const source = await readFile(resolve('docs-meta/examples.ts'), 'utf8');

    expect(source).not.toContain('const seeds:');
    expect(source).not.toContain('const recipes:');
    expect(source).not.toContain('function module(');
    expect(source).not.toContain('recipes[');
  });

  it('builds stable public hrefs for flat and nested IDs', () => {
    expect(examplePublicHref('buffer')).toBe('/mapseekai/emap/examples/buffer/');
    expect(examplePublicHref('getting-started/points')).toBe(
      '/mapseekai/emap/examples/getting-started/points/',
    );
    expect(examplePublicHref('/buffer/')).toBe('/mapseekai/emap/examples/buffer/');
  });

  it('defines the complete metadata-only catalog', () => {
    expect(examples.map(({ id }) => id)).toEqual(expectedIds);
    expect(Array.from(new Set(examples.map(({ category }) => category)))).toEqual(
      expectedModules.map(({ key }) => key),
    );
    for (const { key, count } of expectedModules) {
      expect(
        examples.filter(({ category }) => category === key),
        key,
      ).toHaveLength(count);
    }

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
    expect(byId.get('online-map-services')).toMatchObject({
      category: 'map-data',
      docs: ['/docs/guides/controls'],
      api: ['MapLibreServiceManager'],
      featureFlags: ['maplibre', 'basemap', 'overlay', 'controls'],
      fixtures: ['fixtures/task-6-polygons.geojson'],
      route: '/examples/online-map-services/',
    });
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

    expect(root.querySelectorAll('.catalog-category-button')).toHaveLength(5);
    expect(root.querySelectorAll('.catalog-group')).toHaveLength(4);
    expect(
      Array.from(root.querySelectorAll('.catalog-group-title'), ({ textContent }) => textContent),
    ).toEqual(expectedModules.map(({ zh }) => zh));

    root.querySelector<HTMLButtonElement>('[data-category="map-data"]')?.click();

    expect(root.querySelector('.catalog-group-title')?.textContent).toBe('地图与数据');
    expect(root.querySelectorAll('a.example-card')).toHaveLength(14);
    expect(root.querySelector('[data-category="map-data"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(root.querySelector('.catalog-results-summary')?.textContent).toContain('14');
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
    root.querySelector<HTMLButtonElement>('[data-category="map-data"]')?.click();
    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');

    search.value = 'TopologySource.fromBytes';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(3);

    search.value = 'no-such-example';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.catalog-empty')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.catalog-empty-clear')?.click();
    expect(root.querySelectorAll('a.example-card')).toHaveLength(14);
    expect(root.querySelector<HTMLInputElement>('.catalog-search-input')?.value).toBe('');
  });

  it('preserves control focus and the live result region across catalog updates', () => {
    const root = document.createElement('div');
    document.body.append(root);

    try {
      renderCatalog(root, examples);
      const mapDataButton = root.querySelector<HTMLButtonElement>('[data-category="map-data"]');
      if (!mapDataButton) throw new Error('Map & Data category button was not rendered');
      mapDataButton.focus();
      mapDataButton.click();

      expect(document.activeElement).toBe(
        root.querySelector<HTMLButtonElement>('[data-category="map-data"]'),
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
    expect(root.querySelector('.catalog-total-count')?.textContent).toContain('57');

    const firstCard = root.querySelector<HTMLAnchorElement>(
      'a.example-card[href="/mapseekai/emap/examples/getting-started/geojson-viewer/"]',
    );
    expect(firstCard?.querySelector('.example-api-chip')?.textContent).toBe('Emap');
    expect(firstCard?.querySelector('.example-card-arrow')?.getAttribute('aria-hidden')).toBe(
      'true',
    );

    const mobileCategory = root.querySelector<HTMLSelectElement>('.catalog-mobile-category select');
    expect(mobileCategory?.options).toHaveLength(5);
    if (!mobileCategory) throw new Error('Mobile category selector was not rendered');
    mobileCategory.value = 'data-analysis';
    mobileCategory.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(21);
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
    root.querySelector<HTMLButtonElement>('[data-category="map-data"]')?.click();

    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');
    search.value = 'export';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const language = root.querySelector<HTMLSelectElement>('.catalog-language select');
    if (!language) throw new Error('Catalog language selector was not rendered');
    language.value = 'en';
    language.dispatchEvent(new Event('change'));

    expect(root.querySelector<HTMLInputElement>('.catalog-search-input')?.value).toBe('export');
    expect(root.querySelector('[data-category="map-data"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
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

  it('constructs the online services registry and installs map UI and business layers', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const result = await executeOnlineMapServicesExample(html);
    const options = result.constructorOptions[0] as {
      container: string;
      mapLibre: {
        services: Array<{
          id: string;
          name: string;
          role: string;
          visible?: boolean;
          sources?: Record<string, { tiles: string[] }>;
        }>;
        defaultBasemap: string;
      };
    };
    const { services } = options.mapLibre;

    expect(result.constructorOptions).toHaveLength(1);
    expect(options.container).toBe('map');
    expect(options.mapLibre.defaultBasemap).toBe('osm');
    expect(
      services.filter(({ role }) => role === 'basemap').map(({ id, name }) => ({ id, name })),
    ).toEqual([
      { id: 'osm', name: 'OpenStreetMap' },
      { id: 'carto-light', name: 'Carto Light' },
    ]);
    expect(
      services.filter(({ role }) => role === 'overlay').map(({ id, visible }) => ({ id, visible })),
    ).toEqual([
      { id: 'states-wms', visible: true },
      { id: 'usgs-imagery', visible: true },
    ]);
    expect(services[2].sources?.['states-wms'].tiles).toEqual([
      'https://ahocevar.com/geoserver/wms?service=WMS&request=GetMap&layers=topp:states&styles=&format=image/png&transparent=true&version=1.1.1&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256',
    ]);
    expect(services[3].sources?.['usgs-imagery'].tiles).toEqual([
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    ]);
    expect(result.sharedUiCalls).toEqual([{ map: result.maps[0], runtime: result.runtime }]);
    expect(
      result.controls.filter((control) => control instanceof result.FakeLayerControl),
    ).toHaveLength(1);
    expect(result.layers).toEqual([
      expect.objectContaining({ id: 'business-polygons', source: 'business-data', type: 'fill' }),
    ]);
    expect(result.fixtureRequests).toEqual(['online-map-services']);
    expect(result.fetchCalls).toHaveLength(0);
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
