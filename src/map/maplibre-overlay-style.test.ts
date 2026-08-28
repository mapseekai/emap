import { describe, expect, it, vi } from 'vitest';
import type * as maplibregl from 'maplibre-gl';
import type { MapLibreOverlayStyleService } from './maplibre-service';
import {
  composeMapLibreStyle,
  loadMapLibreOverlayStyle,
  normalizeMapLibreStyleUrls,
  prepareMapLibreOverlayStyle,
} from './maplibre-overlay-style';

const STYLE_URL = 'https://tiles.example.test/styles/style.json';
const PREFIX = 'emap-overlay:bright%2Fservice';
const GLYPHS_URL = 'https://tiles.example.test/fonts/{fontstack}/{range}.pbf';

function createFixture(): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'Bright',
    sprite: './sprites/bright',
    glyphs: '../fonts/{fontstack}/{range}.pbf',
    sources: {
      earth: { type: 'vector', url: './earth.json' },
      tiles: { type: 'raster', tiles: ['./raster/{z}/{x}/{y}.png'] },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      {
        id: 'routes',
        type: 'line',
        source: 'earth',
        'source-layer': 'road',
        paint: { 'line-pattern': 'highway' },
      },
      {
        id: 'land',
        type: 'fill',
        source: 'earth',
        'source-layer': 'land',
        paint: { 'fill-pattern': 'terrain' },
      },
      {
        id: 'labels',
        type: 'symbol',
        source: 'earth',
        'source-layer': 'place',
        layout: { 'icon-image': ['get', 'kind'] },
      },
    ],
  } as maplibregl.StyleSpecification;
}

function createBaseStyle(glyphs?: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    ...(glyphs ? { glyphs } : {}),
    sources: { base: { type: 'vector', url: 'https://base.example.test/tiles.json' } },
    layers: [{ id: 'base-background', type: 'background' }],
  } as maplibregl.StyleSpecification;
}

