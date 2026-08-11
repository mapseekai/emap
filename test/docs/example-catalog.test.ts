// @vitest-environment jsdom
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { examplePublicHref, renderCatalog } from '../../packages/examples/src/catalog';

const expectedIds = [
  'getting-started/geojson-viewer',
  'getting-started/points',
  'getting-started/point-style',
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
  'online-map-services',
  'web-worker',
  'duckdb-buffer',
  'duckdb-geoparquet-query',
  'duckdb-overlay',
  'duckdb-query',
  'duckdb-spatial-ops',
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

    const onlineServices = byId.get('online-map-services');
    expect(onlineServices).toMatchObject({
      category: 'platform',
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

    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.primary-link'));
    expect(links).toHaveLength(examples.length);

    for (const [index, link] of links.entries()) {
      expect(link.getAttribute('href')).toBe(`/mapseekai/emap/examples/${examples[index].id}/`);
      expect(link.getAttribute('href')).not.toContain('#');
    }
  });

  it('defaults to Chinese and switches the complete catalog to English', () => {
    const root = document.createElement('div');
    renderCatalog(root, examples);

    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('Emap 文档示例');
    expect(root.querySelector('h1')?.textContent).toBe('Emap 文档示例');
    expect(root.querySelector('h2')?.textContent).toBe(examples[0].title.zh);
    expect(root.querySelector('.example-description')?.textContent).toBe(
      examples[0].description.zh,
    );
    expect(root.querySelector('.primary-link')?.textContent).toBe('打开示例');
    expect(root.textContent).not.toContain('packages/examples/');

    const language = root.querySelector<HTMLSelectElement>('.catalog-language select');
    expect(language?.value).toBe('zh');
    if (!language) throw new Error('Catalog language selector was not rendered');
    language.value = 'en';
    language.dispatchEvent(new Event('change'));

    expect(document.documentElement.lang).toBe('en');
    expect(root.querySelector('h2')?.textContent).toBe(examples[0].title.en);
    expect(root.querySelector('.example-description')?.textContent).toBe(
      examples[0].description.en,
    );
    expect(document.title).toBe('Emap Documentation Example');
    expect(root.querySelector('h1')?.textContent).toBe('Emap Documentation Example');
    expect(root.querySelector('.primary-link')?.textContent).toBe('Open example');
    expect(root.textContent).not.toContain('packages/examples/');
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
