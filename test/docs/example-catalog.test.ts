import { mapLibrePlugin } from '../../src/providers/maplibre/plugin';
// @vitest-environment jsdom
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { examples, exampleTopics, type ExampleDefinition } from '../../docs-meta/examples';
import { examplePublicHref, renderCatalog } from '../../packages/examples/src/catalog';

const expectedModules = [
  { key: 'map-data', zh: '地图与数据' },
  { key: 'style-interaction', zh: '样式与交互' },
  { key: 'data-editing', zh: '数据编辑' },
  { key: 'data-analysis', zh: '数据分析' },
] as const;

function createTopicFixture(
  id: string,
  topic?: { id: 'duckdb'; section: 'query' | 'workflow' | 'geometry' | 'relation' },
): ExampleDefinition {
  return {
    id,
    category: 'data-analysis',
    title: { zh: id, en: id },
    description: { zh: id, en: id },
    learningGoals: { zh: ['目标'], en: ['Goal'] },
    docs: ['/docs/data/duckdb'],
    api: ['Emap'],
    tags: [id],
    featureFlags: [],
    fixtures: [],
    source: { html: `packages/examples/examples/${id}/index.html` },
    route: `/examples/${id}/`,
    success: id,
    ...(topic === undefined ? {} : { topic }),
  };
}

interface CustomServiceSubmission {
  type: 'wms' | 'wmts' | 'xyz' | 'tms' | 'vector' | 'style';
  name?: string;
  endpoint?: string;
  layers?: string;
  tileTemplate?: string;
  sourceLayer?: string;
  renderType?: 'fill' | 'line' | 'circle';
  styleMode?: 'url' | 'json';
  styleInput?: string;
  invalid?: boolean;
}