describe('prepareMapLibreOverlayStyle', () => {
  it('normalizes URLs, namespaces resources, and rewrites image references', () => {
    const fixture = createFixture();

    const prepared = prepareMapLibreOverlayStyle('bright/service', fixture, STYLE_URL);

    expect(prepared.style.layers.some((layer) => layer.type === 'background')).toBe(false);
    expect(Object.keys(prepared.style.sources)).toEqual([`${PREFIX}:earth`, `${PREFIX}:tiles`]);
    expect(prepared.style.layers.map((layer) => layer.id)).toEqual([
      `${PREFIX}:routes`,
      `${PREFIX}:land`,
      `${PREFIX}:labels`,
    ]);
    expect(prepared.style.sprite).toEqual([
      { id: `${PREFIX}:default`, url: 'https://tiles.example.test/styles/sprites/bright' },
    ]);
    expect(prepared.style.glyphs).toBe(GLYPHS_URL);
    expect(prepared.style.sources[`${PREFIX}:earth`]).toMatchObject({
      url: 'https://tiles.example.test/styles/earth.json',
    });
    expect(prepared.style.sources[`${PREFIX}:tiles`]).toMatchObject({
      tiles: ['https://tiles.example.test/styles/raster/{z}/{x}/{y}.png'],
    });
    expect(prepared.style.layers).toMatchObject([
      {
        id: `${PREFIX}:routes`,
        source: `${PREFIX}:earth`,
        paint: { 'line-pattern': `${PREFIX}:default:highway` },
      },
      {
        id: `${PREFIX}:land`,
        source: `${PREFIX}:earth`,
        paint: { 'fill-pattern': `${PREFIX}:default:terrain` },
      },
      {
        id: `${PREFIX}:labels`,
        source: `${PREFIX}:earth`,
        layout: {
          'icon-image': ['concat', `${PREFIX}:default:`, ['get', 'kind']],
        },
      },
    ]);
    expect(prepared.sourceIds).toEqual([`${PREFIX}:earth`, `${PREFIX}:tiles`]);
    expect(prepared.layerIds).toEqual([`${PREFIX}:routes`, `${PREFIX}:land`, `${PREFIX}:labels`]);
    expect(prepared.spriteIds).toEqual([`${PREFIX}:default`]);
    expect(prepared.resourceUrls).toEqual(
      new Set([
        'https://tiles.example.test/styles/sprites/bright',
        GLYPHS_URL,
        'https://tiles.example.test/styles/earth.json',
        'https://tiles.example.test/styles/raster/{z}/{x}/{y}.png',
      ]),
    );
  });

  it('prefixes literal icon-image references for a default sprite', () => {
    const fixture = createFixture();
    fixture.layers[3] = {
      ...fixture.layers[3],
      layout: { 'icon-image': 'marker' },
    } as maplibregl.LayerSpecification;

    const prepared = prepareMapLibreOverlayStyle('bright/service', fixture, STYLE_URL);

    expect(prepared.style.layers[2]).toMatchObject({
      layout: { 'icon-image': `${PREFIX}:default:marker` },
    });
  });

  it('preserves absolute URL schemes verbatim in styles and resource URLs', () => {
    const fixture = createFixture();
    fixture.sprite = 'custom://sprite/%7Bname%7D';
    fixture.glyphs = 'data:application/octet-stream,%7Bfont%7D';
    fixture.sources.earth = {
      type: 'geojson',
      data: 'blob:https://tiles.example.test/%7Bdata%7D',
    } as maplibregl.SourceSpecification;
    fixture.sources.tiles = {
      type: 'vector',
      url: 'custom://tiles/%7Burl%7D',
      tiles: ['data:application/json,%7Btile%7D', 'blob:https://tiles.example.test/%7Btile%7D'],
      urls: ['custom://tiles/%7Burls%7D'],
    } as maplibregl.SourceSpecification;

    const prepared = prepareMapLibreOverlayStyle('bright/service', fixture, STYLE_URL);

    expect(prepared.style.sprite).toEqual([
      { id: `${PREFIX}:default`, url: 'custom://sprite/%7Bname%7D' },
    ]);
    expect(prepared.style.glyphs).toBe('data:application/octet-stream,%7Bfont%7D');
    expect(prepared.style.sources[`${PREFIX}:earth`]).toMatchObject({
      data: 'blob:https://tiles.example.test/%7Bdata%7D',
    });
    expect(prepared.style.sources[`${PREFIX}:tiles`]).toMatchObject({
      url: 'custom://tiles/%7Burl%7D',
      tiles: ['data:application/json,%7Btile%7D', 'blob:https://tiles.example.test/%7Btile%7D'],
      urls: ['custom://tiles/%7Burls%7D'],
    });
    expect(prepared.resourceUrls).toEqual(
      new Set([
        'custom://sprite/%7Bname%7D',
        'data:application/octet-stream,%7Bfont%7D',
        'blob:https://tiles.example.test/%7Bdata%7D',
        'custom://tiles/%7Burl%7D',
        'data:application/json,%7Btile%7D',
        'blob:https://tiles.example.test/%7Btile%7D',
        'custom://tiles/%7Burls%7D',
      ]),
    );
  });

  it('preserves inputs and only normalizes URL-bearing fields', () => {
    const fixture = createFixture();
    fixture.sources.earth = {
      type: 'geojson',
      data: './earth.geojson',
    } as maplibregl.SourceSpecification;
    fixture.sources.tiles = {
      type: 'vector',
      url: 'mapbox://custom-tiles',
      tiles: ['data:application/json,{}', 'blob:https://example.test/id'],
    } as maplibregl.SourceSpecification;
    fixture.layers[2] = {
      ...fixture.layers[2],
      filter: ['==', ['get', 'name'], 'terrain'],
      layout: { 'text-font': ['Open Sans Regular'] },
    } as maplibregl.LayerSpecification;

    const original = structuredClone(fixture);

    const prepared = prepareMapLibreOverlayStyle('bright/service', fixture, STYLE_URL);

    expect(fixture).toEqual(original);
    expect(fixture.sources.earth).toEqual({ type: 'geojson', data: './earth.geojson' });
    expect(fixture.sources.tiles).toMatchObject({
      url: 'mapbox://custom-tiles',
      tiles: ['data:application/json,{}', 'blob:https://example.test/id'],
    });
    expect(prepared.style.sources[`${PREFIX}:earth`]).toMatchObject({
      data: 'https://tiles.example.test/styles/earth.geojson',
    });
    expect(prepared.style.sources[`${PREFIX}:tiles`]).toMatchObject({
      url: 'mapbox://custom-tiles',
      tiles: ['data:application/json,{}', 'blob:https://example.test/id'],
    });
    expect(prepared.style.layers[1]).toMatchObject({
      filter: ['==', ['get', 'name'], 'terrain'],
      layout: { 'text-font': ['Open Sans Regular'] },
    });
  });

  it('rejects invalid styles and duplicate generated layer IDs', () => {
    expect(() =>
      prepareMapLibreOverlayStyle('service', { version: 7, sources: {}, layers: [] } as never),
    ).toThrow('MapLibre overlay styles must use version 8');
    expect(() =>
      prepareMapLibreOverlayStyle('service', { version: 8, sources: [], layers: [] } as never),
    ).toThrow('MapLibre overlay style sources must be an object');
    expect(() =>
      prepareMapLibreOverlayStyle('service', { version: 8, sources: {}, layers: {} } as never),
    ).toThrow('MapLibre overlay style layers must be an array');
    expect(() =>
      prepareMapLibreOverlayStyle('service', {
        version: 8,
        sources: {},
        layers: [
          { id: 'same', type: 'background' },
          { id: 'same', type: 'background' },
        ],
      } as never),
    ).toThrow('MapLibre overlay style generated IDs must be unique');
  });
});

describe('composeMapLibreStyle', () => {
  it('merges same-glyph overlays, namespaced sprites, registry-order layers, and hidden visibility', () => {
    const first = prepareMapLibreOverlayStyle('one', {
      version: 8,
      glyphs: GLYPHS_URL,
      sprite: [
        { id: 'ui', url: 'https://one.example.test/ui' },
        { id: 'poi', url: 'https://one.example.test/poi' },
      ],
      sources: { one: { type: 'vector', url: 'https://one.example.test/tiles' } },
      layers: [{ id: 'first', type: 'line', source: 'one', layout: { visibility: 'visible' } }],
    } as maplibregl.StyleSpecification);
    const second = prepareMapLibreOverlayStyle('two', {
      version: 8,
      glyphs: GLYPHS_URL,
      sprite: 'https://two.example.test/sprite',
      sources: { two: { type: 'vector', url: 'https://two.example.test/tiles' } },
      layers: [{ id: 'second', type: 'fill', source: 'two' }],
    } as maplibregl.StyleSpecification);
    const base = {
      ...createBaseStyle(),
      sprite: 'https://base.example.test/sprite',
    } as maplibregl.StyleSpecification;
    const baseBefore = structuredClone(base);

    const composed = composeMapLibreStyle(base, [
      { prepared: second, visible: true },
      { prepared: first, visible: false },
    ]);

    expect(composed).toMatchObject({ version: 8, glyphs: GLYPHS_URL });
    expect(composed.layers.map((layer) => layer.id)).toEqual([
      'base-background',
      'emap-overlay:two:second',
      'emap-overlay:one:first',
    ]);
    expect(composed.layers[2]).toMatchObject({ layout: { visibility: 'none' } });
    expect(composed.sprite).toEqual([
      { id: 'default', url: 'https://base.example.test/sprite' },
      { id: 'emap-overlay:two:default', url: 'https://two.example.test/sprite' },
      { id: 'emap-overlay:one:ui', url: 'https://one.example.test/ui' },
      { id: 'emap-overlay:one:poi', url: 'https://one.example.test/poi' },
    ]);
    expect(base).toEqual(baseBefore);
  });

  it('preserves an overlay layer visibility when visible and rejects conflicting glyphs', () => {
    const prepared = prepareMapLibreOverlayStyle('visible', {
      version: 8,
      glyphs: GLYPHS_URL,
      sources: { source: { type: 'vector', url: 'https://overlay.example.test/tiles' } },
      layers: [{ id: 'layer', type: 'line', source: 'source', layout: { visibility: 'none' } }],
    } as maplibregl.StyleSpecification);

    expect(
      composeMapLibreStyle(createBaseStyle(GLYPHS_URL), [{ prepared, visible: true }]).layers[1],
    ).toMatchObject({
      layout: { visibility: 'none' },
    });
    expect(() =>
      composeMapLibreStyle(
        createBaseStyle('https://fonts.example.test/a/{fontstack}/{range}.pbf'),
        [{ prepared, visible: true }],
      ),
    ).toThrow('MapLibre overlay glyphs URL conflicts with the active style');
  });
});