async function executeOnlineMapServicesExample(
  html: string,
  customService?: CustomServiceSubmission | readonly CustomServiceSubmission[],
) {
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
  const customServices: Array<Record<string, unknown>> = [];
  const customServiceAdds: Array<Record<string, unknown>> = [];
  const customServiceUpdates: Array<{ id: string; service: Record<string, unknown> }> = [];
  const customBasemaps: string[] = [];
  let resolveCustomService: (() => void) | undefined;
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
    public readonly mapLibreServices = {
      addService: async (service: Record<string, unknown>): Promise<void> => {
        customServiceAdds.push(service);
        customServices.push(service);
        resolveCustomService?.();
      },
      updateService: async (id: string, service: Record<string, unknown>): Promise<void> => {
        customServiceUpdates.push({ id, service });
        const index = customServices.findIndex((candidate) => candidate.id === id);
        if (index === -1) customServices.push(service);
        else customServices[index] = service;
        resolveCustomService?.();
      },
      setBasemap: async (id: string): Promise<void> => {
        customBasemaps.push(id);
        resolveCustomService?.();
      },
    };

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
      'mapLibrePlugin',
      script,
    )(
      installExampleMapUi,
      autoLoadExampleFixtures,
      loadExampleRuntime,
      document,
      fakeWindow,
      mapLibrePlugin,
    );
    const customServiceSubmissions = customService
      ? Array.isArray(customService)
        ? customService
        : [customService]
      : [];
    if (customServiceSubmissions.length > 0) {
      const type = document.querySelector<HTMLSelectElement>('#custom-service-type');
      const name = document.querySelector<HTMLInputElement>('#custom-service-name');
      const endpoint = document.querySelector<HTMLInputElement>('#custom-wms-url');
      const layers = document.querySelector<HTMLInputElement>('#custom-wms-layers');
      const tileTemplate = document.querySelector<HTMLInputElement>('#custom-tile-template');
      const sourceLayer = document.querySelector<HTMLInputElement>('#custom-vector-source-layer');
      const renderType = document.querySelector<HTMLSelectElement>('#custom-vector-render-type');
      const styleMode = document.querySelector<HTMLSelectElement>('#custom-style-mode');
      const styleInput = document.querySelector<HTMLTextAreaElement>('#custom-style-input');
      const form = document.querySelector<HTMLFormElement>('#custom-service-form');
      if (
        !type ||
        !name ||
        !endpoint ||
        !layers ||
        !tileTemplate ||
        !sourceLayer ||
        !renderType ||
        !styleMode ||
        !styleInput ||
        !form
      ) {
        throw new Error('online-map-services unified custom-service form is missing');
      }
      for (const submission of customServiceSubmissions) {
        type.value = submission.type;
        type.dispatchEvent(new Event('change'));
        expect(type.value).toBe(submission.type);
        if (
          submission.type === 'wmts' ||
          submission.type === 'xyz' ||
          submission.type === 'tms' ||
          submission.type === 'vector'
        ) {
          expect(tileTemplate.disabled).toBe(false);
        }
        name.value = submission.name ?? '';
        endpoint.value = submission.endpoint ?? '';
        layers.value = submission.layers ?? '';
        tileTemplate.value = submission.tileTemplate ?? '';
        sourceLayer.value = submission.sourceLayer ?? '';
        renderType.value = submission.renderType ?? 'fill';
        styleMode.value = submission.styleMode ?? 'url';
        styleInput.value = submission.styleInput ?? '';
        const customServiceApplied = new Promise<void>((resolve) => {
          resolveCustomService = resolve;
        });
        form.requestSubmit();
        if (submission.invalid) await Promise.resolve();
        else await customServiceApplied;
        resolveCustomService = undefined;
      }
    }

    return {
      constructorOptions,
      maps,
      controls,
      layers,
      sharedUiCalls,
      fixtureRequests,
      customServices,
      customServiceAdds,
      customServiceUpdates,
      customBasemaps,
      statusText: document.querySelector('#status')?.textContent,
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
  it('uses the exported manifest as the only route inventory', async () => {
    const source = await readFile(resolve('docs-meta/examples.ts'), 'utf8');
    const viteConfig = await readFile(resolve('packages/examples/vite.config.ts'), 'utf8');

    expect(source).not.toContain('const seeds:');
    expect(source).not.toContain('const recipes:');
    expect(source).not.toContain('function module(');
    expect(source).not.toContain('recipes[');
    expect(viteConfig).toContain("import { exampleIds } from '../../docs-meta/examples';");
    expect(viteConfig).toContain('const routeIds = exampleIds;');
    expect(viteConfig).not.toContain("'getting-started/geojson-viewer'");
  });

  it('builds stable public hrefs for flat and nested IDs', () => {
    expect(examplePublicHref('buffer')).toBe('/mapseekai/emap/examples/buffer/');
    expect(examplePublicHref('getting-started/points')).toBe(
      '/mapseekai/emap/examples/getting-started/points/',
    );
    expect(examplePublicHref('/buffer/')).toBe('/mapseekai/emap/examples/buffer/');
  });

  it('defines the complete metadata-only catalog', () => {
    expect(Array.from(new Set(examples.map(({ category }) => category)))).toEqual(
      expectedModules.map(({ key }) => key),
    );
    for (const { key } of expectedModules) {
      expect(
        examples.some(({ category }) => category === key),
        key,
      ).toBe(true);
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
    expect(byId.get('getting-started/topojson-viewer')?.fixtures).toEqual([]);
    expect(byId.get('export-formats')?.fixtures).toEqual(['fixtures/task-6-polygons.geojson']);
    expect(byId.get('join')?.category).toBe('data-analysis');
    expect(byId.get('web-worker')?.category).toBe('data-analysis');
    expect(byId.get('duckdb-geoparquet-query')?.fixtures).toEqual([
      'fixtures/example-geoparquet.parquet',
    ]);
    for (const id of [
      'duckdb/relation/intersects',
      'duckdb/relation/contains',
      'duckdb/relation/within',
      'duckdb/relation/touches',
      'duckdb/relation/disjoint',
      'duckdb/relation/overlaps',
      'duckdb/relation/equals',
      'duckdb/relation/crosses',
      'duckdb/relation/covers',
      'duckdb/relation/covered-by',
      'duckdb/relation/contains-properly',
    ]) {
      expect(byId.get(id)).toMatchObject({
        docs: ['/docs/data/duckdb', '/docs/data/operations'],
        fixtures: ['fixtures/task-7-polygons.geojson'],
        topic: { id: 'duckdb', section: 'relation' },
      });
      expect(byId.get(id)?.tags).toEqual(expect.arrayContaining(['duckdb', 'spatial', 'relation']));
      expect(byId.get(id)?.featureFlags).toEqual([
        'duckdb',
        'spatial',
        'relation',
        id.slice(id.lastIndexOf('/') + 1),
      ]);
    }
    for (const id of ['duckdb/relation/distance', 'duckdb/relation/distance-within']) {
      expect(byId.get(id)).toMatchObject({
        docs: ['/docs/data/duckdb', '/docs/data/operations'],
        fixtures: [
          'fixtures/duckdb-distance-target.geojson',
          'fixtures/duckdb-distance-mask.geojson',
        ],
        topic: { id: 'duckdb', section: 'relation' },
        featureFlags: ['duckdb', 'spatial', 'relation', 'distance'],
      });
    }
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

    expect(root.querySelectorAll('.catalog-category-button')).toHaveLength(
      expectedModules.length + 1,
    );
    expect(root.querySelectorAll('.catalog-group')).toHaveLength(expectedModules.length);
    expect(
      Array.from(root.querySelectorAll('.catalog-group-title'), ({ textContent }) => textContent),
    ).toEqual(expectedModules.map(({ zh }) => zh));

    const mapDataCount = examples.filter(({ category }) => category === 'map-data').length;
    root.querySelector<HTMLButtonElement>('[data-category="map-data"]')?.click();

    expect(root.querySelector('.catalog-group-title')?.textContent).toBe('地图与数据');
    expect(root.querySelectorAll('a.example-card')).toHaveLength(mapDataCount);
    expect(root.querySelector('[data-category="map-data"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(root.querySelector('.catalog-results-summary')?.textContent).toContain(
      String(mapDataCount),
    );
  });

  it('groups DuckDB examples by section after ordinary data-analysis cards', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);

    const topic = root.querySelector('.catalog-topic');
    if (!topic) throw new Error('DuckDB topic was not rendered');
    const duckDbExamples = examples.filter((example) => example.topic?.id === 'duckdb');
    expect(topic.querySelectorAll('a.example-card')).toHaveLength(duckDbExamples.length);
    expect(
      Array.from(topic.querySelectorAll('.catalog-topic-section'), (section) => ({
        title: section.querySelector('.catalog-topic-section-title')?.textContent,
        count: section.querySelectorAll('a.example-card').length,
      })),
    ).toEqual(
      exampleTopics.duckdb.sections.map((section) => ({
        title: section.title.zh,
        count: duckDbExamples.filter((example) => example.topic?.section === section.id).length,
      })),
    );
    expect(root.querySelectorAll('.catalog-direct-examples a.example-card')).toHaveLength(
      examples.length - duckDbExamples.length,
    );
    expect(root.querySelectorAll('.catalog-direct-examples .catalog-topic')).toHaveLength(0);
  });

  it('nests ordered DuckDB topic sections after ordinary data-analysis cards', () => {
    const topicFixture: ExampleDefinition[] = [
      createTopicFixture('ordinary-analysis-one'),
      createTopicFixture('ordinary-analysis-two'),
      createTopicFixture('duckdb-query-one', { id: 'duckdb', section: 'query' }),
      createTopicFixture('duckdb-geometry', { id: 'duckdb', section: 'geometry' }),
      createTopicFixture('duckdb-query-two', { id: 'duckdb', section: 'query' }),
    ];
    const root = document.createElement('div');
    renderCatalog(root, topicFixture);

    expect(root.querySelectorAll('.catalog-topic')).toHaveLength(1);
    expect(root.querySelector('.catalog-topic-title')?.textContent).toBe('DuckDB 空间数据分析');
    expect(
      Array.from(
        root.querySelectorAll('.catalog-topic-section-title'),
        ({ textContent }) => textContent,
      ),
    ).toEqual(['查询与数据接入', '几何处理']);
    expect(
      Array.from(
        root.querySelectorAll('.catalog-direct-examples .example-card-title'),
        ({ textContent }) => textContent,
      ),
    ).toEqual(['ordinary-analysis-one', 'ordinary-analysis-two']);
    expect(
      Array.from(
        root.querySelectorAll('.catalog-topic-section .example-card-title'),
        ({ textContent }) => textContent,
      ),
    ).toEqual(['duckdb-query-one', 'duckdb-query-two', 'duckdb-geometry']);
    const directGrid = root.querySelector('.catalog-direct-examples');
    const topic = root.querySelector('.catalog-topic');
    if (!directGrid || !topic) throw new Error('Expected direct cards and a DuckDB topic');
    expect(directGrid.compareDocumentPosition(topic) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(root.querySelectorAll('.catalog-topic a.example-card')).toHaveLength(3);
    expect(root.querySelectorAll('.catalog-direct-examples a.example-card')).toHaveLength(2);
  });

  it('renders category-mismatched topic cards as direct cards', () => {
    const topicFixture: ExampleDefinition[] = [
      {
        ...createTopicFixture('duckdb-in-map-data', { id: 'duckdb', section: 'query' }),
        category: 'map-data',
      },
    ];
    const root = document.createElement('div');
    renderCatalog(root, topicFixture);

    expect(root.querySelectorAll('a.example-card')).toHaveLength(1);
    expect(root.querySelectorAll('.catalog-topic')).toHaveLength(0);
    expect(root.querySelector('.catalog-direct-examples .example-card-title')?.textContent).toBe(
      'duckdb-in-map-data',
    );
  });

  it('omits empty DuckDB topic sections after filtering to one card', () => {
    const topicFixture: ExampleDefinition[] = [
      createTopicFixture('ordinary-analysis'),
      createTopicFixture('duckdb-query', { id: 'duckdb', section: 'query' }),
      createTopicFixture('duckdb-geometry', { id: 'duckdb', section: 'geometry' }),
    ];
    const root = document.createElement('div');
    renderCatalog(root, topicFixture);
    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');

    search.value = 'duckdb-geometry';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelectorAll('.catalog-topic a.example-card')).toHaveLength(1);
    expect(
      Array.from(
        root.querySelectorAll('.catalog-topic-section-title'),
        ({ textContent }) => textContent,
      ),
    ).toEqual(['几何处理']);
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
    ).toEqual(['GeoParquet / GeoArrow 查看器']);

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
    englishSearch.value = 'downloads GeoJSON, Shapefile, TopoJSON';
    englishSearch.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      Array.from(root.querySelectorAll('.example-card-title'), ({ textContent }) => textContent),
    ).toEqual(['Export formats']);
  });

  it('combines filters, clears search, and renders an empty result', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);
    root.querySelector<HTMLButtonElement>('[data-category="map-data"]')?.click();
    const search = root.querySelector<HTMLInputElement>('.catalog-search-input');
    if (!search) throw new Error('Catalog search was not rendered');

    search.value = 'TopologySource.fromBytes';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('a.example-card')).toHaveLength(1);

    search.value = 'no-such-example';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.catalog-empty')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.catalog-empty-clear')?.click();
    expect(root.querySelectorAll('a.example-card')).toHaveLength(
      examples.filter(({ category }) => category === 'map-data').length,
    );
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
    expect(root.querySelector('.catalog-total-count')?.textContent).toContain(
      String(examples.length),
    );

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
    expect(root.querySelectorAll('a.example-card')).toHaveLength(
      examples.filter(({ category }) => category === 'data-analysis').length,
    );
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
    ).toEqual(['Export formats']);
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
      expect(
        html.includes('installExampleMapUi(map') || html.includes('mountDuckDbSpatialExample'),
        `${example.id} installs shared map UI directly or through its DuckDB spatial runner`,
      ).toBe(true);
      if (example.id === 'create-layer') {
        // This example creates data from scratch instead of uploading a fixture.
        expect(parsed.querySelector('form#create-form')).not.toBeNull();
        expect(parsed.querySelector('#create')).not.toBeNull();
        expect(html).toContain('map.createLayer(');
      } else {
        expect(html, `${example.id} keeps a user upload`).toMatch(/type=["']file["']/);
      }
      expect(html, `${example.id} avoids source-tree assets`).not.toMatch(
        /\.\.\/\.\.\/(?:dist|src)\//,
      );
      if (example.id !== 'china-editing') {
        expect(html, `${example.id} uses local starter data`).not.toContain('https://geojson.cn/');
      }
    }
  });

  it('removes the former combined DuckDB spatial page', async () => {
    expect(examples.map(({ id }) => id)).not.toContain('duckdb-spatial-ops');
    await expect(
      access(resolve('packages/examples/examples/duckdb-spatial-ops/index.html')),
    ).rejects.toThrow();
  });
  it('keeps DuckDB geometry maps in the floating-header workbench and validates simplify tolerance', async () => {
    const geometryIds = [
      'duckdb/geometry/centroid',
      'duckdb/geometry/envelope',
      'duckdb/geometry/convex-hull',
      'duckdb/geometry/boundary',
      'duckdb/geometry/simplify',
      'duckdb/geometry/simplify-preserve-topology',
      'duckdb/geometry/make-valid',
    ];
    for (const id of geometryIds) {
      const html = await readFile(resolve(`packages/examples/examples/${id}/index.html`), 'utf8');
      const page = new DOMParser().parseFromString(html, 'text/html');
      expect(page.body.classList.contains('emap-example-with-floating-header')).toBe(true);
      expect(page.querySelector('details.emap-example-workbench.panel')).not.toBeNull();
    }
    for (const id of geometryIds.slice(4, 6)) {
      const html = await readFile(resolve(`packages/examples/examples/${id}/index.html`), 'utf8');
      const tolerance = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector<HTMLInputElement>('#tolerance');
      expect(tolerance?.type).toBe('number');
      expect(tolerance?.min).toBe('0');
      expect(tolerance?.step).toBe('any');
    }
  });

  it('exposes TopoJSON import and the requested six export formats', async () => {
    const topojsonHtml = await readFile(
      resolve('packages/examples/examples/getting-started/topojson-viewer/index.html'),
      'utf8',
    );
    const topojson = new DOMParser().parseFromString(topojsonHtml, 'text/html');
    expect(topojson.querySelector<HTMLInputElement>('#file-input')?.accept).toContain('.topojson');

    const exporterHtml = await readFile(
      resolve('packages/examples/examples/export-formats/index.html'),
      'utf8',
    );
    const exporter = new DOMParser().parseFromString(exporterHtml, 'text/html');
    expect(exporter.querySelector<HTMLInputElement>('#file-input')?.accept).toContain('.fgb');
    expect(
      Array.from(
        exporter.querySelectorAll<HTMLOptionElement>('#format option'),
        ({ value }) => value,
      ),
    ).toEqual(['geojson', 'shapefile', 'topojson', 'flatgeobuf', 'geoparquet', 'geoarrow']);
  });

  it('constructs the online services registry and installs map UI and business layers', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const result = await executeOnlineMapServicesExample(html, {
      type: 'wms',
      endpoint: 'https://example.test/geoserver/wms?token=demo',
      layers: 'demo:parcels',
      name: 'Parcel WMS',
    });
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
      { id: 'openfreemap-bright', visible: false },
      { id: 'usgs-imagery', visible: true },
    ]);
    expect(services[2].sources?.['states-wms'].tiles).toEqual([
      'https://ahocevar.com/geoserver/wms?service=WMS&request=GetMap&layers=topp:states&styles=&format=image/png&transparent=true&version=1.1.1&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256',
    ]);
    expect(services[4].sources?.['usgs-imagery'].tiles).toEqual([
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
    expect(result.customServices).toEqual([
      expect.objectContaining({
        id: 'custom-wms',
        name: 'Parcel WMS',
        role: 'overlay',
        visible: true,
      }),
    ]);
    expect(
      (result.customServices[0].sources as Record<string, { tiles: string[] }>)['custom-wms'].tiles,
    ).toEqual([
      'https://example.test/geoserver/wms?token=demo&service=WMS&request=GetMap&layers=demo%3Aparcels&styles=&format=image%2Fpng&transparent=true&version=1.1.1&srs=EPSG%3A3857&bbox={bbox-epsg-3857}&width=256&height=256',
    ]);
    expect(result.fetchCalls).toHaveLength(0);
  });

  it('registers a WMTS tile template as a visible raster overlay', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const result = await executeOnlineMapServicesExample(html, {
      type: 'wmts',
      name: 'National WMTS',
      tileTemplate: 'https://tiles.example.test/wmts/{z}/{y}/{x}.png',
    });

    const service = result.customServices[0] as {
      id: string;
      name: string;
      role: string;
      visible: boolean;
      sources: Record<string, { type: string; tiles: string[]; tileSize: number }>;
    };
    expect(service).toMatchObject({
      id: 'custom-wmts',
      name: 'National WMTS',
      role: 'overlay',
      visible: true,
    });
    expect(service.sources['custom-wmts']).toEqual({
      type: 'raster',
      tiles: ['https://tiles.example.test/wmts/{z}/{y}/{x}.png'],
      tileSize: 256,
    });
  });

  it('registers a TMS tile template with its inverted row scheme', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const result = await executeOnlineMapServicesExample(html, {
      type: 'tms',
      name: 'Local TMS',
      tileTemplate: 'https://tiles.example.test/tms/{z}/{x}/{y}.png',
    });

    const service = result.customServices[0] as {
      id: string;
      name: string;
      role: string;
      visible: boolean;
      sources: Record<string, { type: string; tiles: string[]; tileSize: number; scheme?: string }>;
    };
    expect(service).toMatchObject({
      id: 'custom-tms',
      name: 'Local TMS',
      role: 'overlay',
      visible: true,
    });
    expect(service.sources['custom-tms']).toEqual({
      type: 'raster',
      tiles: ['https://tiles.example.test/tms/{z}/{x}/{y}.png'],
      tileSize: 256,
      scheme: 'tms',
    });
  });

  it('registers an XYZ tile template with its standard row scheme', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const result = await executeOnlineMapServicesExample(html, {
      type: 'xyz',
      name: 'Standard XYZ',
      tileTemplate: 'https://tiles.example.test/xyz/{z}/{x}/{y}.png',
    });

    const service = result.customServices[0] as {
      id: string;
      name: string;
      role: string;
      visible: boolean;
      sources: Record<string, { type: string; tiles: string[]; tileSize: number; scheme?: string }>;
    };
    expect(service).toMatchObject({
      id: 'custom-xyz',
      name: 'Standard XYZ',
      role: 'overlay',
      visible: true,
    });
    expect(service.sources['custom-xyz']).toEqual({
      type: 'raster',
      tiles: ['https://tiles.example.test/xyz/{z}/{x}/{y}.png'],
      tileSize: 256,
      scheme: 'xyz',
    });
  });

  it('registers vector tiles with the selected source layer and render mode', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelectorAll('#custom-tile-template')).toHaveLength(1);
    const result = await executeOnlineMapServicesExample(html, {
      type: 'vector',
      name: 'Road network',
      tileTemplate: 'https://tiles.example.test/vector/{z}/{x}/{y}.pbf',
      sourceLayer: 'roads',
      renderType: 'line',
    });

    const service = result.customServices[0] as {
      id: string;
      role: string;
      sources: Record<string, { type: string; tiles: string[] }>;
      layers: Array<Record<string, unknown>>;
    };
    expect(service).toMatchObject({ id: 'custom-vector', role: 'overlay' });
    expect(service.sources['custom-vector']).toEqual({
      type: 'vector',
      tiles: ['https://tiles.example.test/vector/{z}/{x}/{y}.pbf'],
    });
    expect(service.layers).toEqual([
      expect.objectContaining({
        id: 'custom-vector-layer',
        type: 'line',
        source: 'custom-vector',
        'source-layer': 'roads',
      }),
    ]);
  });

  it('registers MapLibre Style URLs and inline JSON as active overlays', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const urlResult = await executeOnlineMapServicesExample(html, {
      type: 'style',
      name: 'Hosted style',
      styleMode: 'url',
      styleInput: 'https://styles.example.test/basic/style.json',
    });
    const jsonResult = await executeOnlineMapServicesExample(html, {
      type: 'style',
      name: 'Inline style',
      styleMode: 'json',
      styleInput: '{"version":8,"sources":{},"layers":[]}',
    });

    expect(urlResult.customServices).toEqual([
      expect.objectContaining({
        id: 'custom-style',
        name: 'Hosted style',
        role: 'overlay',
        visible: true,
        style: 'https://styles.example.test/basic/style.json',
      }),
    ]);
    expect(urlResult.customBasemaps).toEqual([]);
    expect(jsonResult.customServices).toEqual([
      expect.objectContaining({
        id: 'custom-style',
        name: 'Inline style',
        role: 'overlay',
        visible: true,
        style: { version: 8, sources: {}, layers: [] },
      }),
    ]);
    expect(jsonResult.customBasemaps).toEqual([]);
  });

  it('updates a re-submitted custom service instead of registering a duplicate id', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/online-map-services/index.html'),
      'utf8',
    );
    const result = await executeOnlineMapServicesExample(html, [
      {
        type: 'wms',
        name: 'Initial overlay',
        endpoint: 'https://example.test/geoserver/wms',
        layers: 'demo:parcels',
      },
      {
        type: 'wms',
        name: 'Updated overlay',
        endpoint: 'https://example.test/geoserver/wms',
        layers: 'demo:buildings',
      },
    ]);

    expect(result.customServiceAdds).toHaveLength(1);
    expect(result.customServiceUpdates).toEqual([
      expect.objectContaining({
        id: 'custom-wms',
        service: expect.objectContaining({ name: 'Updated overlay' }),
      }),
    ]);
    expect(result.customServices).toEqual([
      expect.objectContaining({
        id: 'custom-wms',
        name: 'Updated overlay',
      }),
    ]);
  });

  it('rejects malformed or structurally incomplete MapLibre Style JSON', async () => {
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const html = await readFile(
        resolve('packages/examples/examples/online-map-services/index.html'),
        'utf8',
      );

      for (const styleInput of [
        '{"version":"8"}',
        '{"version":8}',
        '{"version":7,"sources":{},"layers":[]}',
      ]) {
        const result = await executeOnlineMapServicesExample(html, {
          type: 'style',
          styleMode: 'json',
          styleInput,
          invalid: true,
        });

        expect(result.customServices).toEqual([]);
        expect(result.customBasemaps).toEqual([]);
        expect(result.statusText).toContain('Style JSON');
      }
      expect(reportError).toHaveBeenCalledTimes(3);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Style JSON 必须包含 version: 8、对象 sources 和数组 layers',
        }),
      );
    } finally {
      reportError.mockRestore();
    }
  });

  it('reports invalid WMS URLs through status without registering a service', async () => {
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const html = await readFile(
        resolve('packages/examples/examples/online-map-services/index.html'),
        'utf8',
      );
      const result = await executeOnlineMapServicesExample(html, {
        type: 'wms',
        endpoint: 'not-a-url',
        layers: 'demo:parcels',
        invalid: true,
      });

      expect(result.customServices).toEqual([]);
      expect(result.statusText).toContain('WMS 地址');
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'WMS 地址必须是有效 URL' }),
      );
    } finally {
      reportError.mockRestore();
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