describe('normalizeMapLibreStyleUrls', () => {
  it('canonicalizes basemap resources against the final style response URL without altering layers', () => {
    const style = {
      version: 8,
      sprite: './sprites/base',
      glyphs: '../fonts/{fontstack}/{range}.pbf',
      sources: {
        vector: { type: 'vector', url: './tiles.json', tiles: ['../tiles/{z}/{x}/{y}.pbf'] },
        geojson: { type: 'geojson', data: './data/features.geojson' },
      },
      layers: [{ id: 'background', type: 'background' }],
    } as maplibregl.StyleSpecification;

    const normalized = normalizeMapLibreStyleUrls(
      style,
      'https://redirected.example.test/releases/v2/style.json',
    );

    expect(normalized).toMatchObject({
      sprite: 'https://redirected.example.test/releases/v2/sprites/base',
      glyphs: 'https://redirected.example.test/releases/fonts/{fontstack}/{range}.pbf',
      sources: {
        vector: {
          url: 'https://redirected.example.test/releases/v2/tiles.json',
          tiles: ['https://redirected.example.test/releases/tiles/{z}/{x}/{y}.pbf'],
        },
        geojson: {
          data: 'https://redirected.example.test/releases/v2/data/features.geojson',
        },
      },
      layers: [{ id: 'background', type: 'background' }],
    });
    expect(normalized.layers[0]).toBe(style.layers[0]);
    expect(style.sprite).toBe('./sprites/base');
  });
});

function createStyleService(
  style: string | maplibregl.StyleSpecification,
): MapLibreOverlayStyleService {
  return { id: 'bright/service', name: 'Bright', role: 'overlay', style };
}

function createResponse(body: unknown, options: { status?: number; url?: string } = {}): Response {
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    url: options.url ?? STYLE_URL,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('loadMapLibreOverlayStyle', () => {
  it('loads overlay style objects without fetching and clones them', async () => {
    const style = createFixture();
    const fetch = vi.fn();

    const prepared = await loadMapLibreOverlayStyle(createStyleService(style), {
      signal: new AbortController().signal,
      fetch,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(prepared.style).not.toBe(style);
    expect(style.layers[1]?.id).toBe('routes');
    expect(prepared.layerIds).toEqual([`${PREFIX}:routes`, `${PREFIX}:land`, `${PREFIX}:labels`]);
  });

  it('loads overlay styles through an async Style transform with matching Fetch parameters', async () => {
    const response = createResponse(createFixture());
    const fetch = vi.fn().mockResolvedValue(response);
    const transformRequest = vi.fn().mockResolvedValue({
      url: 'https://cdn.example.test/bright.json',
      headers: { Authorization: 'Bearer token' },
      method: 'POST',
      body: 'request body',
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const signal = new AbortController().signal;

    await loadMapLibreOverlayStyle(createStyleService('./bright.json'), {
      signal,
      transformRequest: transformRequest as never,
      fetch,
    });

    expect(transformRequest).toHaveBeenCalledWith('./bright.json', 'Style');
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.test/bright.json', {
      signal: expect.anything(),
      headers: { Authorization: 'Bearer token' },
      method: 'POST',
      body: 'request body',
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it('uses the redirected response URL as the overlay style base URL', async () => {
    const fetch = vi.fn().mockResolvedValue(
      createResponse(createFixture(), {
        url: 'https://redirected.example.test/released/bright.json',
      }),
    );

    const prepared = await loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
      signal: new AbortController().signal,
      fetch,
    });

    expect(prepared.style.sources[`${PREFIX}:earth`]).toMatchObject({
      url: 'https://redirected.example.test/released/earth.json',
    });
  });

  it('rejects non-successful overlay style responses', async () => {
    await expect(
      loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
        signal: new AbortController().signal,
        fetch: vi.fn().mockResolvedValue(createResponse({}, { status: 503 })),
      }),
    ).rejects.toThrow('MapLibre overlay style request failed: HTTP 503');
  });

  it('surfaces JSON and Style v8 errors from overlay style responses', async () => {
    const invalidJson = createResponse({});
    vi.mocked(invalidJson.json).mockRejectedValue(new SyntaxError('Unexpected token'));

    await expect(
      loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
        signal: new AbortController().signal,
        fetch: vi.fn().mockResolvedValue(invalidJson),
      }),
    ).rejects.toThrow('Unexpected token');
    await expect(
      loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
        signal: new AbortController().signal,
        fetch: vi.fn().mockResolvedValue(createResponse({ version: 7, sources: {}, layers: [] })),
      }),
    ).rejects.toThrow('MapLibre overlay styles must use version 8');
  });

  it('aborts overlay style loading with the caller AbortError', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Superseded', 'AbortError');
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const loading = loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
      signal: controller.signal,
      fetch,
    });

    controller.abort(abortError);

    await expect(loading).rejects.toBe(abortError);
  });

  it('aborts a deferred Style transform with the caller AbortError', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Superseded', 'AbortError');
    const transformRequest = vi.fn(() => new Promise<never>(() => undefined));
    const fetch = vi.fn();
    const loading = loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
      signal: controller.signal,
      transformRequest: transformRequest as never,
      fetch,
    });
    const outcome = loading.then(
      () => ({ status: 'fulfilled' }) as const,
      (reason) => ({ status: 'rejected', reason }) as const,
    );

    controller.abort(abortError);

    expect(await outcome).toEqual({ status: 'rejected', reason: abortError });
    expect(transformRequest).toHaveBeenCalledWith(STYLE_URL, 'Style');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves a pre-aborted caller error without invoking Style transforms', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Superseded', 'AbortError');
    controller.abort(abortError);
    const transformRequest = vi.fn(() => {
      throw new Error('transform must not run');
    });

    await expect(
      loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
        signal: controller.signal,
        transformRequest: transformRequest as never,
        fetch: vi.fn(),
      }),
    ).rejects.toBe(abortError);
    expect(transformRequest).not.toHaveBeenCalled();
  });

  it('times out a deferred Style transform after exactly 30000ms', async () => {
    vi.useFakeTimers();
    try {
      const transformRequest = vi.fn(() => new Promise<never>(() => undefined));
      const fetch = vi.fn();
      const loading = loadMapLibreOverlayStyle(createStyleService(STYLE_URL), {
        signal: new AbortController().signal,
        transformRequest: transformRequest as never,
        fetch,
      });
      let settled = false;
      const outcome = loading.then(
        () => {
          settled = true;
          return { status: 'fulfilled' } as const;
        },
        (reason) => {
          settled = true;
          return { status: 'rejected', reason } as const;
        },
      );

      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      expect(transformRequest).toHaveBeenCalledWith(STYLE_URL, 'Style');
      expect(fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(settled).toBe(true);
      await expect(outcome).resolves.toMatchObject({
        status: 'rejected',
        reason: { message: 'MapLibre overlay style request timed out after 30000ms' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
