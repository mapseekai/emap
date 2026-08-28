// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type * as maplibregl from 'maplibre-gl';
import type { MapLibreOverlayService, MapLibreService } from './maplibre-service';
import { createMapLibreServiceManager } from './maplibre-service-manager';

type FakeMapListener = (event?: unknown) => void;
type FakeAddFailure = {
  mode: 'throw' | 'event' | 'post-throw' | 'post-event';
  error: Error;
};

class FakeMap {
  static instances: FakeMap[] = [];
  static rebuildOnSetStyle = true;
  static constructorError: Error | null = null;
  static readonly urlStyles = new Map<string, maplibregl.StyleSpecification>();
  static constructorCalls = 0;

  readonly options: maplibregl.MapOptions;
  readonly sources = new Map<string, unknown>();
  readonly layers = new Map<string, unknown>();
  readonly layerOrder: string[] = [];
  readonly resourceSnapshots: Array<{ sources: string[]; layers: string[] }> = [];
  readonly setStyleCalls: Array<string | maplibregl.StyleSpecification | null> = [];
  readonly appliedStyles: maplibregl.StyleSpecification[] = [];
  readonly setStyleOptions: Array<
    | {
        diff?: boolean;
        transformStyle?: (
          previous: maplibregl.StyleSpecification,
          next: maplibregl.StyleSpecification,
        ) => maplibregl.StyleSpecification;
      }
    | undefined
  > = [];
  readonly operations: string[] = [];
  readonly jumpToCalls: Array<{ center: [number, number]; zoom: number }> = [];
  readonly ignoredRemovals = new Set<string>();
  readonly removeFailures = new Map<string, Error>();
  readonly addFailures = new Map<string, FakeAddFailure>();
  readonly offCalls: string[] = [];
  readonly offErrors = new Map<string, Error>();
  readonly omittedSources = new Set<string>();
  readonly omittedLayers = new Set<string>();
  resizeCalls = 0;
  removed = false;
  removeError: Error | null = null;
  nextSetStyleError: Error | null = null;
  setStyleWhileLoading = 0;
  styleLoading = true;
  styleRevision = 0;
  operationHook: ((operation: string) => void) | null = null;
  private _currentStyle: string | maplibregl.StyleSpecification | null;
  private readonly _listeners = new Map<string, Set<FakeMapListener>>();

  constructor(options: maplibregl.MapOptions) {
    FakeMap.constructorCalls++;
    if (FakeMap.constructorError) {
      const error = FakeMap.constructorError;
      FakeMap.constructorError = null;
      throw error;
    }
    this.options = options;
    this._currentStyle = options.style ?? null;
    FakeMap.instances.push(this);
    this.styleRevision = 1;
  }

  on(type: string, listener: FakeMapListener): this {
    const listeners = this._listeners.get(type) ?? new Set<FakeMapListener>();
    listeners.add(listener);
    this._listeners.set(type, listeners);
    return this;
  }

  off(type: string, listener: FakeMapListener): this {
    this.offCalls.push(type);
    this._listeners.get(type)?.delete(listener);
    const error = this.offErrors.get(type);
    if (error) throw error;
    return this;
  }

  emit(type: string, event?: unknown): void {
    if (type === 'style.load' && this._currentStyle && typeof this._currentStyle === 'object') {
      this.appliedStyles.push(structuredClone(this._currentStyle));
      for (const [id, source] of Object.entries(this._currentStyle.sources)) {
        if (!this.omittedSources.has(id)) this.sources.set(id, { id, specification: source });
      }
      for (const layer of this._currentStyle.layers) {
        if (!this.omittedLayers.has(layer.id)) {
          this.layers.set(layer.id, { id: layer.id, specification: layer });
          if (!this.layerOrder.includes(layer.id)) this.layerOrder.push(layer.id);
        }
      }
    }
    if (type === 'style.load' || type === 'error') this.styleLoading = false;
    for (const listener of [...(this._listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(type: string): number {
    return this._listeners.get(type)?.size ?? 0;
  }

  setStyle(
    style: string | maplibregl.StyleSpecification | null,
    options?: {
      diff?: boolean;
      transformStyle?: (
        previous: maplibregl.StyleSpecification,
        next: maplibregl.StyleSpecification,
      ) => maplibregl.StyleSpecification;
    },
  ): void {
    this.styleRevision++;
    if (style !== null && this.styleLoading) this.setStyleWhileLoading++;
    this.resourceSnapshots.push({
      sources: [...this.sources.keys()],
      layers: [...this.layerOrder],
    });
    this.operations.push('setStyle');
    this.setStyleCalls.push(style);
    this.setStyleOptions.push(options);
    const error = this.nextSetStyleError;
    this.nextSetStyleError = null;
    if (error && style !== null) {
      this.styleLoading = false;
      throw error;
    }
    const resolvedStyle =
      typeof style === 'string' ? (FakeMap.urlStyles.get(style) ?? style) : style;
    const sameStyle = JSON.stringify(resolvedStyle) === JSON.stringify(this._currentStyle);
    const nextStyle =
      resolvedStyle && typeof resolvedStyle === 'object'
        ? options?.transformStyle
          ? options.transformStyle(
              typeof this._currentStyle === 'object' && this._currentStyle
                ? structuredClone(this._currentStyle)
                : EMPTY_STYLE,
              structuredClone(resolvedStyle),
            )
          : structuredClone(resolvedStyle)
        : resolvedStyle;
    this._currentStyle = nextStyle;
    if (style !== null && sameStyle && options?.diff !== false) {
      this.styleLoading = false;
      return;
    }
    this.styleLoading = style !== null;
    if (style === null || FakeMap.rebuildOnSetStyle) {
      this.sources.clear();
      this.layers.clear();
      this.layerOrder.length = 0;
    }
    if (nextStyle && typeof nextStyle === 'object') {
      this.appliedStyles.push(nextStyle);
      for (const [id, source] of Object.entries(nextStyle.sources)) {
        if (!this.omittedSources.has(id)) this.sources.set(id, { id, specification: source });
      }
      for (const layer of nextStyle.layers) {
        if (!this.omittedLayers.has(layer.id)) {
          this.layers.set(layer.id, { id: layer.id, specification: layer });
          this.layerOrder.push(layer.id);
        }
      }
    }
  }

  getStyle(): maplibregl.StyleSpecification {
    if (!this._currentStyle || typeof this._currentStyle === 'string') return EMPTY_STYLE;
    return structuredClone(this._currentStyle);
  }

  delayedStyleLoad(): () => void {
    const revision = this.styleRevision;
    return () => {
      if (revision === this.styleRevision) this.emit('style.load');
    };
  }

  captureStyleLoadListener(): FakeMapListener {
    const listener = [...(this._listeners.get('style.load') ?? [])].at(-1);
    if (!listener) throw new Error('style.load listener is unavailable');
    return listener;
  }

  addSource(id: string, source: maplibregl.SourceSpecification): void {
    const operation = `addSource:${id}`;
    this.operations.push(operation);
    this.operationHook?.(operation);
    const failure = this.addFailures.get(`source:${id}`);
    if (failure) {
      this.addFailures.delete(`source:${id}`);
      if (failure.mode === 'event') {
        this.emit('error', { error: failure.error });
        return;
      }
      if (failure.mode === 'throw') throw failure.error;
    }
    this.sources.set(id, { id, specification: source });
    if (failure?.mode === 'post-event') this.emit('error', { error: failure.error });
    else if (failure?.mode === 'post-throw') throw failure.error;
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  removeSource(id: string): void {
    this.operations.push(`removeSource:${id}`);
    const failure = this.removeFailures.get(`source:${id}`);
    if (failure) {
      this.removeFailures.delete(`source:${id}`);
      throw failure;
    }
    if (this.ignoredRemovals.has(id)) return;
    this.sources.delete(id);
  }

  addLayer(layer: maplibregl.LayerSpecification, beforeId?: string): void {
    const operation = `addLayer:${layer.id}:${beforeId ?? ''}`;
    this.operations.push(operation);
    this.operationHook?.(operation);
    const failure = this.addFailures.get(`layer:${layer.id}`);
    if (failure) {
      this.addFailures.delete(`layer:${layer.id}`);
      if (failure.mode === 'event') {
        this.emit('error', { error: failure.error });
        return;
      }
      if (failure.mode === 'throw') throw failure.error;
    }
    this.layers.set(layer.id, { id: layer.id, specification: layer });
    const beforeIndex = beforeId === undefined ? -1 : this.layerOrder.indexOf(beforeId);
    if (beforeIndex === -1) this.layerOrder.push(layer.id);
    else this.layerOrder.splice(beforeIndex, 0, layer.id);
    if (failure?.mode === 'post-event') this.emit('error', { error: failure.error });
    else if (failure?.mode === 'post-throw') throw failure.error;
  }

  getLayer(id: string): unknown {
    return this.layers.get(id);
  }
  setLayoutProperty(id: string, name: 'visibility', value: 'visible' | 'none'): void {
    const operation = `setLayoutProperty:${id}:${name}:${value}`;
    this.operations.push(operation);
    this.operationHook?.(operation);
    const layer = this.layers.get(id) as
      | { id: string; specification: maplibregl.LayerSpecification }
      | undefined;
    if (!layer) throw new Error(`Layer "${id}" does not exist`);
    layer.specification = {
      ...layer.specification,
      layout: { ...layer.specification.layout, [name]: value },
    };
  }

  removeLayer(id: string): void {
    this.operations.push(`removeLayer:${id}`);
    const failure = this.removeFailures.get(`layer:${id}`);
    if (failure) {
      this.removeFailures.delete(`layer:${id}`);
      throw failure;
    }
    if (this.ignoredRemovals.has(id)) return;
    this.layers.delete(id);
    const index = this.layerOrder.indexOf(id);
    if (index !== -1) this.layerOrder.splice(index, 1);
  }

  jumpTo(options: { center: [number, number]; zoom: number }): void {
    this.jumpToCalls.push(options);
  }

  resize(): void {
    this.resizeCalls++;
  }

  remove(): void {
    this.removed = true;
    if (this.removeError) throw this.removeError;
  }
}

const base = {
  id: 'light',
  name: 'Light',
  role: 'basemap',
  style: 'https://example.test/light.json',
} as const;

const dark = {
  ...base,
  id: 'dark',
  name: 'Dark',
  style: 'https://example.test/dark.json',
} as const;

const streets = {
  ...base,
  id: 'streets',
  name: 'Streets',
  style: 'https://example.test/streets.json',
} as const;

const roads = {
  id: 'roads',
  name: 'Roads',
  role: 'overlay',
  sources: {
    roads: { type: 'vector', url: 'https://example.test/roads.json' },
  },
  layers: [{ id: 'roads-line', type: 'line', source: 'roads', 'source-layer': 'roads' }],
} as const satisfies MapLibreOverlayService;

const traffic = {
  id: 'traffic',
  name: 'Traffic',
  role: 'overlay',
  sources: {
    traffic: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'traffic-casing', type: 'line', source: 'traffic' },
    { id: 'traffic-line', type: 'line', source: 'traffic' },
  ],
} as const satisfies MapLibreOverlayService;

const labels = {
  id: 'labels',
  name: 'Labels',
  role: 'overlay',
  sources: {
    labels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [{ id: 'labels-symbol', type: 'symbol', source: 'labels' }],
} as const satisfies MapLibreOverlayService;

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
const brightStyle = {
  version: 8,
  sprite: 'https://tiles.openfreemap.org/styles/sprite',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    land: { type: 'vector', url: 'https://tiles.openfreemap.org/land.json' },
    places: { type: 'vector', url: 'https://tiles.openfreemap.org/places.json' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'land', type: 'fill', source: 'land', 'source-layer': 'land' },
    { id: 'roads', type: 'line', source: 'land', 'source-layer': 'roads' },
    { id: 'places', type: 'symbol', source: 'places', 'source-layer': 'places' },
  ],
} as const satisfies maplibregl.StyleSpecification;

const objectBasemap = {
  ...base,
  style: {
    version: 8,
    sources: {
      base: { type: 'vector', url: 'https://example.test/base.json' },
    },
    layers: [{ id: 'base-fill', type: 'fill', source: 'base' }],
  },
} as const satisfies MapLibreService;

function fakeModule(): typeof import('maplibre-gl') {
  return { Map: FakeMap } as unknown as typeof import('maplibre-gl');
}

function createHost(initialCrs = 'webmercator') {
  const canvasContainer = document.createElement('div');
  canvasContainer.append(document.createElement('canvas'));
  document.body.append(canvasContainer);
  const listeners = new Map<string, Set<() => void>>();
  let crs = initialCrs;
  const host = {
    getCanvasContainer: vi.fn(() => canvasContainer),
    getCRS: vi.fn(() => crs),
    reproject: vi.fn(async (nextCrs: string) => {
      crs = nextCrs;
    }),
    getCenter: vi.fn(() => [120, 30] as [number, number]),
    getZoom: vi.fn(() => 4),
    on: vi.fn((type: string, listener: () => void) => {
      const eventListeners = listeners.get(type) ?? new Set<() => void>();
      eventListeners.add(listener);
      listeners.set(type, eventListeners);
    }),
    off: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    emit(type: 'move' | 'resize' | 'crschange') {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    setCRS(nextCrs: string) {
      crs = nextCrs;
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  return host;
}

function createManager(
  services: readonly MapLibreService[] = [],
  options: {
    crs?: string;
    defaultBasemap?: string;
    mapOptions?: maplibregl.MapOptions;
    fetchStyle?: typeof fetch;
  } = {},
) {
  FakeMap.urlStyles.clear();
  FakeMap.constructorCalls = 0;
  FakeMap.instances.length = 0;
  FakeMap.rebuildOnSetStyle = true;
  FakeMap.constructorError = null;
  const host = createHost(options.crs);
  const loadMapLibre = vi.fn(
    async () => ({ Map: FakeMap }) as unknown as typeof import('maplibre-gl'),
  );
  const manager = createMapLibreServiceManager(
    host,
    {
      services,
      defaultBasemap: options.defaultBasemap,
      mapOptions: options.mapOptions,
    },
    loadMapLibre,
    options.fetchStyle,
  );
  return { host, loadMapLibre, manager };
}

async function waitForFakeMap(index = 0): Promise<FakeMap> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const map = FakeMap.instances[index];
    if (map) return map;
    await Promise.resolve();
  }
  throw new Error('FakeMap was not constructed');
}

async function waitForCondition(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

async function activateOverlay(
  manager: ReturnType<typeof createMapLibreServiceManager>,
  id = 'roads',
): Promise<FakeMap> {
  const activation = manager.setOverlayVisibility(id, true);
  const map = await waitForFakeMap();
  map.emit('style.load');
  await activation;
  return map;
}

describe('MapLibreServiceManager registry', () => {
  it('does not load MapLibre when construction has no visible service', () => {
    const { host, loadMapLibre, manager } = createManager();

    host.emit('resize');

    expect(host.listenerCount('resize')).toBe(0);
    expect(loadMapLibre).not.toHaveBeenCalled();
    expect(FakeMap.constructorCalls).toBe(0);
    expect(manager.getMapLibreMap()).toBeNull();
  });

  it('registers an inactive style overlay without loading MapLibre', () => {
    const styleOverlay = {
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      style: 'https://tiles.openfreemap.org/styles/bright',
    } as const;
    const { loadMapLibre, manager } = createManager([styleOverlay]);

    expect(manager.getServices()).toEqual([styleOverlay]);
    expect(loadMapLibre).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'mixed', name: 'Mixed', role: 'overlay', style: EMPTY_STYLE, sources: {}, layers: [] },
    { id: 'missing', name: 'Missing', role: 'overlay' },
  ])('rejects an invalid overlay form for $id', (service) => {
    expect(() => createManager([service as MapLibreService])).toThrow(
      /exactly one of style or sources\/layers/,
    );
  });

  it('adds cloned inactive services and emits one add snapshot', async () => {
    const { manager } = createManager();
    const changes: Array<{ serviceId: string; reason: string; active: boolean }> = [];
    manager.on('change', (event) =>
      changes.push({
        serviceId: event.serviceId,
        reason: event.reason,
        active: event.state?.active ?? true,
      }),
    );

    await manager.addService(base);
    await manager.addService(roads);
    const services = manager.getServices();
    (services[1] as MapLibreOverlayService).sources.roads.url = 'changed';

    expect(changes).toEqual([
      { serviceId: 'light', reason: 'add', active: false },
      { serviceId: 'roads', reason: 'add', active: false },
    ]);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: false,
      status: 'idle',
    });
    expect((manager.getServices()[1] as MapLibreOverlayService).sources.roads.url).toBe(
      'https://example.test/roads.json',
    );
  });

  it('rejects duplicate service ids without mutating the registry', async () => {
    const { manager } = createManager([base]);

    await expect(manager.addService({ ...base, name: 'Duplicate' })).rejects.toThrow(
      'MapLibre service "light" already exists',
    );
    expect(manager.getServices()).toEqual([base]);
  });

  it('requires overlay source and layer ids to be globally unique', async () => {
    const { manager } = createManager([roads]);
    const duplicateSource = {
      ...roads,
      id: 'traffic',
      sources: { roads: { type: 'vector' as const, url: 'https://example.test/traffic.json' } },
      layers: [{ id: 'traffic-line', type: 'line' as const, source: 'roads' }],
    };
    const duplicateLayer = {
      ...roads,
      id: 'labels',
      sources: { labels: { type: 'vector' as const, url: 'https://example.test/labels.json' } },
      layers: [{ id: 'roads-line', type: 'line' as const, source: 'labels' }],
    };

    await expect(manager.addService(duplicateSource)).rejects.toThrow(
      'MapLibre overlay source "roads" already exists',
    );
    await expect(manager.addService(duplicateLayer)).rejects.toThrow(
      'MapLibre overlay layer "roads-line" already exists',
    );
    expect(manager.getServices()).toHaveLength(1);
  });

  it('validates native layer source references and source-required layers', async () => {
    const { manager } = createManager();
    const background = {
      id: 'background',
      name: 'Background',
      role: 'overlay',
      sources: {},
      layers: [{ id: 'background-fill', type: 'background' }],
    } as const satisfies MapLibreOverlayService;
    const unknownSource = {
      ...roads,
      id: 'unknown-source',
      layers: [{ id: 'unknown-source-line', type: 'line' as const, source: 'other' }],
    };
    const missingSource = {
      ...roads,
      id: 'missing-source',
      layers: [{ id: 'missing-source-line', type: 'line' as const }],
    };

    await expect(manager.addService(background)).resolves.toBeUndefined();
    await expect(manager.addService(unknownSource)).rejects.toThrow(
      'MapLibre overlay layer "unknown-source-line" references unknown source "other"',
    );
    await expect(manager.addService(missingSource)).rejects.toThrow(
      'MapLibre overlay layer "missing-source-line" requires a source',
    );
  });

  it('updates in place and rejects identifier or role changes', async () => {
    const secondBase = { ...base, id: 'dark', name: 'Dark' } as const;
    const { manager } = createManager([base, roads, secondBase]);

    await manager.updateService('roads', { ...roads, name: 'Updated roads' });

    expect(manager.getServices().map((service) => service.id)).toEqual(['light', 'roads', 'dark']);
    expect(manager.getServices()[1].name).toBe('Updated roads');
    await expect(manager.updateService('roads', { ...base, id: 'roads' })).rejects.toThrow(
      'MapLibre service role cannot change',
    );
    await expect(manager.updateService('roads', { ...roads, id: 'other' })).rejects.toThrow(
      'MapLibre service id must match "roads"',
    );
  });

  it('keeps inactive update and removal registry-only', async () => {
    const { manager, loadMapLibre } = createManager([roads]);

    await manager.updateService('roads', { ...roads, name: 'Renamed roads', visible: true });
    await manager.removeService('roads');

    expect(loadMapLibre).not.toHaveBeenCalled();
    expect(manager.getServices()).toEqual([]);
  });

  it('rejects unknown ids and role-mismatched operations with stable errors', async () => {
    const { manager } = createManager([base, roads]);

    await expect(manager.removeService('missing')).rejects.toThrow(
      'MapLibre service "missing" does not exist',
    );
    await expect(manager.setBasemap('roads')).rejects.toThrow(
      'MapLibre service "roads" is not a basemap',
    );
    await expect(manager.setOverlayVisibility('light', true)).rejects.toThrow(
      'MapLibre service "light" is not an overlay',
    );
  });

  it('rejects invalid initial services and default basemaps synchronously', () => {
    const host = createHost();
    const loader = vi.fn(async () => ({}) as typeof import('maplibre-gl'));

    expect(() => createMapLibreServiceManager(host, { services: [base, base] }, loader)).toThrow(
      'MapLibre service "light" already exists',
    );
    expect(() =>
      createMapLibreServiceManager(host, { services: [{ ...base, id: '' }] }, loader),
    ).toThrow('MapLibre service id must be a non-empty string');
    expect(() => createMapLibreServiceManager(host, { defaultBasemap: 'missing' }, loader)).toThrow(
      'MapLibre default basemap "missing" does not exist',
    );
    expect(() =>
      createMapLibreServiceManager(host, { services: [roads], defaultBasemap: 'roads' }, loader),
    ).toThrow('MapLibre default basemap "roads" is not a basemap');
  });

  it('normalizes throwing lifecycle listeners into non-fatal error events', async () => {
    const { manager } = createManager();
    const errors: Array<{ phase: string; fatal: boolean; message: string }> = [];
    manager.on('change', () => {
      throw new Error('listener failed');
    });
    manager.on('error', (event) =>
      errors.push({
        phase: event.phase,
        fatal: event.fatal,
        message: event.error.message,
      }),
    );

    await manager.addService(base);

    expect(errors).toEqual([{ phase: 'lifecycle', fatal: false, message: 'listener failed' }]);
  });

  it('preserves overlay active intent across visible-hint updates', async () => {
    const { manager } = createManager([roads]);

    await manager.updateService('roads', { ...roads, visible: true });
    expect(manager.getServiceState('roads')).toMatchObject({ active: false });
    const activation = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    map.emit('style.load');
    await activation;
    await manager.updateService('roads', { ...roads, name: 'Current overlay', visible: false });

    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'ready' });
  });

  it('atomically switches the active basemap and emits snapshots for both services', async () => {
    const dark = { ...base, id: 'dark', name: 'Dark' } as const;
    const { manager } = createManager([base, dark]);
    const changes: Array<{ serviceId: string; active: boolean }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'basemap' && event.state) {
        changes.push({ serviceId: event.serviceId, active: event.state.active });
      }
    });

    const light = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await light;
    const darkRequest = manager.setBasemap('dark');
    map.emit('style.load');
    await darkRequest;
    await manager.setBasemap(null);

    expect(changes).toEqual([
      { serviceId: 'light', active: true },
      { serviceId: 'light', active: false },
      { serviceId: 'dark', active: true },
      { serviceId: 'dark', active: false },
    ]);
    expect(manager.getServiceState('dark')).toEqual({ id: 'dark', active: false, status: 'idle' });
  });
});

describe('MapLibreServiceManager basemap style coordinator', () => {
  it('composes OpenFreeMap Bright without replacing the active basemap', async () => {
    const fetchStyle = vi.fn(async () => new Response(JSON.stringify(brightStyle)));
    const { manager } = createManager([{ ...roads, visible: true }, objectBasemap], { fetchStyle });
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    const addition = manager.addService({
      id: 'openfreemap-bright',
      name: 'OpenFreeMap Bright',
      role: 'overlay',
      visible: true,
      style: 'https://tiles.openfreemap.org/styles/bright',
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style overlay was not composed');
    map.emit('style.load');
    await addition;

    const style = map.appliedStyles.at(-1);
    expect(style?.layers.map((layer) => layer.id)).toEqual([
      'base-fill',
      'emap-overlay:openfreemap-bright:land',
      'emap-overlay:openfreemap-bright:roads',
      'emap-overlay:openfreemap-bright:places',
    ]);
    expect(map.layerOrder).toEqual([
      'base-fill',
      'roads-line',
      'emap-overlay:openfreemap-bright:land',
      'emap-overlay:openfreemap-bright:roads',
      'emap-overlay:openfreemap-bright:places',
    ]);
    expect(style?.sources).toMatchObject({
      'emap-overlay:openfreemap-bright:land': brightStyle.sources.land,
      'emap-overlay:openfreemap-bright:places': brightStyle.sources.places,
    });
    expect(style?.sprite).toEqual([
      { id: 'emap-overlay:openfreemap-bright:default', url: brightStyle.sprite },
    ]);
    expect(style?.glyphs).toBe(brightStyle.glyphs);
    expect(manager.getServiceState('openfreemap-bright')).toMatchObject({ status: 'ready' });
    expect(
      manager.getServices().find((service) => service.id === 'openfreemap-bright'),
    ).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/bright',
    });
  });

  it('composes a URL basemap from its redirected resource base', async () => {
    const basemapStyle = {
      version: 8,
      sprite: './sprites/base',
      glyphs: '../fonts/{fontstack}/{range}.pbf',
      sources: {
        base: {
          type: 'vector',
          url: './tiles.json',
          tiles: ['../tiles/{z}/{x}/{y}.pbf'],
        },
        geojson: { type: 'geojson', data: './data/features.geojson' },
      },
      layers: [{ id: 'background', type: 'background' }],
    } as const satisfies maplibregl.StyleSpecification;
    const finalUrl = 'https://redirected.example.test/releases/v2/style.json';
    const fetchStyle = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          url: finalUrl,
          json: async () => basemapStyle,
        }) as Response,
    );
    const transformRequest = vi.fn((url: string) => ({
      url: `https://cdn.example.test/proxy?style=${encodeURIComponent(url)}`,
    }));
    const { manager } = createManager(
      [
        {
          id: 'redirected',
          name: 'Redirected',
          role: 'basemap',
          style: 'https://origin.example.test/style.json',
        },
        {
          id: 'labels',
          name: 'Labels',
          role: 'overlay',
          visible: true,
          style: {
            version: 8,
            glyphs: 'https://redirected.example.test/releases/fonts/{fontstack}/{range}.pbf',
            sources: {
              labels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
            },
            layers: [{ id: 'labels', type: 'symbol', source: 'labels' }],
          },
        },
      ],
      { fetchStyle, mapOptions: { transformRequest: transformRequest as never } },
    );

    const loading = manager.setBasemap('redirected');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await loading;

    expect(transformRequest).toHaveBeenCalledWith(
      'https://origin.example.test/style.json',
      'Style',
    );
    expect(fetchStyle).toHaveBeenCalledWith(
      'https://cdn.example.test/proxy?style=https%3A%2F%2Forigin.example.test%2Fstyle.json',
      expect.objectContaining({ method: undefined }),
    );
    const composed = map.getStyle();
    expect(composed.sprite).toBe('https://redirected.example.test/releases/v2/sprites/base');
    expect(composed.glyphs).toBe(
      'https://redirected.example.test/releases/fonts/{fontstack}/{range}.pbf',
    );
    expect(composed.sources.base).toMatchObject({
      url: 'https://redirected.example.test/releases/v2/tiles.json',
      tiles: ['https://redirected.example.test/releases/tiles/{z}/{x}/{y}.pbf'],
    });
    expect(composed.sources.geojson).toMatchObject({
      data: 'https://redirected.example.test/releases/v2/data/features.geojson',
    });
    expect(composed.layers[0]).toMatchObject({ id: 'background', type: 'background' });
    expect(map.getLayer('emap-overlay:labels:labels')).toBeDefined();
  });

  it.each([
    ['source', 'emap-overlay:openfreemap-bright:land'],
    ['layer', 'emap-overlay:openfreemap-bright:land'],
  ] as const)('rejects a composite style when an expected %s handle is missing', async (kind, id) => {
    const fetchStyle = vi.fn(async () => new Response(JSON.stringify(brightStyle)));
    const { manager } = createManager([objectBasemap], { fetchStyle });
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const errors: Array<{ phase: string; serviceId: string | undefined }> = [];
    const statuses: string[] = [];
    manager.on('error', (event) => errors.push({ phase: event.phase, serviceId: event.serviceId }));
    manager.on('change', (event) => {
      if (event.serviceId === 'openfreemap-bright' && event.reason === 'status' && event.state) {
        statuses.push(event.state.status);
      }
    });
    if (kind === 'source') map.omittedSources.add(id);
    else map.omittedLayers.add(id);

    const addition = manager.addService({
      id: 'openfreemap-bright',
      name: 'OpenFreeMap Bright',
      role: 'overlay',
      visible: true,
      style: 'https://tiles.openfreemap.org/styles/bright',
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style overlay was not composed');
    map.emit('style.load');

    await expect(addition).rejects.toThrow(`MapLibre overlay ${kind} "${id}" was not composed`);
    expect(errors).toEqual([{ phase: kind, serviceId: 'openfreemap-bright' }]);
    expect(statuses).not.toContain('ready');
    expect(manager.getServiceState('openfreemap-bright')).toMatchObject({ status: 'error' });
  });

  it('commits one selected basemap and publishes old then new snapshots', async () => {
    const { manager } = createManager([base, dark]);
    const changes: Array<{ id: string; active: boolean; status: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'basemap' && event.state) {
        changes.push({
          id: event.serviceId,
          active: event.state.active,
          status: event.state.status,
        });
      }
    });

    const lightRequest = manager.setBasemap('light');
    const map = await waitForFakeMap();
    expect(map.options.style).toBe(base.style);
    map.emit('style.load');
    await lightRequest;

    const darkRequest = manager.setBasemap('dark');
    expect(map.setStyleCalls).toEqual([dark.style]);
    map.emit('style.load');
    await darkRequest;

    await manager.setBasemap(null);

    expect(changes).toEqual([
      { id: 'light', active: true, status: 'loading' },
      { id: 'light', active: false, status: 'idle' },
      { id: 'dark', active: true, status: 'loading' },
      { id: 'dark', active: false, status: 'idle' },
    ]);
    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    expect((map.options.container as HTMLElement).hidden).toBe(true);
  });

  it('removes the active basemap without auto-selecting a sibling', async () => {
    const { manager } = createManager([base, dark]);
    const activation = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await activation;

    await manager.removeService('light');

    expect(manager.getServices()).toEqual([dark]);
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    expect((map.options.container as HTMLElement).hidden).toBe(true);
  });

  it('cancels a pre-construction basemap and later creates an explicitly blank overlay style', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const loadMapLibre = vi.fn(() => moduleLoad.promise);
    const manager = createMapLibreServiceManager(
      createHost(),
      { services: [base, roads] },
      loadMapLibre,
    );

    const basemap = manager.setBasemap('light').catch((error: unknown) => error);
    await Promise.resolve();
    const clear = manager.setBasemap(null);
    moduleLoad.resolve(fakeModule());

    await expect(basemap).resolves.toMatchObject({ name: 'AbortError' });
    await clear;
    expect(FakeMap.instances).toHaveLength(0);

    const overlay = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    expect(map.options.style).toEqual({ version: 8, sources: {}, layers: [] });
    map.emit('style.load');
    await overlay;
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it.each([
    true,
    false,
  ])('detaches overlays before a style switch and reconciles registry order (rebuild=%s)', async (rebuildOnSetStyle) => {
    const { manager } = createManager([base, roads, traffic]);
    FakeMap.rebuildOnSetStyle = rebuildOnSetStyle;
    const roadsActivation = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    map.emit('style.load');
    await roadsActivation;
    await manager.setOverlayVisibility('traffic', true);
    map.sources.set('unmanaged', { id: 'unmanaged' });
    map.layers.set('unmanaged-layer', { id: 'unmanaged-layer' });
    map.layerOrder.unshift('unmanaged-layer');
    map.operations.length = 0;

    const switchRequest = manager.setBasemap('light');

    expect(map.operations.slice(-1)).toEqual(['setStyle']);
    expect(map.resourceSnapshots.at(-1)).toEqual({
      sources: ['unmanaged'],
      layers: ['unmanaged-layer'],
    });
    expect(map.operations.slice(0, -1)).toEqual([
      'removeLayer:traffic-line',
      'removeLayer:traffic-casing',
      'removeLayer:roads-line',
      'removeSource:roads',
      'removeSource:traffic',
    ]);
    map.emit('style.load');
    await switchRequest;

    expect(map.layerOrder.filter((id) => id !== 'unmanaged-layer')).toEqual([
      'roads-line',
      'traffic-casing',
      'traffic-line',
    ]);
    expect(map.operations.filter((operation) => operation === 'addSource:roads')).toHaveLength(1);
    expect(map.operations.filter((operation) => operation === 'addSource:traffic')).toHaveLength(1);
  });

  it('serializes rapid requests and commits only the latest desired revision', async () => {
    const { manager } = createManager([base, dark, streets]);
    const first = manager.setBasemap('light').catch((error: unknown) => error);
    const map = await waitForFakeMap();
    const second = manager.setBasemap('dark').catch((error: unknown) => error);
    const third = manager.setBasemap('streets');

    expect(map.setStyleCalls).toEqual([]);
    await expect(first).resolves.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ name: 'AbortError' });

    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'latest style request did not start after the initial terminal event',
    );
    expect(map.setStyleCalls).toEqual([streets.style]);
    expect(map.setStyleWhileLoading).toBe(0);
    map.emit('style.load');
    await third;

    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('streets')).toEqual({
      id: 'streets',
      active: true,
      status: 'ready',
    });
  });

  it('initializes the configured default basemap and visible overlays in one style cycle', async () => {
    const { manager } = createManager(
      [base, { ...roads, visible: true }, { ...labels, visible: true }],
      { defaultBasemap: 'light' },
    );

    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    expect(map.options.style).toBe(base.style);
    expect(map.setStyleCalls).toEqual([]);
    map.emit('style.load');
    await initialization;

    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: true,
      status: 'ready',
    });
    expect(map.layerOrder).toEqual(['roads-line', 'labels-symbol']);
    expect(map.setStyleCalls).toEqual([]);
  });

  it('publishes a recovered visible overlay as ready after the initial basemap style fails', async () => {
    const { manager } = createManager([base, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const statuses: string[] = [];
    manager.on('change', (event) => {
      if (event.serviceId === 'roads' && event.reason === 'status' && event.state) {
        statuses.push(event.state.status);
      }
    });
    const styleError = new Error('initial basemap style failed');
    const initialization = manager.initialize().catch((error: unknown) => error);
    const map = await waitForFakeMap();

    map.emit('error', { error: styleError });
    await waitForCondition(() => {
      const style = map.setStyleCalls.at(-1);
      return typeof style === 'object' && style !== null;
    }, 'blank recovery did not start after the initial basemap failure');
    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'error' });

    map.emit('style.load');
    await expect(initialization).resolves.toBe(styleError);
    await waitForCondition(
      () => manager.getServiceState('roads')?.status === 'ready',
      'reinstalled overlay did not publish ready state',
    );

    expect([...map.sources.keys()]).toEqual(['roads']);
    expect(map.layerOrder).toEqual(['roads-line']);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(statuses).toEqual(['error', 'loading', 'ready']);
  });

  it('publishes ready when a recovery loading listener selects a newer basemap', async () => {
    const { manager } = createManager([base, dark, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const statuses: string[] = [];
    let replacement: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (event.serviceId !== 'roads' || event.reason !== 'status' || !event.state) return;
      statuses.push(event.state.status);
      if (event.state.status === 'loading' && !replacement) {
        replacement = manager.setBasemap('dark');
      }
    });
    const styleError = new Error('initial basemap style failed');
    const initialization = manager.initialize().catch((error: unknown) => error);
    const map = await waitForFakeMap();

    map.emit('error', { error: styleError });
    await waitForCondition(() => {
      const style = map.setStyleCalls.at(-1);
      return typeof style === 'object' && style !== null;
    }, 'blank recovery did not start after the initial basemap failure');
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === dark.style,
      'listener-selected basemap did not replace blank recovery',
    );

    map.emit('style.load');
    await expect(initialization).resolves.toBe(styleError);
    await replacement;

    expect([...map.sources.keys()]).toEqual(['roads']);
    expect(map.layerOrder).toEqual(['roads-line']);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(manager.getServiceState('dark')).toMatchObject({ active: true, status: 'ready' });
    expect(statuses).toEqual(['error', 'loading', 'ready']);
  });

  it('does not overwrite a source error raised after coordinator installation with ready', async () => {
    const { manager } = createManager([base, dark, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const statuses: string[] = [];
    let replacement: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (event.serviceId !== 'roads' || event.reason !== 'status' || !event.state) return;
      statuses.push(event.state.status);
      if (event.state.status === 'loading' && !replacement) {
        replacement = manager.setBasemap('dark');
      }
    });
    const styleError = new Error('initial basemap style failed');
    const sourceError = new Error('roads source failed after installation');
    const initialization = manager.initialize().catch((error: unknown) => error);
    const map = await waitForFakeMap();

    map.emit('error', { error: styleError });
    await waitForCondition(() => {
      const style = map.setStyleCalls.at(-1);
      return typeof style === 'object' && style !== null;
    }, 'blank recovery did not start after the initial basemap failure');
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === dark.style,
      'listener-selected basemap did not replace blank recovery',
    );
    map.on('style.load', () => {
      if (map.getSource('roads') !== undefined) {
        map.emit('error', { sourceId: 'roads', error: sourceError });
      }
    });

    map.emit('style.load');
    await expect(initialization).resolves.toBe(styleError);
    await replacement;

    expect([...map.sources.keys()]).toEqual(['roads']);
    expect(map.layerOrder).toEqual(['roads-line']);
    expect(manager.getServiceState('roads')).toMatchObject({
      active: true,
      status: 'error',
      error: { message: 'roads source failed after installation' },
    });
    expect(statuses).toEqual(['error', 'loading', 'error']);
  });

  it('does not overwrite a source error raised after independent activation installation with ready', async () => {
    const { manager } = createManager([roads]);
    const statuses: string[] = [];
    manager.on('change', (event) => {
      if (event.serviceId === 'roads' && event.reason === 'status' && event.state) {
        statuses.push(event.state.status);
      }
    });
    const sourceError = new Error('roads source failed after activation installation');
    const activation = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    map.on('style.load', () => {
      if (map.getSource('roads') !== undefined) {
        map.emit('error', { sourceId: 'roads', error: sourceError });
      }
    });

    map.emit('style.load');
    await activation;

    expect([...map.sources.keys()]).toEqual(['roads']);
    expect(map.layerOrder).toEqual(['roads-line']);
    expect(manager.getServiceState('roads')).toMatchObject({
      active: true,
      status: 'error',
      error: { message: 'roads source failed after activation installation' },
    });
    expect(statuses).toEqual(['loading', 'error']);
  });

  it('treats constructor style readiness as the first in-flight request', async () => {
    const { manager } = createManager([base, roads]);
    const overlay = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    const basemap = manager.setBasemap('light');

    expect(map.options.style).toEqual({ version: 8, sources: {}, layers: [] });
    expect(map.setStyleCalls).toEqual([]);
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'basemap switch did not wait for initial blank style readiness',
    );
    expect(map.setStyleCalls).toEqual([base.style]);
    expect(map.layerOrder).toEqual([]);
    map.emit('style.load');
    await Promise.all([overlay, basemap]);
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('ignores an obsolete physical style error and continues the newest request', async () => {
    const { manager } = createManager([base, dark, streets]);
    const first = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await first;

    const errors: string[] = [];
    const changes: string[] = [];
    let darkInactiveState: { active: boolean; status: string; error?: Error } | undefined;
    manager.on('error', (event) => errors.push(`${event.phase}:${event.error.message}`));
    manager.on('change', (event) => {
      changes.push(`${event.reason}:${event.serviceId}`);
      if (event.reason === 'basemap' && event.serviceId === 'dark' && !event.state?.active) {
        darkInactiveState = event.state;
      }
    });
    const obsolete = manager.setBasemap('dark').catch((error: unknown) => error);
    const latest = manager.setBasemap('streets');
    expect(darkInactiveState).toMatchObject({ active: false, status: 'idle' });
    expect(darkInactiveState?.error).toBeUndefined();
    changes.length = 0;

    map.emit('error', { error: new Error('obsolete dark failed') });
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === streets.style,
      'latest style did not start after obsolete error',
    );

    expect(errors).toEqual([]);
    expect(changes).toEqual([]);
    await expect(obsolete).resolves.toMatchObject({ name: 'AbortError' });
    expect(map.setStyleCalls.slice(-2)).toEqual([null, streets.style]);
    map.emit('style.load');
    await latest;
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('streets')).toMatchObject({ active: true, status: 'ready' });
  });

  it('recovers blank after a committed null request instead of reviving an older basemap', async () => {
    const { manager } = createManager([base, dark, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;

    const clear = manager.setBasemap(null);
    expect(map.setStyleCalls.at(-1)).toEqual({ version: 8, sources: {}, layers: [] });
    map.emit('style.load');
    await clear;

    const failure = new Error('dark style failed');
    const selection = manager.setBasemap('dark').catch((error: unknown) => error);
    map.emit('error', { error: failure });
    await waitForCondition(() => {
      const last = map.setStyleCalls.at(-1);
      return typeof last === 'object' && last !== null;
    }, 'blank recovery did not start');
    map.emit('style.load');

    await expect(selection).resolves.toBe(failure);
    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('dark')).toMatchObject({
      active: false,
      status: 'error',
      error: { message: 'dark style failed' },
    });
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('abandons parsed reconciliation when a listener selects a newer basemap', async () => {
    const { manager } = createManager([base, dark, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    const darkRequest = manager.setBasemap('dark').catch((error: unknown) => error);
    let recovery: Promise<void> | undefined;
    map.operationHook = (operation) => {
      if (operation !== 'addSource:roads' || recovery) return;
      recovery = manager.setBasemap('light');
      map.operationHook = null;
    };

    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === base.style,
      'new basemap did not take over parsed reconciliation',
    );

    await expect(darkRequest).resolves.toMatchObject({ name: 'AbortError' });
    expect(map.layers.has('roads-line')).toBe(false);
    map.emit('style.load');
    await recovery;
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('light')).toMatchObject({ active: true, status: 'ready' });
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('keeps overlay operations current across an obsolete basemap generation', async () => {
    const updatedLabels = {
      ...labels,
      name: 'Updated labels',
      layers: [{ id: 'labels-updated', type: 'symbol' as const, source: 'labels' }],
    };
    const { manager } = createManager([base, dark, streets, roads, { ...labels, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;

    const obsolete = manager.setBasemap('dark').catch((error: unknown) => error);
    const show = manager.setOverlayVisibility('roads', true);
    const update = manager.updateService('labels', updatedLabels);
    const latest = manager.setBasemap('streets');
    map.operations.length = 0;

    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === streets.style,
      'latest style did not start after obsolete parsed generation',
    );
    expect(map.operations.at(-1)).toBe('setStyle');
    expect(map.operations.some((operation) => operation.startsWith('add'))).toBe(false);
    map.emit('style.load');

    await expect(obsolete).resolves.toMatchObject({ name: 'AbortError' });
    await Promise.all([show, update, latest]);
    expect(map.layerOrder).toEqual(['roads-line', 'labels-updated']);
    expect(map.operations.filter((operation) => operation === 'addSource:roads')).toHaveLength(1);
    expect(map.operations.filter((operation) => operation === 'addSource:labels')).toHaveLength(1);
    expect(
      map.operations.filter((operation) => operation.startsWith('addLayer:roads-line:')),
    ).toHaveLength(1);
    expect(
      map.operations.filter((operation) => operation.startsWith('addLayer:labels-updated:')),
    ).toHaveLength(1);
  });

  it('lets a reentrant basemap listener replace intent before physical work starts', async () => {
    const { manager } = createManager([base, dark, streets]);
    let latest: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (
        !latest &&
        event.reason === 'basemap' &&
        event.serviceId === 'dark' &&
        event.state?.active
      ) {
        latest = manager.setBasemap('streets');
      }
    });

    const obsolete = manager.setBasemap('dark').catch((error: unknown) => error);
    const map = await waitForFakeMap();

    expect(map.options.style).toBe(streets.style);
    expect(map.setStyleCalls).toEqual([]);
    await expect(obsolete).resolves.toMatchObject({ name: 'AbortError' });
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    map.emit('style.load');
    await latest;
    expect(manager.getServiceState('streets')).toMatchObject({ active: true, status: 'ready' });
  });

  it('lets a ready-status listener supersede the committing parsed request', async () => {
    const { manager } = createManager([dark, streets]);
    let latest: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (
        !latest &&
        event.reason === 'status' &&
        event.serviceId === 'dark' &&
        event.state?.status === 'ready'
      ) {
        latest = manager.setBasemap('streets');
      }
    });

    const obsolete = manager.setBasemap('dark').catch((error: unknown) => error);
    const map = await waitForFakeMap();
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === streets.style,
      'ready-status replacement did not start',
    );

    await expect(obsolete).resolves.toMatchObject({ name: 'AbortError' });
    map.emit('style.load');
    await latest;
    expect(manager.getServiceState('dark')).toEqual({
      id: 'dark',
      active: false,
      status: 'idle',
    });
    expect(manager.getServiceState('streets')).toMatchObject({ active: true, status: 'ready' });
  });

  it('rejects a visible add superseded by a synchronous add listener', async () => {
    const { manager, loadMapLibre } = createManager();
    let hide: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (event.reason === 'add' && event.serviceId === 'roads') {
        hide = manager.setOverlayVisibility('roads', false);
      }
    });

    const addition = manager
      .addService({ ...roads, visible: true })
      .catch((error: unknown) => error);

    await hide;
    await expect(addition).resolves.toMatchObject({ name: 'AbortError' });
    expect(loadMapLibre).not.toHaveBeenCalled();
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: false,
      status: 'ready',
      error: undefined,
    });
  });
});

describe('MapLibreServiceManager style failures and transactional mutations', () => {
  it('honors overlay hide, remove, and update operations while a style is loading', async () => {
    const updatedTraffic = {
      ...traffic,
      name: 'Updated traffic',
      layers: [{ id: 'traffic-updated', type: 'line' as const, source: 'traffic' }],
    };
    const { manager } = createManager(
      [
        base,
        dark,
        { ...roads, visible: true },
        { ...labels, visible: true },
        { ...traffic, visible: true },
      ],
      { defaultBasemap: 'light' },
    );
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;

    const switchRequest = manager.setBasemap('dark');
    const hide = manager.setOverlayVisibility('roads', false);
    const removal = manager.removeService('labels');
    const update = manager.updateService('traffic', updatedTraffic);
    map.emit('style.load');
    await Promise.all([switchRequest, hide, removal, update]);

    expect(manager.getServiceState('roads')).toMatchObject({ active: false, status: 'ready' });
    expect(manager.getServiceState('labels')).toBeUndefined();
    expect(manager.getServices().find((service) => service.id === 'traffic')).toEqual(
      updatedTraffic,
    );
    expect(manager.getServiceState('traffic')).toMatchObject({ active: true, status: 'ready' });
    expect(map.layerOrder).toEqual(['traffic-updated']);
  });

  it.each([
    { rebuild: true, phase: 'source' as const },
    { rebuild: true, phase: 'layer' as const },
    { rebuild: false, phase: 'source' as const },
    { rebuild: false, phase: 'layer' as const },
  ])('reports a transactional $phase collision after base load (rebuild=$rebuild)', async ({
    rebuild,
    phase,
  }) => {
    const { manager } = createManager(
      [base, dark, { ...roads, visible: true }, { ...labels, visible: true }],
      { defaultBasemap: 'light' },
    );
    FakeMap.rebuildOnSetStyle = rebuild;
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) =>
      errors.push({ serviceId: event.serviceId, phase: event.phase, fatal: event.fatal }),
    );

    const switchRequest = manager.setBasemap('dark');
    if (phase === 'source') map.addSource('roads', roads.sources.roads);
    else map.addLayer(roads.layers[0]);
    map.emit('style.load');
    await switchRequest;

    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'error' });
    expect(manager.getServiceState('labels')).toMatchObject({ active: true, status: 'ready' });
    expect(errors).toEqual([{ serviceId: 'roads', phase, fatal: true }]);
    expect(map.layers.has('labels-symbol')).toBe(true);
    expect(map.sources.has('labels')).toBe(true);
    if (phase === 'source') expect(map.getSource('roads')).toBeDefined();
    else expect(map.getLayer('roads-line')).toBeDefined();
  });

  it('publishes a failed selection then restores the valid last-ready basemap in order', async () => {
    const { manager } = createManager([base, dark, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const first = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await first;
    const transitions: string[] = [];
    manager.on('error', (event) =>
      transitions.push(`error:${event.serviceId}:${event.phase}:${event.error.message}`),
    );
    manager.on('change', (event) => {
      if ((event.reason === 'status' || event.reason === 'basemap') && event.state) {
        transitions.push(
          `${event.reason}:${event.serviceId}:${event.state.active}:${event.state.status}`,
        );
      }
    });
    const styleError = new Error('dark failed');

    const failed = manager.setBasemap('dark').catch((error: unknown) => error);
    const delayedFailedLoad = map.delayedStyleLoad();
    transitions.length = 0;
    map.emit('error', { error: styleError });
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === base.style,
      'last-ready recovery did not start',
    );
    delayedFailedLoad();
    await Promise.resolve();
    expect(manager.getServiceState('light')).toMatchObject({ active: true, status: 'loading' });
    map.emit('style.load');

    await expect(failed).resolves.toBe(styleError);
    expect(transitions).toEqual([
      'error:dark:style:dark failed',
      'status:dark:false:error',
      'basemap:dark:false:error',
      'basemap:light:true:loading',
      'status:light:true:loading',
      'status:light:true:ready',
    ]);
    expect(manager.getServiceState('dark')).toMatchObject({
      active: false,
      status: 'error',
      error: { message: 'dark failed' },
    });
    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: true,
      status: 'ready',
    });
    expect(map.setStyleCalls.slice(-3)).toEqual([dark.style, null, base.style]);
    expect(map.resourceSnapshots.slice(-3)).toEqual([
      { sources: [], layers: [] },
      { sources: [], layers: [] },
      { sources: [], layers: [] },
    ]);
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('restores an active basemap definition after its coordinated update fails', async () => {
    const { manager } = createManager([base]);
    const activation = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await activation;
    const replacement = {
      ...base,
      name: 'Replacement light',
      style: 'https://example.test/replacement-light.json',
    };
    const styleError = new Error('replacement failed');
    map.nextSetStyleError = styleError;

    const update = manager.updateService('light', replacement).catch((error: unknown) => error);
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === base.style,
      'retained basemap recovery did not start',
    );
    map.emit('style.load');

    await expect(update).resolves.toBe(styleError);
    expect(manager.getServices()).toEqual([base]);
    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: true,
      status: 'ready',
    });
    expect(map.setStyleCalls.slice(-3)).toEqual([replacement.style, null, base.style]);
  });

  it.each([
    'remove',
    'update',
    'readd',
  ] as const)('recovers blank when the last-ready definition becomes invalid through $s', async (mutation) => {
    const { manager } = createManager([base, dark]);
    const activation = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await activation;
    const failed = manager.setBasemap('dark').catch((error: unknown) => error);
    const replacement = {
      ...base,
      name: 'Unproven light',
      style: 'https://example.test/unproven-light.json',
    };
    if (mutation === 'remove') await manager.removeService('light');
    else if (mutation === 'update') await manager.updateService('light', replacement);
    else {
      await manager.removeService('light');
      await manager.addService(replacement);
    }

    const styleError = new Error('dark failed after invalidation');
    map.emit('error', { error: styleError });
    await waitForCondition(() => {
      const style = map.setStyleCalls.at(-1);
      return typeof style === 'object' && style !== null;
    }, 'blank recovery did not start after invalidating last-ready basemap');
    map.emit('style.load');

    await expect(failed).resolves.toBe(styleError);
    expect(manager.getServiceState('dark')).toMatchObject({ active: false, status: 'error' });
    if (mutation === 'remove') expect(manager.getServiceState('light')).toBeUndefined();
    else expect(manager.getServiceState('light')).toMatchObject({ active: false, status: 'idle' });
    expect(map.setStyleCalls).not.toContain(replacement.style);
  });

  it('provides tile error attribution before source error transitions', async () => {
    const { manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    const events: Array<{
      type: string;
      phase: string;
      fatal: boolean;
      error: Error;
      serviceId?: string;
    }> = [];
    manager.on('error', (event) => events.push(event));
    const tileError = new Error('tile failed');
    const spriteError = new Error('sprite failed');
    const sourceError = new Error('source failed');

    map.emit('error', { error: tileError, tile: {}, sourceId: 'roads' });
    map.emit('error', { error: spriteError });
    map.emit('error', { error: sourceError, sourceId: 'roads' });

    expect(events).toEqual([
      { type: 'error', phase: 'tile', fatal: false, error: tileError, serviceId: 'roads' },
      { type: 'error', phase: 'lifecycle', fatal: false, error: spriteError },
      {
        type: 'error',
        phase: 'source',
        fatal: true,
        error: sourceError,
        serviceId: 'roads',
      },
    ]);
    expect(manager.getServiceState('roads')).toMatchObject({
      active: true,
      status: 'error',
      error: { message: 'source failed' },
    });
  });
});

describe('MapLibreServiceManager coordinator review regressions', () => {
  it('forces a terminal rebuild for identical basemap styles and admits the next request', async () => {
    const sharedLight = { ...base, style: 'https://example.test/shared.json' };
    const sharedDark = { ...dark, style: sharedLight.style };
    const { manager } = createManager(
      [sharedLight, sharedDark, streets, { ...roads, visible: true }],
      { defaultBasemap: 'light' },
    );
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;

    const identical = manager.setBasemap('dark');

    expect(map.setStyleCalls.at(-1)).toBe(sharedDark.style);
    expect(map.setStyleOptions.at(-1)).toEqual({ diff: false });
    map.emit('style.load');
    await identical;
    expect(map.layerOrder).toEqual(['roads-line']);

    const later = manager.setBasemap('streets');
    expect(map.setStyleCalls.at(-1)).toBe(streets.style);
    map.emit('style.load');
    await later;

    expect(manager.getServiceState('streets')).toEqual({
      id: 'streets',
      active: true,
      status: 'ready',
    });
    expect(map.operations.filter((operation) => operation === 'addSource:roads')).toHaveLength(3);
  });

  it.each([
    { trigger: 'error' as const, action: 'clear' as const },
    { trigger: 'status' as const, action: 'clear' as const },
    { trigger: 'basemap' as const, action: 'clear' as const },
    { trigger: 'error' as const, action: 'remove' as const },
    { trigger: 'status' as const, action: 'remove' as const },
    { trigger: 'basemap' as const, action: 'remove' as const },
  ])('lets a reentrant $action from the fatal $trigger event supersede failed publication', async ({
    trigger,
    action,
  }) => {
    const { manager } = createManager([base, dark]);
    const activation = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await activation;
    const failed = manager.setBasemap('dark').catch((error: unknown) => error);
    const events: string[] = [];
    let actionPromise: Promise<void> | undefined;
    let invoked = false;
    const runAction = () => {
      if (invoked) return;
      invoked = true;
      actionPromise = action === 'clear' ? manager.setBasemap(null) : manager.removeService('dark');
    };
    manager.on('error', (event) => {
      if (event.serviceId !== 'dark') return;
      events.push('error');
      if (trigger === 'error') runAction();
    });
    manager.on('change', (event) => {
      if (event.serviceId !== 'dark' || !event.state) return;
      if (event.reason === 'status' || event.reason === 'basemap') {
        events.push(event.reason);
        if (event.reason === trigger && event.state.status === 'error') runAction();
      }
    });
    const styleError = new Error('dark failed reentrantly');
    const callCount = map.setStyleCalls.length;

    map.emit('error', { error: styleError });
    await actionPromise;
    await Promise.resolve();
    const callsAfterFailure = map.setStyleCalls.slice(callCount);
    if (map.styleLoading) map.emit('style.load');

    await expect(failed).resolves.toBe(styleError);
    expect(invoked).toBe(true);
    expect(callsAfterFailure).toEqual([null]);
    const triggerIndex = events.indexOf(trigger);
    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(events.slice(triggerIndex + 1)).toEqual([]);
    if (action === 'remove') expect(manager.getServiceState('dark')).toBeUndefined();
    else expect(manager.getServiceState('dark')).toMatchObject({ active: false, status: 'error' });
    expect(manager.getServiceState('light')).toMatchObject({ active: false });
  });

  it('updates a suspended active basemap without reprojecting the host', async () => {
    const { host, manager } = createManager([base, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    host.setCRS('epsg:4326');
    host.emit('crschange');
    host.reproject.mockClear();
    const replacement = {
      ...base,
      name: 'Replacement light',
      style: 'https://example.test/replacement-light.json',
    };
    const previousCalls = map.setStyleCalls.length;

    const update = manager.updateService('light', replacement);
    await waitForCondition(
      () => host.reproject.mock.calls.length > 0 || map.setStyleCalls.length > previousCalls,
      'suspended active basemap update did not start',
    );

    expect(host.reproject).not.toHaveBeenCalled();
    expect(map.setStyleCalls.at(-1)).toBe(replacement.style);
    map.emit('style.load');
    await update;
    expect((map.options.container as HTMLElement).hidden).toBe(true);
  });

  it.each([
    'clear',
    'remove',
  ] as const)('$s a suspended active basemap with a visible overlay without reprojecting', async (action) => {
    const { host, manager } = createManager([base, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    host.setCRS('epsg:4326');
    host.emit('crschange');
    host.reproject.mockClear();
    const previousCalls = map.setStyleCalls.length;

    const mutation = action === 'clear' ? manager.setBasemap(null) : manager.removeService('light');
    await waitForCondition(
      () => host.reproject.mock.calls.length > 0 || map.setStyleCalls.length > previousCalls,
      'suspended basemap deactivation did not start',
    );

    expect(host.reproject).not.toHaveBeenCalled();
    expect(map.setStyleCalls.at(-1)).toEqual({ version: 8, sources: {}, layers: [] });
    map.emit('style.load');
    await mutation;
    expect((map.options.container as HTMLElement).hidden).toBe(true);
    if (action === 'remove') expect(manager.getServiceState('light')).toBeUndefined();
    else expect(manager.getServiceState('light')).toMatchObject({ active: false });
  });

  it.each([
    'layer',
    'source',
  ] as const)('preserves a managed $s detachment failure phase and owner before switching styles', async (phase) => {
    const { manager } = createManager([base, traffic]);
    const map = await activateOverlay(manager, 'traffic');
    const error = new Error(`${phase} detach failed`);
    map.removeFailures.set(phase === 'layer' ? 'layer:traffic-line' : 'source:traffic', error);
    const errors: Array<{ serviceId?: string; phase: string; error: Error }> = [];
    manager.on('error', (event) =>
      errors.push({ serviceId: event.serviceId, phase: event.phase, error: event.error }),
    );
    const callCount = map.setStyleCalls.length;

    const selection = manager.setBasemap('light').catch((value: unknown) => value);

    await expect(selection).resolves.toBe(error);
    expect(errors).toEqual([{ serviceId: 'traffic', phase, error }]);
    expect(map.setStyleCalls).toHaveLength(callCount);
  });

  it.each([
    { trigger: 'status' as const, action: 'clear' as const },
    { trigger: 'basemap' as const, action: 'clear' as const },
    { trigger: 'error' as const, action: 'clear' as const },
    { trigger: 'status' as const, action: 'remove' as const },
    { trigger: 'basemap' as const, action: 'remove' as const },
    { trigger: 'error' as const, action: 'remove' as const },
  ])('does not restore a committed basemap after detachment $trigger listener $action', async ({
    trigger,
    action,
  }) => {
    const { manager } = createManager([base, dark, { ...traffic, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    const detachError = new Error('traffic detach failed reentrantly');
    map.removeFailures.set('layer:traffic-line', detachError);
    const events: string[] = [];
    let actionPromise: Promise<void> | undefined;
    let invoked = false;
    const runAction = () => {
      if (invoked) return;
      invoked = true;
      actionPromise =
        action === 'clear' ? manager.setBasemap(null) : manager.removeService('light');
    };
    manager.on('change', (event) => {
      if ((event.reason !== 'status' && event.reason !== 'basemap') || !event.state) return;
      events.push(`${event.reason}:${event.serviceId}:${event.state.active}:${event.state.status}`);
      if (
        event.serviceId === 'dark' &&
        event.reason === trigger &&
        event.state.status === 'error'
      ) {
        runAction();
      }
    });
    manager.on('error', (event) => {
      events.push(`error:${event.serviceId}:${event.phase}`);
      if (trigger === 'error' && event.serviceId === 'traffic') runAction();
    });

    const selection = manager.setBasemap('dark').catch((error: unknown) => error);
    expect(invoked).toBe(true);
    expect(actionPromise).toBeDefined();
    expect(map.setStyleCalls.at(-1)).toEqual({ version: 8, sources: {}, layers: [] });
    map.emit('style.load');
    await actionPromise;

    await expect(selection).resolves.toBe(detachError);
    expect(events).not.toContain('basemap:light:true:ready');
    expect(events).not.toContain('status:light:true:ready');
    expect(manager.getServiceState('dark')).toMatchObject({ active: false, status: 'error' });
    if (action === 'remove') expect(manager.getServiceState('light')).toBeUndefined();
    else expect(manager.getServiceState('light')).toMatchObject({ active: false });
  });

  it.each([
    'status',
    'basemap',
    'error',
  ] as const)('admits a later committed basemap after detachment %s listener removes the failed basemap', async (trigger) => {
    const { manager } = createManager([base, dark, { ...traffic, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    const detachError = new Error('traffic detach failed before removing dark');
    map.removeFailures.set('layer:traffic-line', detachError);
    const events: string[] = [];
    let triggerIndex = -1;
    let removal: Promise<void> | undefined;
    const removeFailed = () => {
      if (removal) return;
      triggerIndex = events.length - 1;
      removal = manager.removeService('dark');
    };
    manager.on('change', (event) => {
      if ((event.reason !== 'status' && event.reason !== 'basemap') || !event.state) return;
      events.push(`${event.reason}:${event.serviceId}:${event.state.active}:${event.state.status}`);
      if (
        event.serviceId === 'dark' &&
        event.reason === trigger &&
        event.state.status === 'error'
      ) {
        removeFailed();
      }
    });
    manager.on('error', (event) => {
      events.push(`error:${event.serviceId}:${event.phase}`);
      if (trigger === 'error' && event.serviceId === 'traffic') removeFailed();
    });

    const selection = manager.setBasemap('dark').catch((error: unknown) => error);
    await removal;
    await expect(selection).resolves.toBe(detachError);

    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(events.slice(triggerIndex + 1)).toEqual([]);
    expect(manager.getServiceState('dark')).toBeUndefined();
    expect(manager.getServiceState('light')).toMatchObject({ active: false });
    const callCount = map.setStyleCalls.length;

    const later = manager.setBasemap('light');
    expect(map.setStyleCalls).toHaveLength(callCount + 1);
    expect(map.setStyleCalls.at(-1)).toBe(base.style);
    map.emit('style.load');
    await later;

    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: true,
      status: 'ready',
    });
  });

  it('publishes one fatal style error when a requested blank style fails, then recovers', async () => {
    const { manager } = createManager([base, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean; error: Error }> = [];
    manager.on('error', (event) => errors.push(event));
    const blankError = new Error('blank switch failed');

    const clear = manager.setBasemap(null).catch((error: unknown) => error);
    map.emit('error', { error: blankError });
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === base.style,
      'last-ready recovery did not start after the blank failure',
    );
    map.emit('style.load');

    await expect(clear).resolves.toBe(blankError);
    expect(errors).toEqual([{ type: 'error', phase: 'style', fatal: true, error: blankError }]);
    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: true,
      status: 'ready',
    });
  });

  it('falls back from a failed target and failed last-ready recovery to one terminal blank', async () => {
    const { manager } = createManager([base, dark, { ...roads, visible: true }], {
      defaultBasemap: 'light',
    });
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean; error: Error }> = [];
    manager.on('error', (event) => errors.push(event));
    const targetError = new Error('target failed');
    const recoveryError = new Error('recovery failed');
    const blankError = new Error('terminal blank failed');

    const target = manager.setBasemap('dark').catch((error: unknown) => error);
    map.emit('error', { error: targetError });
    await waitForCondition(
      () => map.setStyleCalls.at(-1) === base.style,
      'last-ready recovery did not start',
    );
    map.emit('error', { error: recoveryError });
    await waitForCondition(() => {
      const style = map.setStyleCalls.at(-1);
      return typeof style === 'object' && style !== null;
    }, 'terminal blank fallback did not start');
    const callCount = map.setStyleCalls.length;
    map.emit('error', { error: blankError });
    await Promise.resolve();
    await Promise.resolve();

    await expect(target).resolves.toBe(targetError);
    expect(map.setStyleCalls.slice(callCount)).toEqual([null]);
    expect(map.setStyleCalls.filter((style) => style === base.style)).toHaveLength(1);
    expect(errors).toEqual([
      { type: 'error', serviceId: 'dark', phase: 'style', fatal: true, error: targetError },
      { type: 'error', serviceId: 'light', phase: 'style', fatal: true, error: recoveryError },
      { type: 'error', phase: 'style', fatal: true, error: blankError },
    ]);
    expect(manager.getServiceState('dark')).toMatchObject({ active: false, status: 'error' });
    expect(manager.getServiceState('light')).toMatchObject({ active: false, status: 'error' });
  });
});

describe('MapLibreServiceManager lazy host lifecycle', () => {
  it('awaits Web Mercator before creating one owned underlay with owned map options', async () => {
    const { host, loadMapLibre, manager } = createManager([roads], {
      crs: 'epsg:4326',
      mapOptions: {
        container: 'caller-container',
        style: 'caller-style',
        center: [0, 0],
        zoom: 12,
        interactive: true,
        attributionControl: true,
        maxPitch: 35,
        renderWorldCopies: false,
      },
    });
    let finishReproject: (() => void) | undefined;
    host.reproject.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishReproject = () => {
            host.setCRS('webmercator');
            resolve();
          };
        }),
    );

    const activation = manager.setOverlayVisibility('roads', true);
    await Promise.resolve();
    expect(host.reproject).toHaveBeenCalledWith('webmercator');
    expect(loadMapLibre).not.toHaveBeenCalled();

    finishReproject?.();
    const map = await waitForFakeMap();
    const ownedContainer = map.options.container as HTMLElement;
    expect(host.getCanvasContainer().firstElementChild).toBe(ownedContainer);
    expect(ownedContainer.classList.contains('emap-maplibre')).toBe(true);
    expect(ownedContainer.classList.contains('emap-basemap')).toBe(true);
    expect(ownedContainer.style.position).toBe('absolute');
    expect([
      ownedContainer.style.inset,
      [
        ownedContainer.style.top,
        ownedContainer.style.right,
        ownedContainer.style.bottom,
        ownedContainer.style.left,
      ].join(' '),
    ]).toContain('0px');
    expect(ownedContainer.style.zIndex).toBe('0');
    expect(ownedContainer.style.pointerEvents).toBe('none');
    expect(map.options).toMatchObject({
      attributionControl: true,
      maxPitch: 35,
      renderWorldCopies: false,
      container: ownedContainer,
      style: { version: 8, sources: {}, layers: [] },
      center: [120, 30],
      zoom: 4,
      interactive: false,
    });
    expect(manager.getMapLibreMap()).toBe(map);

    map.emit('style.load');
    await activation;
  });

  it('keeps the raw getter null until an active overlay needs MapLibre', async () => {
    const { manager, loadMapLibre } = createManager([roads]);

    expect(manager.getMapLibreMap()).toBeNull();
    await manager.setOverlayVisibility('roads', false);

    expect(loadMapLibre).not.toHaveBeenCalled();
    expect(manager.getMapLibreMap()).toBeNull();
  });

  it('attaches host synchronization once and suspends without clearing active intent', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);

    expect(host.listenerCount('move')).toBe(1);
    expect(host.listenerCount('resize')).toBe(1);
    expect(host.listenerCount('crschange')).toBe(1);
    host.getCenter.mockReturnValue([121, 31]);
    host.getZoom.mockReturnValue(6);
    host.emit('move');
    host.emit('resize');
    expect(map.jumpToCalls.at(-1)).toEqual({ center: [121, 31], zoom: 6 });
    expect(map.resizeCalls).toBe(1);

    host.setCRS('epsg:4326');
    host.emit('crschange');
    const container = map.options.container as HTMLElement;
    expect(container.hidden).toBe(true);
    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'ready' });

    const suspendedResizeCalls = map.resizeCalls;
    const suspendedJumpToCalls = map.jumpToCalls.length;
    host.getCenter.mockReturnValue([122, 32]);
    host.getZoom.mockReturnValue(8);
    host.emit('resize');
    expect(map.resizeCalls).toBe(suspendedResizeCalls);
    expect(map.jumpToCalls).toHaveLength(suspendedJumpToCalls);
    expect(container.hidden).toBe(true);
    expect(host.reproject).not.toHaveBeenCalled();

    await manager.setOverlayVisibility('roads', true);
    expect(host.reproject).toHaveBeenCalledTimes(0);
    host.setCRS('epsg:3857');
    host.emit('crschange');
    expect(container.hidden).toBe(false);
    expect(map.resizeCalls).toBe(suspendedResizeCalls + 1);
    expect(map.jumpToCalls.at(-1)).toEqual({ center: [122, 32], zoom: 8 });
  });

  it('resizes MapLibre before synchronizing the current host camera', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    const resize = vi.spyOn(map, 'resize');
    const jumpTo = vi.spyOn(map, 'jumpTo');
    host.getCenter.mockReturnValue([121, 31]);
    host.getZoom.mockReturnValue(6);

    host.emit('resize');

    expect(resize).toHaveBeenCalledTimes(1);
    expect(jumpTo).toHaveBeenCalledExactlyOnceWith({ center: [121, 31], zoom: 6 });
    expect(resize.mock.invocationCallOrder[0]).toBeLessThan(jumpTo.mock.invocationCallOrder[0]);
  });

  it('allows deactivation while suspended and only reprojects on a new activation', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    host.setCRS('epsg:4326');
    host.emit('crschange');

    await manager.setOverlayVisibility('roads', false);
    expect(host.reproject).not.toHaveBeenCalled();
    expect((map.options.container as HTMLElement).hidden).toBe(true);

    host.getCenter.mockReturnValue([122, 32]);
    host.getZoom.mockReturnValue(8);
    const resizeCalls = map.resizeCalls;
    const reactivation = manager.setOverlayVisibility('roads', true);
    await reactivation;
    expect(host.reproject).toHaveBeenCalledWith('webmercator');
    expect(map.resizeCalls).toBe(resizeCalls + 1);
    expect(map.jumpToCalls.at(-1)).toEqual({ center: [122, 32], zoom: 8 });
    expect((map.options.container as HTMLElement).hidden).toBe(false);
  });

  it('updates an active suspended overlay without reprojection', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    host.setCRS('epsg:4326');
    host.emit('crschange');
    host.reproject.mockClear();
    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };

    await manager.updateService('roads', updatedRoads);

    expect(host.reproject).not.toHaveBeenCalled();
    expect(map.layerOrder).toEqual(['roads-updated']);
    expect((map.options.container as HTMLElement).hidden).toBe(true);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
  });

  it('destroys once, aborts pending readiness, and detaches every listener', async () => {
    const { host, manager } = createManager([roads]);
    const activation = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    const container = map.options.container as HTMLElement;
    const rejection = activation.catch((error: unknown) => error);

    manager.destroy();
    manager.destroy();

    await expect(rejection).resolves.toMatchObject({ name: 'AbortError' });
    expect(map.removed).toBe(true);
    expect(container.isConnected).toBe(false);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(host.listenerCount('move')).toBe(0);
    expect(host.listenerCount('resize')).toBe(0);
    expect(host.listenerCount('crschange')).toBe(0);
    expect(map.listenerCount('style.load')).toBe(0);
    expect(map.listenerCount('error')).toBe(0);
  });

  it('clears the owned runtime even when native map removal throws', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    const container = map.options.container as HTMLElement;
    const removeError = new Error('native removal failed');
    map.removeError = removeError;

    expect(() => manager.destroy()).toThrow(removeError);

    expect(map.removed).toBe(true);
    expect(container.isConnected).toBe(false);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(host.listenerCount('move')).toBe(0);
    expect(host.listenerCount('resize')).toBe(0);
    expect(host.listenerCount('crschange')).toBe(0);
    expect(map.listenerCount('style.load')).toBe(0);
    expect(map.listenerCount('error')).toBe(0);
    expect(() => manager.destroy()).not.toThrow();
  });

  it('attempts every teardown step when a host listener detach throws', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    const container = map.options.container as HTMLElement;
    const hostOffError = new Error('host move detach failed');
    const removeError = new Error('native removal also failed');
    const detach = host.off.getMockImplementation();
    host.off.mockImplementation((type, listener) => {
      detach?.(type, listener);
      if (type === 'move') throw hostOffError;
    });
    map.removeError = removeError;

    expect(() => manager.destroy()).toThrow(hostOffError);

    expect(host.off.mock.calls.map(([type]) => type)).toEqual(['move', 'resize', 'crschange']);
    expect(map.offCalls).toEqual(['style.load', 'error']);
    expect(map.removed).toBe(true);
    expect(container.isConnected).toBe(false);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(() => manager.destroy()).not.toThrow();
  });

  it('attempts map removal after an error listener detach throws', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    map.offCalls.length = 0;
    const container = map.options.container as HTMLElement;
    const mapOffError = new Error('error listener detach failed');
    map.offErrors.set('error', mapOffError);
    map.removeError = new Error('native removal also failed');

    expect(() => manager.destroy()).toThrow(mapOffError);

    expect(host.off.mock.calls.map(([type]) => type)).toEqual(['move', 'resize', 'crschange']);
    expect(map.offCalls).toEqual(['error']);
    expect(map.removed).toBe(true);
    expect(container.isConnected).toBe(false);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(() => manager.destroy()).not.toThrow();
  });

  it('rolls back failed map construction so a retry owns one clean underlay', async () => {
    const { host, manager } = createManager([roads]);
    FakeMap.constructorError = new Error('constructor failed');

    await expect(manager.setOverlayVisibility('roads', true)).rejects.toThrow('constructor failed');

    expect(manager.getMapLibreMap()).toBeNull();
    expect(host.getCanvasContainer().querySelectorAll('.emap-maplibre')).toHaveLength(0);
    expect(host.listenerCount('move')).toBe(0);

    await manager.setOverlayVisibility('roads', false);
    const retry = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    map.emit('style.load');
    await retry;

    expect(FakeMap.constructorCalls).toBe(2);
    expect(FakeMap.instances).toEqual([map]);
    expect(host.getCanvasContainer().querySelectorAll('.emap-maplibre')).toHaveLength(1);

    manager.destroy();
    expect(host.getCanvasContainer().querySelectorAll('.emap-maplibre')).toHaveLength(0);
  });
});

describe('MapLibreServiceManager overlay rendering', () => {
  it('waits for style readiness, installs sources before ordered layers, and emits statuses', async () => {
    const { manager } = createManager([traffic]);
    const statuses: string[] = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) statuses.push(event.state.status);
    });

    let settled = false;
    const activation = manager.setOverlayVisibility('traffic', true).then(() => {
      settled = true;
    });
    const map = await waitForFakeMap();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(map.operations).toEqual([]);

    map.emit('style.load');
    await activation;

    expect(map.operations).toEqual([
      'addSource:traffic',
      'addLayer:traffic-casing:',
      'addLayer:traffic-line:',
    ]);
    expect(map.layerOrder).toEqual(['traffic-casing', 'traffic-line']);
    expect(statuses).toEqual(['loading', 'ready']);
    expect(manager.getServiceState('traffic')).toEqual({
      id: 'traffic',
      active: true,
      status: 'ready',
    });
  });

  it('initializes visible definitions in registry order and applies visible additions immediately', async () => {
    const initial = createManager([
      { ...roads, visible: true },
      { ...traffic, visible: true },
    ]);
    const initialization = initial.manager.initialize();
    const initialMap = await waitForFakeMap();
    initialMap.emit('style.load');
    await initialization;
    expect(initialMap.layerOrder).toEqual(['roads-line', 'traffic-casing', 'traffic-line']);

    const added = createManager();
    const addition = added.manager.addService({ ...labels, visible: true });
    const addedMap = await waitForFakeMap();
    expect(addedMap.layers.size).toBe(0);
    addedMap.emit('style.load');
    await addition;
    expect(addedMap.layerOrder).toEqual(['labels-symbol']);
  });

  it('coordinates concurrent initialization through one status and resource cycle', async () => {
    const { manager } = createManager([
      { ...roads, visible: true },
      { ...traffic, visible: true },
    ]);
    const statuses: string[] = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) {
        statuses.push(`${event.serviceId}:${event.state.status}`);
      }
    });

    const first = manager.initialize();
    const second = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await Promise.all([first, second]);

    expect(statuses).toEqual(['roads:loading', 'roads:ready', 'traffic:loading', 'traffic:ready']);
    expect(map.operations).toEqual([
      'addSource:roads',
      'addLayer:roads-line:',
      'addSource:traffic',
      'addLayer:traffic-casing:',
      'addLayer:traffic-line:',
    ]);
    expect(map.layerOrder).toEqual(['roads-line', 'traffic-casing', 'traffic-line']);
  });

  it('joins listener-reentrant initialization without repeating lifecycle publication', async () => {
    const { manager } = createManager([{ ...roads, visible: true }]);
    const statuses: string[] = [];
    let reentrant: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (event.reason !== 'status' || !event.state) return;
      statuses.push(event.state.status);
      if (!reentrant && event.state.status === 'loading') reentrant = manager.initialize();
    });

    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    await reentrant;

    expect(statuses).toEqual(['loading', 'ready']);
    expect(map.operations).toEqual(['addSource:roads', 'addLayer:roads-line:']);
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('deduplicates a visible addition overlapping initialization style failure', async () => {
    const { manager } = createManager([{ ...roads, visible: true }]);
    const statuses: string[] = [];
    const errors: Array<{ serviceId?: string; phase: string; message: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) {
        statuses.push(`${event.serviceId}:${event.state.status}`);
      }
    });
    manager.on('error', (event) =>
      errors.push({
        serviceId: event.serviceId,
        phase: event.phase,
        message: event.error.message,
      }),
    );

    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    const addition = manager.addService({ ...labels, visible: true });
    const styleError = new Error('shared blank style failed');
    map.emit('error', { error: styleError });

    await expect(initialization).rejects.toBe(styleError);
    await expect(addition).rejects.toBe(styleError);
    expect(statuses).toEqual(['labels:loading', 'roads:error', 'labels:error']);
    expect(errors).toEqual([
      { serviceId: 'roads', phase: 'style', message: 'shared blank style failed' },
      { serviceId: 'labels', phase: 'style', message: 'shared blank style failed' },
    ]);
    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'error' });
    expect(manager.getServiceState('labels')).toMatchObject({ active: true, status: 'error' });
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  it.each([
    'loader',
    'reproject',
    'constructor',
  ] as const)('publishes one lifecycle failure for initial %s setup rejection', async (failure) => {
    FakeMap.instances.length = 0;
    FakeMap.constructorError = null;
    FakeMap.constructorCalls = 0;
    const host = createHost(failure === 'reproject' ? 'epsg:4326' : 'webmercator');
    const setupError = new Error(`${failure} setup failed`);
    if (failure === 'reproject') host.reproject.mockRejectedValueOnce(setupError);
    if (failure === 'constructor') FakeMap.constructorError = setupError;
    const loadMapLibre = vi.fn(async () => {
      if (failure === 'loader') throw setupError;
      return fakeModule();
    });
    const manager = createMapLibreServiceManager(
      host,
      { services: [{ ...roads, visible: true }] },
      loadMapLibre,
    );
    const statuses: string[] = [];
    const errors: Array<{ serviceId?: string; phase: string; message: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) statuses.push(event.state.status);
    });
    manager.on('error', (event) =>
      errors.push({
        serviceId: event.serviceId,
        phase: event.phase,
        message: event.error.message,
      }),
    );

    await expect(manager.initialize()).rejects.toBe(setupError);

    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'error' });
    expect(statuses).toEqual(['error']);
    expect(errors).toEqual([
      { serviceId: 'roads', phase: 'lifecycle', message: `${failure} setup failed` },
    ]);
  });

  it('retries initialization after a rejected loader and retains the successful promise', async () => {
    FakeMap.instances.length = 0;
    const host = createHost();
    const loaderError = new Error('first loader failed');
    const loadMapLibre = vi
      .fn<() => Promise<typeof import('maplibre-gl')>>()
      .mockRejectedValueOnce(loaderError)
      .mockResolvedValue(fakeModule());
    const manager = createMapLibreServiceManager(
      host,
      { services: [{ ...roads, visible: true }] },
      loadMapLibre,
    );
    const statuses: string[] = [];
    const errors: Array<{ phase: string; message: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) statuses.push(event.state.status);
    });
    manager.on('error', (event) =>
      errors.push({ phase: event.phase, message: event.error.message }),
    );

    await expect(manager.initialize()).rejects.toBe(loaderError);
    const retry = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await retry;
    await manager.initialize();

    expect(loadMapLibre).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['error', 'loading', 'ready']);
    expect(errors).toEqual([{ phase: 'lifecycle', message: 'first loader failed' }]);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('rebuilds one clean runtime when initialization retries after blank-style failure', async () => {
    const { host, loadMapLibre, manager } = createManager([{ ...roads, visible: true }]);
    const statuses: string[] = [];
    const errors: Array<{ phase: string; message: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) statuses.push(event.state.status);
    });
    manager.on('error', (event) =>
      errors.push({ phase: event.phase, message: event.error.message }),
    );

    const styleError = new Error('first blank style failed');
    const first = manager.initialize();
    const failedMap = await waitForFakeMap();
    failedMap.emit('error', { error: styleError });

    await expect(first).rejects.toBe(styleError);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(failedMap.removed).toBe(true);
    expect(failedMap.listenerCount('style.load')).toBe(0);
    expect(failedMap.listenerCount('error')).toBe(0);
    expect(host.listenerCount('move')).toBe(0);
    expect(host.listenerCount('resize')).toBe(0);
    expect(host.listenerCount('crschange')).toBe(0);
    expect(host.getCanvasContainer().querySelectorAll('.emap-maplibre')).toHaveLength(0);

    const retry = manager.initialize();
    void retry.catch(() => undefined);
    const readyMap = await waitForFakeMap(1);
    readyMap.emit('style.load');
    await retry;

    expect(loadMapLibre).toHaveBeenCalledTimes(2);
    expect(FakeMap.instances).toEqual([failedMap, readyMap]);
    expect(host.getCanvasContainer().querySelectorAll('.emap-maplibre')).toHaveLength(1);
    expect(manager.getMapLibreMap()).toBe(readyMap);
    expect(readyMap.layerOrder).toEqual(['roads-line']);
    expect(statuses).toEqual(['error', 'loading', 'ready']);
    expect(errors).toEqual([{ phase: 'style', message: 'first blank style failed' }]);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
  });

  it('continues initializing visible siblings after an earlier overlay installation fails', async () => {
    const { manager } = createManager([
      { ...roads, visible: true },
      { ...labels, visible: true },
    ]);
    const statuses: string[] = [];
    const errors: Array<{ serviceId?: string; phase: string; message: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) {
        statuses.push(`${event.serviceId}:${event.state.status}`);
      }
    });
    manager.on('error', (event) =>
      errors.push({
        serviceId: event.serviceId,
        phase: event.phase,
        message: event.error.message,
      }),
    );

    const layerError = new Error('roads layer failed');
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.addFailures.set('layer:roads-line', { mode: 'throw', error: layerError });
    map.emit('style.load');

    await expect(initialization).rejects.toBe(layerError);
    expect(manager.getServiceState('roads')).toMatchObject({
      active: true,
      status: 'error',
      error: { message: 'roads layer failed' },
    });
    expect(manager.getServiceState('labels')).toEqual({
      id: 'labels',
      active: true,
      status: 'ready',
    });
    expect(statuses).toEqual(['roads:loading', 'roads:error', 'labels:loading', 'labels:ready']);
    expect(errors).toEqual([{ serviceId: 'roads', phase: 'layer', message: 'roads layer failed' }]);
    expect([...map.sources.keys()]).toEqual(['labels']);
    expect(map.layerOrder).toEqual(['labels-symbol']);
  });

  it('marks every current initial overlay with one typed style failure', async () => {
    const { manager } = createManager([
      { ...roads, visible: true },
      { ...traffic, visible: true },
    ]);
    const statuses: Array<{ serviceId: string; status: string }> = [];
    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) {
        statuses.push({ serviceId: event.serviceId, status: event.state.status });
      }
    });
    manager.on('error', (event) =>
      errors.push({ serviceId: event.serviceId, phase: event.phase, fatal: event.fatal }),
    );
    const initialization = manager.initialize().catch((error: unknown) => error);
    const map = await waitForFakeMap();

    map.emit('error', { error: new Error('blank style failed') });

    await expect(initialization).resolves.toBeInstanceOf(Error);
    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'error' });
    expect(manager.getServiceState('traffic')).toMatchObject({ active: true, status: 'error' });
    expect(statuses).toEqual([
      { serviceId: 'roads', status: 'error' },
      { serviceId: 'traffic', status: 'error' },
    ]);
    expect(errors).toEqual([
      { serviceId: 'roads', phase: 'style', fatal: true },
      { serviceId: 'traffic', phase: 'style', fatal: true },
    ]);
  });

  it.each([
    'hide',
    'remove',
  ] as const)('keeps current initial overlays ready when a status listener %ss a later overlay', async (action) => {
    const { manager } = createManager([
      { ...roads, visible: true },
      { ...traffic, visible: true },
    ]);
    const trafficStatuses: string[] = [];
    let reentrant: Promise<void> | undefined;
    manager.on('change', (event) => {
      if (event.serviceId === 'traffic' && event.reason === 'status' && event.state) {
        trafficStatuses.push(event.state.status);
      }
      if (
        !reentrant &&
        event.serviceId === 'roads' &&
        event.reason === 'status' &&
        event.state?.status === 'loading'
      ) {
        reentrant =
          action === 'hide'
            ? manager.setOverlayVisibility('traffic', false)
            : manager.removeService('traffic');
      }
    });

    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initialization;
    await reentrant;

    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'ready' });
    expect(map.layerOrder).toEqual(['roads-line']);
    if (action === 'hide') {
      expect(manager.getServiceState('traffic')).toMatchObject({
        active: false,
        status: 'ready',
      });
      expect(trafficStatuses.filter((status) => status === 'loading')).toHaveLength(1);
    } else {
      expect(manager.getServiceState('traffic')).toBeUndefined();
      expect(trafficStatuses).toEqual([]);
    }
  });

  it('keeps sibling overlays ready while removing target layers in reverse order before sources', async () => {
    const { manager } = createManager([traffic, labels]);
    const first = manager.setOverlayVisibility('traffic', true);
    const map = await waitForFakeMap();
    map.emit('style.load');
    await first;
    await manager.setOverlayVisibility('labels', true);
    expect(map.layerOrder).toEqual(['traffic-casing', 'traffic-line', 'labels-symbol']);

    map.operations.length = 0;
    await manager.setOverlayVisibility('traffic', false);

    expect(map.operations).toEqual([
      'removeLayer:traffic-line',
      'removeLayer:traffic-casing',
      'removeSource:traffic',
    ]);
    expect(map.layerOrder).toEqual(['labels-symbol']);
    expect(map.sources.has('labels')).toBe(true);
    expect(manager.getServiceState('labels')).toMatchObject({ active: true, status: 'ready' });
  });

  it('keeps the single map reusable and hidden after the final overlay is hidden', async () => {
    const { manager, loadMapLibre } = createManager([roads]);
    const map = await activateOverlay(manager);

    await manager.setOverlayVisibility('roads', false);
    expect((map.options.container as HTMLElement).hidden).toBe(true);
    expect(manager.getMapLibreMap()).toBe(map);

    await manager.setOverlayVisibility('roads', true);
    expect(loadMapLibre).toHaveBeenCalledTimes(1);
    expect(manager.getMapLibreMap()).toBe(map);
    expect((map.options.container as HTMLElement).hidden).toBe(false);
    expect(map.layerOrder).toEqual(['roads-line']);
  });

  it('does not import or emit changes for no-op visibility requests', async () => {
    const { manager, loadMapLibre } = createManager([roads]);
    const changes: string[] = [];
    manager.on('change', (event) => changes.push(`${event.reason}:${event.serviceId}`));

    await manager.setOverlayVisibility('roads', false);

    expect(loadMapLibre).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('does not create a runtime when hide removes the final demand during import', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const loadMapLibre = vi.fn(() => moduleLoad.promise);
    const host = createHost();
    const manager = createMapLibreServiceManager(host, { services: [roads] }, loadMapLibre);

    const showResult = manager.setOverlayVisibility('roads', true).catch((error: unknown) => error);
    await Promise.resolve();
    await manager.setOverlayVisibility('roads', false);
    moduleLoad.resolve(fakeModule());

    await expect(showResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(FakeMap.instances).toHaveLength(0);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(host.listenerCount('move')).toBe(0);
    expect(manager.getServiceState('roads')).toMatchObject({ active: false });
  });

  it('shares an in-flight import with a remaining current activation', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const loadMapLibre = vi.fn(() => moduleLoad.promise);
    const manager = createMapLibreServiceManager(
      createHost(),
      { services: [roads, labels] },
      loadMapLibre,
    );

    const roadsResult = manager
      .setOverlayVisibility('roads', true)
      .catch((error: unknown) => error);
    const labelsResult = manager.setOverlayVisibility('labels', true);
    await Promise.resolve();
    await manager.setOverlayVisibility('roads', false);
    moduleLoad.resolve(fakeModule());
    const map = await waitForFakeMap();
    map.emit('style.load');

    await expect(roadsResult).resolves.toMatchObject({ name: 'AbortError' });
    await labelsResult;
    expect(loadMapLibre).toHaveBeenCalledTimes(1);
    expect(FakeMap.instances).toEqual([map]);
    expect(map.layerOrder).toEqual(['labels-symbol']);
  });

  it('lets only the latest show survive show-hide-show during initial style readiness', async () => {
    const { manager } = createManager([roads]);
    const firstShow = manager.setOverlayVisibility('roads', true).catch((error: unknown) => error);
    const map = await waitForFakeMap();
    await manager.setOverlayVisibility('roads', false);
    const finalShow = manager.setOverlayVisibility('roads', true);

    map.emit('style.load');

    await expect(firstShow).resolves.toMatchObject({ name: 'AbortError' });
    await finalShow;
    expect(map.layerOrder).toEqual(['roads-line']);
    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'ready' });
  });

  it.each([
    'import',
    'reprojection',
  ] as const)('lets an active update take over pending %s setup', async (setup) => {
    FakeMap.instances.length = 0;
    const host = createHost(setup === 'reprojection' ? 'epsg:4326' : 'webmercator');
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const projection = deferred<void>();
    if (setup === 'reprojection') {
      host.reproject.mockImplementation(async (nextCrs: string) => {
        await projection.promise;
        host.setCRS(nextCrs);
      });
    }
    const loadMapLibre = vi.fn(() =>
      setup === 'import' ? moduleLoad.promise : Promise.resolve(fakeModule()),
    );
    const manager = createMapLibreServiceManager(host, {}, loadMapLibre);
    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };

    const addition = manager
      .addService({ ...roads, visible: true })
      .catch((error: unknown) => error);
    await Promise.resolve();
    const update = manager.updateService('roads', updatedRoads).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (setup === 'import') moduleLoad.resolve(fakeModule());
    else projection.resolve();
    const map = await waitForFakeMap();
    map.emit('style.load');

    await expect(addition).resolves.toMatchObject({ name: 'AbortError' });
    await expect(update).resolves.toBeUndefined();
    expect(manager.getServices()).toEqual([updatedRoads]);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(map.layerOrder).toEqual(['roads-updated']);
    if (setup === 'reprojection') expect(host.reproject).toHaveBeenCalledTimes(1);
  });

  it('joins initialization reprojection before applying an active update', async () => {
    FakeMap.instances.length = 0;
    const host = createHost('epsg:4326');
    const projection = deferred<void>();
    host.reproject.mockImplementation(async (nextCrs: string) => {
      await projection.promise;
      host.setCRS(nextCrs);
    });
    const manager = createMapLibreServiceManager(
      host,
      { services: [{ ...roads, visible: true }] },
      async () => fakeModule(),
    );
    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };

    const initialization = manager.initialize();
    await Promise.resolve();
    const update = manager.updateService('roads', updatedRoads);
    projection.resolve();
    const map = await waitForFakeMap();
    map.emit('style.load');

    await initialization;
    await update;
    expect(host.reproject).toHaveBeenCalledTimes(1);
    expect(manager.getServices()).toEqual([updatedRoads]);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(map.layerOrder).toEqual(['roads-updated']);
  });

  it('shares one in-flight reprojection across concurrent activations and an active update', async () => {
    FakeMap.instances.length = 0;
    const host = createHost('epsg:4326');
    const projection = deferred<void>();
    host.reproject.mockImplementation(async (nextCrs: string) => {
      await projection.promise;
      host.setCRS(nextCrs);
    });
    const manager = createMapLibreServiceManager(host, { services: [roads, traffic] }, async () =>
      fakeModule(),
    );
    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };

    const roadsActivation = manager
      .setOverlayVisibility('roads', true)
      .catch((error: unknown) => error);
    const trafficActivation = manager.setOverlayVisibility('traffic', true);
    await Promise.resolve();
    const update = manager.updateService('roads', updatedRoads);
    projection.resolve();
    const map = await waitForFakeMap();
    map.emit('style.load');

    await expect(roadsActivation).resolves.toMatchObject({ name: 'AbortError' });
    await trafficActivation;
    await update;
    expect(host.reproject).toHaveBeenCalledTimes(1);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(manager.getServiceState('traffic')).toEqual({
      id: 'traffic',
      active: true,
      status: 'ready',
    });
    expect(map.layerOrder).toEqual(['roads-updated', 'traffic-casing', 'traffic-line']);
  });

  it('keeps an update pending until removal supersedes its in-flight import', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const manager = createMapLibreServiceManager(createHost(), {}, () => moduleLoad.promise);
    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };
    const addition = manager
      .addService({ ...roads, visible: true })
      .catch((error: unknown) => error);
    await Promise.resolve();
    let updateSettled = false;
    const update = manager.updateService('roads', updatedRoads).then(
      () => undefined,
      (error: unknown) => error,
    );
    void update.finally(() => {
      updateSettled = true;
    });

    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(updateSettled).toBe(false);

    await manager.removeService('roads');
    moduleLoad.resolve(fakeModule());

    await expect(addition).resolves.toMatchObject({ name: 'AbortError' });
    await expect(update).resolves.toMatchObject({ name: 'AbortError' });
    expect(manager.getServices()).toEqual([]);
    expect(manager.getMapLibreMap()).toBeNull();
    expect(FakeMap.instances).toHaveLength(0);
  });

  it('aborts visible add and active update when a later removal wins', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const loadMapLibre = vi.fn(() => moduleLoad.promise);
    const addManager = createMapLibreServiceManager(createHost(), {}, loadMapLibre);
    const addResult = addManager
      .addService({ ...roads, visible: true })
      .catch((error: unknown) => error);
    await Promise.resolve();
    await addManager.removeService('roads');
    moduleLoad.resolve(fakeModule());
    await expect(addResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(FakeMap.instances).toHaveLength(0);
    expect(addManager.getMapLibreMap()).toBeNull();
    expect(addManager.getServices()).toEqual([]);

    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };
    const active = createManager([roads]);
    const activeMap = await activateOverlay(active.manager);
    const updateResult = active.manager
      .updateService('roads', updatedRoads)
      .catch((error: unknown) => error);
    await active.manager.removeService('roads');
    await expect(updateResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(activeMap.sources.size).toBe(0);
    expect(activeMap.layers.size).toBe(0);
  });

  it('restores registration order after hide-show and active updates', async () => {
    const { manager } = createManager([roads, labels]);
    const first = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    map.emit('style.load');
    await first;
    await manager.setOverlayVisibility('labels', true);

    await manager.setOverlayVisibility('roads', false);
    await manager.setOverlayVisibility('roads', true);
    expect(map.layerOrder).toEqual(['roads-line', 'labels-symbol']);
    expect(map.operations).toContain('addLayer:roads-line:labels-symbol');

    await manager.updateService('roads', {
      ...roads,
      layers: [
        { id: 'roads-casing', type: 'line', source: 'roads' },
        { id: 'roads-line', type: 'line', source: 'roads' },
      ],
    });
    expect(map.layerOrder).toEqual(['roads-casing', 'roads-line', 'labels-symbol']);
  });

  it('restores the retained overlay definition and ready state when an active update fails', async () => {
    const { manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    const statuses: string[] = [];
    const updatedNames: string[] = [];
    const transitions: string[] = [];
    const errors: Array<{ phase: string; message: string }> = [];
    manager.on('change', (event) => {
      if (event.reason === 'status' && event.state) {
        statuses.push(event.state.status);
        transitions.push(`status:${event.state.status}`);
      }
      if (event.reason === 'update') {
        const currentName = manager.getServices()[0].name;
        updatedNames.push(currentName);
        transitions.push(`update:${currentName}`);
      }
    });
    manager.on('error', (event) => {
      errors.push({ phase: event.phase, message: event.error.message });
      transitions.push(`error:${event.phase}`);
    });
    const updateError = new Error('replacement layer failed');
    map.addFailures.set('layer:roads-updated', {
      mode: 'post-event',
      error: updateError,
    });
    const updatedRoads = {
      ...roads,
      name: 'Updated roads',
      layers: [{ id: 'roads-updated', type: 'line' as const, source: 'roads' }],
    };

    await expect(manager.updateService('roads', updatedRoads)).rejects.toBe(updateError);

    expect(manager.getServices()).toEqual([roads]);
    expect(manager.getServiceState('roads')).toEqual({
      id: 'roads',
      active: true,
      status: 'ready',
    });
    expect(map.layerOrder).toEqual(['roads-line']);
    expect(updatedNames).toEqual(['Updated roads', 'Roads']);
    expect(statuses).toEqual(['loading', 'error', 'loading', 'ready']);
    expect(transitions).toEqual([
      'update:Updated roads',
      'status:loading',
      'error:layer',
      'status:error',
      'update:Roads',
      'status:loading',
      'status:ready',
    ]);
    expect(errors).toEqual([{ phase: 'layer', message: 'replacement layer failed' }]);
  });

  it('retains ownership when partial-install rollback cannot remove a resource', async () => {
    const { manager } = createManager([traffic]);
    const activation = manager
      .setOverlayVisibility('traffic', true)
      .catch((error: unknown) => error);
    const map = await waitForFakeMap();
    map.addFailures.set('layer:traffic-line', {
      mode: 'throw',
      error: new Error('later layer failed'),
    });
    map.ignoredRemovals.add('traffic-casing');
    map.emit('style.load');

    await expect(activation).resolves.toBeInstanceOf(Error);
    expect(map.layers.has('traffic-casing')).toBe(true);

    map.ignoredRemovals.delete('traffic-casing');
    await manager.setOverlayVisibility('traffic', false);
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('emits one fatal style error when the initial style fails', async () => {
    const { manager } = createManager([roads]);
    const errors: Array<{ phase: string; fatal: boolean; serviceId?: string }> = [];
    manager.on('error', (event) =>
      errors.push({ phase: event.phase, fatal: event.fatal, serviceId: event.serviceId }),
    );
    const activation = manager.setOverlayVisibility('roads', true).catch((error: unknown) => error);
    const map = await waitForFakeMap();

    map.emit('error', { error: new Error('initial style failed') });

    await expect(activation).resolves.toBeInstanceOf(Error);
    expect(errors).toEqual([{ phase: 'style', fatal: true, serviceId: 'roads' }]);
  });

  it.each([
    'source',
    'layer',
  ] as const)('emits one fatal %s error for an unmanaged resource collision', async (phase) => {
    const { manager } = createManager([roads]);
    const errors: Array<{ phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push({ phase: event.phase, fatal: event.fatal }));
    const activation = manager.setOverlayVisibility('roads', true).catch((error: unknown) => error);
    const map = await waitForFakeMap();
    if (phase === 'source') map.addSource('roads', roads.sources.roads);
    else map.addLayer(roads.layers[0]);

    map.emit('style.load');

    await expect(activation).resolves.toBeInstanceOf(Error);
    expect(errors).toEqual([{ phase, fatal: true }]);
  });

  it.each([
    { phase: 'source' as const, key: 'source:roads', mode: 'event' as const },
    { phase: 'layer' as const, key: 'layer:roads-line', mode: 'throw' as const },
  ])('emits one fatal $phase error for a synchronous mutation failure', async (scenario) => {
    const { manager } = createManager([roads]);
    const errors: Array<{ phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push({ phase: event.phase, fatal: event.fatal }));
    const activation = manager.setOverlayVisibility('roads', true).catch((error: unknown) => error);
    const map = await waitForFakeMap();
    map.addFailures.set(scenario.key, {
      mode: scenario.mode,
      error: new Error(`${scenario.phase} mutation failed`),
    });

    map.emit('style.load');

    await expect(activation).resolves.toBeInstanceOf(Error);
    expect(errors).toEqual([{ phase: scenario.phase, fatal: true }]);
  });

  it.each([
    { phase: 'source' as const, key: 'source:roads', mode: 'post-throw' as const },
    { phase: 'layer' as const, key: 'layer:roads-line', mode: 'post-event' as const },
  ])('adopts and rolls back a $phase inserted before its mutation failure', async (scenario) => {
    const { manager } = createManager([roads]);
    const errors: Array<{ phase: string; message: string }> = [];
    manager.on('error', (event) =>
      errors.push({ phase: event.phase, message: event.error.message }),
    );
    const activationError = new Error(`${scenario.phase} failed after insertion`);
    const activation = manager.setOverlayVisibility('roads', true);
    const map = await waitForFakeMap();
    map.addFailures.set(scenario.key, {
      mode: scenario.mode,
      error: activationError,
    });

    map.emit('style.load');

    await expect(activation).rejects.toBe(activationError);
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
    if (scenario.phase === 'layer') {
      expect(map.operations).toEqual([
        'addSource:roads',
        'addLayer:roads-line:',
        'removeLayer:roads-line',
        'removeSource:roads',
      ]);
    }
    expect(errors).toEqual([
      { phase: scenario.phase, message: `${scenario.phase} failed after insertion` },
    ]);
  });

  it('retains a failed active removal for one typed cleanup retry', async () => {
    const { manager } = createManager([traffic]);
    const map = await activateOverlay(manager, 'traffic');
    const errors: Array<{ phase: string; fatal: boolean; serviceId?: string }> = [];
    const removals: Array<{ serviceId: string; state: unknown }> = [];
    manager.on('error', (event) =>
      errors.push({ phase: event.phase, fatal: event.fatal, serviceId: event.serviceId }),
    );
    manager.on('change', (event) => {
      if (event.reason === 'remove') {
        removals.push({ serviceId: event.serviceId, state: event.state });
      }
    });
    map.ignoredRemovals.add('traffic-line');

    await expect(manager.removeService('traffic')).rejects.toThrow('traffic-line');
    expect(manager.getServices()).toEqual([traffic]);
    expect(manager.getServiceState('traffic')).toMatchObject({
      active: false,
      status: 'error',
    });
    expect((map.options.container as HTMLElement).hidden).toBe(true);
    expect(removals).toEqual([]);
    expect(errors).toEqual([{ phase: 'layer', fatal: true, serviceId: 'traffic' }]);

    map.ignoredRemovals.delete('traffic-line');
    await manager.removeService('traffic');

    expect(manager.getServices()).toEqual([]);
    expect(manager.getServiceState('traffic')).toBeUndefined();
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
    expect(removals).toEqual([{ serviceId: 'traffic', state: undefined }]);
    expect(errors).toEqual([{ phase: 'layer', fatal: true, serviceId: 'traffic' }]);
  });

  it('rejects teardown when MapLibre fails a removal postcondition', async () => {
    const { manager } = createManager([traffic]);
    const map = await activateOverlay(manager, 'traffic');
    const errors: Array<{ phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push({ phase: event.phase, fatal: event.fatal }));
    map.ignoredRemovals.add('traffic-line');

    await expect(manager.setOverlayVisibility('traffic', false)).rejects.toThrow('traffic-line');
    expect(map.sources.has('traffic')).toBe(true);
    expect(map.layers.has('traffic-line')).toBe(true);
    expect((map.options.container as HTMLElement).hidden).toBe(true);
    expect(errors).toEqual([{ phase: 'layer', fatal: true }]);
    expect(manager.getServiceState('traffic')).toMatchObject({ active: false, status: 'error' });
  });
  it('style overlay visibility hides owned layers and restores their original visibility', async () => {
    const style = {
      ...brightStyle,
      layers: [
        brightStyle.layers[0],
        brightStyle.layers[1],
        { ...brightStyle.layers[2], layout: { visibility: 'none' as const } },
        brightStyle.layers[3],
      ],
    } as const satisfies maplibregl.StyleSpecification;
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('style.load');
    await addition;
    map.operations.length = 0;
    const initialSetStyleCalls = map.setStyleCalls.length;

    await manager.setOverlayVisibility('bright', false);
    expect(map.setStyleCalls).toHaveLength(initialSetStyleCalls);
    expect(map.operations).toEqual([
      'setLayoutProperty:emap-overlay:bright:land:visibility:none',
      'setLayoutProperty:emap-overlay:bright:roads:visibility:none',
      'setLayoutProperty:emap-overlay:bright:places:visibility:none',
    ]);

    map.operations.length = 0;
    await manager.setOverlayVisibility('bright', true);
    expect(map.operations).toEqual([
      'setLayoutProperty:emap-overlay:bright:land:visibility:visible',
      'setLayoutProperty:emap-overlay:bright:roads:visibility:none',
      'setLayoutProperty:emap-overlay:bright:places:visibility:visible',
    ]);
  });
  it('keeps a style overlay hidden when visibility changes during a visible composite generation', async () => {
    const darkObjectBasemap = { ...objectBasemap, id: 'dark', name: 'Dark' } as const;
    const { manager } = createManager([objectBasemap, darkObjectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('style.load');
    await addition;

    const switchRequest = manager.setBasemap('dark').catch((error: unknown) => error);
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'visible composite was not applied',
    );
    const staleStyleLoad = map.delayedStyleLoad();
    const hide = manager.setOverlayVisibility('bright', false);

    expect(manager.getServiceState('bright')).toEqual({
      id: 'bright',
      active: false,
      status: 'loading',
    });
    expect(map.setStyleCalls).toHaveLength(2);
    staleStyleLoad();
    await waitForCondition(
      () => map.setStyleCalls.length === 3,
      'hidden composite was not applied',
    );
    expect(map.sources.has('emap-overlay:bright:land')).toBe(true);
    map.emit('style.load');
    await hide;
    await expect(switchRequest).resolves.toMatchObject({ name: 'AbortError' });

    expect(manager.getServiceState('bright')).toEqual({
      id: 'bright',
      active: false,
      status: 'ready',
    });
    expect(
      map.getStyle().layers.find((layer) => layer.id === 'emap-overlay:bright:land')?.layout
        ?.visibility,
    ).toBe('none');
  });

  it('keeps a style overlay visible when visibility changes during a hidden composite generation', async () => {
    const darkObjectBasemap = { ...objectBasemap, id: 'dark', name: 'Dark' } as const;
    const { manager } = createManager([objectBasemap, darkObjectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('style.load');
    await addition;
    await manager.setOverlayVisibility('bright', false);

    const switchRequest = manager.setBasemap('dark').catch((error: unknown) => error);
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'hidden composite was not applied',
    );
    const staleStyleLoad = map.delayedStyleLoad();
    const show = manager.setOverlayVisibility('bright', true);

    expect(manager.getServiceState('bright')).toEqual({
      id: 'bright',
      active: true,
      status: 'loading',
    });
    expect(map.setStyleCalls).toHaveLength(2);
    staleStyleLoad();
    await waitForCondition(
      () => map.setStyleCalls.length === 3,
      'visible composite was not applied',
    );
    expect(map.sources.has('emap-overlay:bright:land')).toBe(true);
    map.emit('style.load');
    await show;
    await expect(switchRequest).resolves.toMatchObject({ name: 'AbortError' });

    expect(manager.getServiceState('bright')).toEqual({
      id: 'bright',
      active: true,
      status: 'ready',
    });
    expect(
      map.getStyle().layers.find((layer) => layer.id === 'emap-overlay:bright:land')?.layout
        ?.visibility ?? 'visible',
    ).toBe('visible');
  });
  it('removes the final style overlay through an empty style generation without a basemap', async () => {
    const style = {
      ...brightStyle,
      sprite: 'https://one.test/sprite',
      glyphs: 'https://fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const { manager } = createManager([
      { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style },
    ]);
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'initial style overlay reconciliation did not start',
    );
    map.emit('style.load');
    await initialization;

    const removal = manager.removeService('bright');
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'final style overlay removal did not start an empty generation',
    );
    expect(map.setStyleCalls.at(-1)).toEqual(EMPTY_STYLE);
    expect(map.listenerCount('style.load')).toBe(1);
    map.emit('style.load');
    await removal;

    const nativeStyle = map.getStyle();
    expect(nativeStyle).toEqual(EMPTY_STYLE);
    expect(nativeStyle.sources).not.toHaveProperty('emap-overlay:bright:land');
    expect(nativeStyle.layers.map((layer) => layer.id)).not.toEqual(
      expect.arrayContaining([
        'emap-overlay:bright:land',
        'emap-overlay:bright:roads',
        'emap-overlay:bright:places',
      ]),
    );
    expect(nativeStyle).not.toHaveProperty('sprite');
    expect(nativeStyle).not.toHaveProperty('glyphs');
    expect(manager.getServices()).toEqual([]);
    expect(manager.getServiceState('bright')).toBeUndefined();
    expect((map.options.container as HTMLElement).hidden).toBe(true);
  });
  it('removes the sole style overlay while its fetch preparation is pending without retaining a request', async () => {
    FakeMap.instances.length = 0;
    const started = deferred<void>();
    const fetchStyle = vi.fn(async (_url: string, options?: RequestInit) => {
      started.resolve();
      await new Promise<void>((_resolve, reject) =>
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
      return new Response(JSON.stringify(brightStyle));
    });
    const { manager } = createManager([], { fetchStyle });
    const activation = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: 'https://example.test/bright.json',
    });
    await started.promise;
    await manager.removeService('bright');

    await expect(activation).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeMap.instances).toEqual([]);
    expect(manager.getServiceState('bright')).toBeUndefined();
  });

  it('removes the sole applied style overlay through an empty generation before its first style load', async () => {
    const style = {
      ...brightStyle,
      sprite: 'https://one.test/sprite',
      glyphs: 'https://fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const { manager } = createManager([
      { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style },
    ]);
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'initial style overlay generation did not start',
    );

    const removal = manager.removeService('bright');
    await Promise.resolve();
    expect(map.setStyleCalls).toHaveLength(1);

    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'removal did not replace the applied style with an empty generation',
    );
    expect(map.setStyleCalls.at(-1)).toEqual(EMPTY_STYLE);
    map.emit('style.load');
    await Promise.all([initialization, removal]);

    expect(map.getStyle()).toEqual(EMPTY_STYLE);
    expect(map.sources).toEqual(new Map());
    expect(map.layers).toEqual(new Map());
    expect(manager.getServiceState('bright')).toBeUndefined();
  });

  it('style overlay removal and update rebuild their complete composite resources', async () => {
    const oldStyle = { ...brightStyle, glyphs: undefined } as const;
    const replacementStyle = {
      ...brightStyle,
      glyphs: undefined,
      sources: {
        replacement: { type: 'vector' as const, url: 'https://example.test/replacement.json' },
      },
      layers: [{ id: 'replacement', type: 'fill' as const, source: 'replacement' }],
    } as const;
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: oldStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('style.load');
    await addition;

    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Replacement',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'replacement was not composed');
    map.emit('style.load');
    await update;
    expect(map.sources.has('emap-overlay:bright:land')).toBe(false);
    expect(map.layers.has('emap-overlay:bright:land')).toBe(false);
    expect(map.layers.has('emap-overlay:bright:replacement')).toBe(true);

    const removal = manager.removeService('bright');
    await waitForCondition(() => map.setStyleCalls.length === 3, 'removal was not composed');
    map.emit('style.load');
    await removal;
    expect(map.sources.has('emap-overlay:bright:replacement')).toBe(false);
    expect(map.layers.has('emap-overlay:bright:replacement')).toBe(false);
    expect(map.appliedStyles.at(-1)?.sources).not.toHaveProperty('emap-overlay:bright:replacement');
  });

  it('sprite namespace keeps two style overlays while conflicting glyph URL rolls back', async () => {
    const first = {
      ...brightStyle,
      sprite: 'https://one.test/sprite',
      glyphs: 'https://fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const second = {
      ...brightStyle,
      sprite: 'https://two.test/sprite',
      glyphs: 'https://fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const conflict = {
      ...brightStyle,
      sprite: 'https://three.test/sprite',
      glyphs: 'https://other-fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const one = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: first,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'first style was not composed');
    map.emit('style.load');
    await one;
    const two = manager.addService({
      id: 'two',
      name: 'Two',
      role: 'overlay',
      visible: true,
      style: second,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'second style was not composed');
    map.emit('style.load');
    await two;
    await manager.addService({ id: 'three', name: 'Three', role: 'overlay', style: conflict });
    expect(map.appliedStyles.at(-1)?.sprite).toEqual([
      { id: 'emap-overlay:one:default', url: 'https://one.test/sprite' },
      { id: 'emap-overlay:two:default', url: 'https://two.test/sprite' },
    ]);

    const errors: Array<{ serviceId?: string; fatal: boolean; phase: string }> = [];
    manager.on('error', (event) => errors.push(event));
    const activation = manager.setOverlayVisibility('three', true);
    await expect(activation).rejects.toThrow('glyphs URL conflicts');
    expect(errors.filter((event) => event.serviceId === 'three' && event.fatal)).toHaveLength(1);
    expect(manager.getServiceState('one')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('light')).toMatchObject({ active: true, status: 'ready' });
    expect(map.sources.has('base')).toBe(true);
    expect(map.layers.has('base-fill')).toBe(true);
    await manager.setOverlayVisibility('one', false);
    await manager.setOverlayVisibility('one', true);
    expect(manager.getServiceState('one')).toMatchObject({ active: true, status: 'ready' });
    expect(map.appliedStyles.at(-1)?.sprite).toEqual([
      { id: 'emap-overlay:one:default', url: 'https://one.test/sprite' },
      { id: 'emap-overlay:two:default', url: 'https://two.test/sprite' },
    ]);
  });
  it('style overlay visibility prepares on first show and preserves cached hidden layers across a basemap switch', async () => {
    const fetchStyle = vi.fn(async () => new Response(JSON.stringify(brightStyle)));
    const styleOverlay = {
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      style: 'https://example.test/bright.json',
    } as const;
    const alternateBasemap = {
      ...objectBasemap,
      id: 'dark',
      name: 'Dark',
      style: {
        ...objectBasemap.style,
        layers: [{ id: 'dark-fill', type: 'fill' as const, source: 'base' }],
      },
    } as const;
    const { manager } = createManager(
      [objectBasemap, alternateBasemap, { ...roads, visible: true }, styleOverlay],
      {
        fetchStyle,
      },
    );
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    expect(fetchStyle).not.toHaveBeenCalled();
    await manager.setOverlayVisibility('bright', false);
    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.setStyleCalls).toHaveLength(0);

    const show = manager.setOverlayVisibility('bright', true);
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'first show did not compose style',
    );
    map.emit('style.load');
    await show;
    expect(fetchStyle).toHaveBeenCalledTimes(1);
    expect(map.layerOrder).toEqual([
      'base-fill',
      'roads-line',
      'emap-overlay:bright:land',
      'emap-overlay:bright:roads',
      'emap-overlay:bright:places',
    ]);

    await manager.setOverlayVisibility('bright', false);
    const switchRequest = manager.setBasemap('dark');
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'basemap switch did not compose style',
    );
    map.emit('style.load');
    await switchRequest;

    expect(
      map.getStyle().layers.filter((layer) => layer.id.startsWith('emap-overlay:bright:')),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ layout: expect.objectContaining({ visibility: 'none' }) }),
      ]),
    );
    expect(map.layerOrder).toEqual([
      'dark-fill',
      'roads-line',
      'emap-overlay:bright:land',
      'emap-overlay:bright:roads',
      'emap-overlay:bright:places',
    ]);
    const setStyleCalls = map.setStyleCalls.length;
    await manager.setOverlayVisibility('bright', true);
    expect(map.setStyleCalls).toHaveLength(setStyleCalls);
    expect(map.layerOrder).toEqual([
      'dark-fill',
      'roads-line',
      'emap-overlay:bright:land',
      'emap-overlay:bright:roads',
      'emap-overlay:bright:places',
    ]);
  });

  it('style overlay update defers an inactive replacement fetch until show', async () => {
    const fetchStyle = vi.fn(async () => new Response(JSON.stringify(brightStyle)));
    const original = {
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      style: 'https://example.test/original.json',
    } as const;
    const replacement = {
      ...original,
      name: 'Replacement',
      style: 'https://example.test/new.json',
    };
    const { manager } = createManager([objectBasemap, original], { fetchStyle });
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    await manager.updateService('bright', replacement);
    expect(fetchStyle).not.toHaveBeenCalled();

    const show = manager.setOverlayVisibility('bright', true);
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'show did not compose replacement',
    );
    map.emit('style.load');
    await show;
    expect(fetchStyle).toHaveBeenCalledWith('https://example.test/new.json', expect.any(Object));
  });

  it('style overlay update restores the old definition and resources after an applied style error', async () => {
    const oldStyle = brightStyle;
    const replacementStyle = {
      ...brightStyle,
      sources: {
        replacement: { type: 'vector' as const, url: 'https://example.test/replacement.json' },
      },
      layers: [{ id: 'replacement', type: 'fill' as const, source: 'replacement' }],
    } as const;
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: oldStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'initial style was not composed');
    map.emit('style.load');
    await addition;

    const errors: Array<{
      type: 'error';
      serviceId?: string;
      phase: string;
      error: Error;
      fatal: boolean;
    }> = [];
    manager.on('error', (event) => errors.push(event));
    const styleError = new Error('replacement style failed after setStyle');
    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Replacement',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'replacement was not composed');
    map.emit('error', { error: styleError });
    await waitForCondition(() => map.setStyleCalls.length === 4, 'rollback style was not composed');
    map.emit('style.load');

    await expect(update).rejects.toBe(styleError);
    expect(errors).toEqual([
      { type: 'error', serviceId: 'bright', phase: 'style', error: styleError, fatal: true },
    ]);
    expect(manager.getServices().find((service) => service.id === 'bright')).toMatchObject({
      name: 'Bright',
      style: oldStyle,
    });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
    expect(map.sources.has('base')).toBe(true);
    expect(map.layers.has('base-fill')).toBe(true);
    expect(map.sources.has('emap-overlay:bright:land')).toBe(true);
    expect(map.layers.has('emap-overlay:bright:land')).toBe(true);
    expect(map.sources.has('emap-overlay:bright:replacement')).toBe(false);
    expect(map.layers.has('emap-overlay:bright:replacement')).toBe(false);
  });

  it('attributes an applied style update rollback error to a non-trigger resource owner', async () => {
    const otherStyle = {
      version: 8,
      sources: {
        other: { type: 'vector' as const, url: 'https://example.test/other.json' },
      },
      layers: [{ id: 'other', type: 'fill' as const, source: 'other' }],
    } as const satisfies maplibregl.StyleSpecification;
    const replacementStyle = {
      ...brightStyle,
      sources: {
        replacement: { type: 'vector' as const, url: 'https://example.test/replacement.json' },
      },
      layers: [{ id: 'replacement', type: 'fill' as const, source: 'replacement' }],
    } as const;
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    const other = manager.addService({
      id: 'other',
      name: 'Other',
      role: 'overlay',
      visible: true,
      style: otherStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'other style was not composed');
    map.emit('style.load');
    await other;
    const bright = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'bright style was not composed');
    map.emit('style.load');
    await bright;

    const errors: Array<{
      type: 'error';
      serviceId?: string;
      phase: string;
      error: Error;
      fatal: boolean;
    }> = [];
    manager.on('error', (event) => errors.push(event));
    const styleError = new Error('other resource failed while bright updated');
    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Replacement',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 3, 'replacement was not composed');
    map.emit('error', { error: styleError, resourceUrl: 'https://example.test/other.json' });
    await waitForCondition(() => map.setStyleCalls.length === 5, 'rollback style was not composed');
    map.emit('style.load');

    await expect(update).rejects.toBe(styleError);
    expect(errors).toEqual([
      { type: 'error', serviceId: 'other', phase: 'style', error: styleError, fatal: true },
    ]);
    expect(manager.getServices().find((service) => service.id === 'bright')).toMatchObject({
      name: 'Bright',
      style: brightStyle,
    });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('other')).toMatchObject({ active: true, status: 'ready' });
  });

  it('attributes a late transformed sprite error to its owner while rolling back an updated overlay', async () => {
    const transformRequest = vi.fn((url: string) => ({
      url: `https://proxy.example.test/?url=${encodeURIComponent(url)}`,
    }));
    const firstStyle = {
      ...brightStyle,
      sprite: 'https://one.example.test/sprite',
      sources: {
        first: { type: 'vector' as const, url: 'https://one.example.test/tiles.json' },
      },
      layers: [{ id: 'first', type: 'fill' as const, source: 'first' }],
    } as const satisfies maplibregl.StyleSpecification;
    const secondStyle = {
      ...brightStyle,
      sprite: 'https://two.example.test/sprite',
      sources: {
        second: { type: 'vector' as const, url: 'https://two.example.test/tiles.json' },
      },
      layers: [{ id: 'second', type: 'fill' as const, source: 'second' }],
    } as const satisfies maplibregl.StyleSpecification;
    const replacementStyle = {
      ...secondStyle,
      sprite: 'https://replacement.example.test/sprite',
      sources: {
        replacement: {
          type: 'vector' as const,
          url: 'https://replacement.example.test/tiles.json',
        },
      },
      layers: [{ id: 'replacement', type: 'fill' as const, source: 'replacement' }],
    } as const satisfies maplibregl.StyleSpecification;
    const { manager } = createManager([objectBasemap], {
      mapOptions: { transformRequest: transformRequest as never },
    });
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    const first = manager.addService({
      id: 'first',
      name: 'First',
      role: 'overlay',
      visible: true,
      style: firstStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'first style was not composed');
    map.emit('style.load');
    await first;
    const second = manager.addService({
      id: 'second',
      name: 'Second',
      role: 'overlay',
      visible: true,
      style: secondStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'second style was not composed');
    map.emit('style.load');
    await second;

    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push(event));
    const update = manager.updateService('second', {
      id: 'second',
      name: 'Updated second',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(
      () => map.setStyleCalls.length === 3,
      'replacement style was not composed',
    );
    const rawSprite = `${firstStyle.sprite}@2x.png`;
    const rewrittenSprite = map.options.transformRequest?.(rawSprite, 'Sprite')?.url;
    map.emit('style.load');
    await update;

    map.emit('error', { error: new Error('late first sprite failed'), url: rewrittenSprite });
    await waitForCondition(() => map.setStyleCalls.length === 5, 'rollback style was not composed');
    map.emit('style.load');
    await waitForCondition(
      () => manager.getServiceState('second')?.status === 'ready',
      'rolled-back overlay did not recover',
    );

    expect(errors.map(({ serviceId, phase, fatal }) => ({ serviceId, phase, fatal }))).toEqual([
      { serviceId: 'first', phase: 'style', fatal: true },
    ]);
    expect(manager.getServiceState('first')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('second')).toMatchObject({ active: true, status: 'ready' });
    expect(map.sources.has('base')).toBe(true);
    expect(map.layers.has('base-fill')).toBe(true);
    expect(map.appliedStyles.at(-1)?.sprite).toEqual([
      { id: 'emap-overlay:first:default', url: firstStyle.sprite },
      { id: 'emap-overlay:second:default', url: secondStyle.sprite },
    ]);
  });

  it.each([
    ['sprite ID', { spriteId: 'base-sprite' }, 'style'],
    ['source ID', { sourceId: 'base-source' }, 'source'],
    ['glyph URL', { glyphUrl: 'https://example.test/base/{fontstack}/{range}.pbf' }, 'style'],
  ])('attributes a committed basemap %s failure after a style overlay update to the basemap', async (_kind, details, phase) => {
    const basemap = {
      ...objectBasemap,
      style: {
        version: 8,
        sprite: [{ id: 'base-sprite', url: 'https://example.test/base-sprite' }],
        glyphs: 'https://example.test/base/{fontstack}/{range}.pbf',
        sources: {
          'base-source': { type: 'vector', url: 'https://example.test/base-source.json' },
        },
        layers: [{ id: 'base-layer', type: 'fill', source: 'base-source' }],
      },
    } as const;
    const { manager } = createManager([basemap]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: { ...brightStyle, glyphs: undefined },
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay was not composed');
    map.emit('style.load');
    await addition;

    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Updated bright',
      role: 'overlay',
      visible: true,
      style: {
        ...brightStyle,
        glyphs: undefined,
        sources: {
          replacement: { type: 'vector', url: 'https://example.test/replacement.json' },
        },
        layers: [{ id: 'replacement', type: 'line', source: 'replacement' }],
      },
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'overlay update was not composed');
    map.emit('style.load');
    await update;

    const events: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    const basemapStates: string[] = [];
    manager.on('error', (event) =>
      events.push({ serviceId: event.serviceId, phase: event.phase, fatal: event.fatal }),
    );
    manager.on('change', (event) => {
      if (event.serviceId === 'light' && event.reason === 'status' && event.state) {
        basemapStates.push(event.state.status);
      }
    });
    map.emit('error', { error: new Error('committed basemap resource failed'), ...details });

    expect(events[0]).toEqual({ serviceId: 'light', phase, fatal: true });
    expect(basemapStates).toContain('error');
    expect(manager.getServiceState('bright')).toMatchObject({ status: 'ready' });
  });

  it('attributes a transformed overlay sprite request to an existing overlay during a basemap recomposition', async () => {
    const dark = { ...objectBasemap, id: 'dark', name: 'Dark' } as const;
    const transformRequest = vi.fn((url: string) => ({
      url: `https://proxy.example.test/?url=${encodeURIComponent(url)}`,
    }));
    const { manager } = createManager([objectBasemap, dark], {
      mapOptions: { transformRequest: transformRequest as never },
    });
    const light = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await light;
    const overlay = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay style was not composed');
    map.emit('style.load');
    await overlay;

    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push(event));
    const switchResult = manager.setBasemap('dark').catch((error: unknown) => error);
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'basemap recomposition did not start',
    );
    const rawSprite = `${brightStyle.sprite}@2x.json`;
    const rewrittenSprite = map.options.transformRequest?.(rawSprite, 'Sprite')?.url;
    expect(rewrittenSprite).toBe(
      `https://proxy.example.test/?url=${encodeURIComponent(rawSprite)}`,
    );

    map.emit('error', { error: new Error('rewritten sprite failed'), url: rewrittenSprite });
    await switchResult;

    expect(errors.map(({ serviceId, phase, fatal }) => ({ serviceId, phase, fatal }))).toEqual([
      { serviceId: 'bright', phase: 'style', fatal: true },
    ]);
    expect(manager.getServiceState('bright')).toMatchObject({ active: false, status: 'error' });
    expect(manager.getServiceState('dark')).not.toMatchObject({ status: 'error' });
  });

  it('attributes a transformed resource URL to its non-trigger style overlay', async () => {
    const transformRequest = vi.fn((url: string) => ({
      url: `https://proxy.example.test/?url=${encodeURIComponent(url)}`,
    }));
    const otherStyle = {
      ...brightStyle,
      sprite: 'https://other.example.test/sprite',
      glyphs: brightStyle.glyphs,
      sources: { other: { type: 'vector' as const, url: 'https://other.example.test/tiles.json' } },
      layers: [{ id: 'other', type: 'fill' as const, source: 'other' }],
    } as const satisfies maplibregl.StyleSpecification;
    const { manager } = createManager([objectBasemap], {
      mapOptions: { transformRequest: transformRequest as never },
    });
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const other = manager.addService({
      id: 'other',
      name: 'Other',
      role: 'overlay',
      visible: true,
      style: otherStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'first overlay was not composed');
    map.emit('style.load');
    await other;

    const bright = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'second overlay was not composed');
    map.emit('style.load');
    await bright;
    const trigger = manager.updateService('bright', {
      id: 'bright',
      name: 'Updated bright',
      role: 'overlay',
      visible: true,
      style: {
        ...brightStyle,
        sources: {
          replacement: {
            type: 'vector' as const,
            url: 'https://bright.example.test/replacement.json',
          },
        },
        layers: [{ id: 'replacement', type: 'fill' as const, source: 'replacement' }],
      },
    });
    await waitForCondition(() => map.setStyleCalls.length === 3, 'trigger update was not composed');

    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push(event));
    const rawSource = otherStyle.sources.other.url;
    const rewrittenSource = map.options.transformRequest?.(rawSource, 'Source')?.url;
    map.emit('error', { error: new Error('rewritten source failed'), url: rewrittenSource });
    await waitForCondition(() => map.setStyleCalls.length === 5, 'rollback style was not composed');
    map.emit('style.load');
    await expect(trigger).rejects.toThrow('rewritten source failed');

    expect(errors.map(({ serviceId, phase, fatal }) => ({ serviceId, phase, fatal }))).toEqual([
      { serviceId: 'other', phase: 'style', fatal: true },
    ]);
    expect(manager.getServiceState('other')).toMatchObject({ active: true, status: 'ready' });
  });

  it('attributes a transformed sprite error emitted after style.load to the committed overlay', async () => {
    const transformRequest = vi.fn((url: string) => ({
      url: `https://proxy.example.test/?url=${encodeURIComponent(url)}`,
    }));
    const { manager } = createManager(
      [{ id: 'bright', name: 'Bright', role: 'overlay', visible: true, style: brightStyle }],
      { mapOptions: { transformRequest: transformRequest as never } },
    );
    const initialization = manager.initialize();
    const map = await waitForFakeMap();
    map.emit('style.load');
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay style was not composed');
    map.emit('style.load');
    await initialization;

    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push(event));
    const rawSprite = `${brightStyle.sprite}@2x.png`;
    const rewrittenSprite = map.options.transformRequest?.(rawSprite, 'Sprite')?.url;
    map.emit('error', { error: new Error('late sprite failed'), url: rewrittenSprite });

    expect(errors.map(({ serviceId, phase, fatal }) => ({ serviceId, phase, fatal }))).toEqual([
      { serviceId: 'bright', phase: 'style', fatal: true },
    ]);
    expect(manager.getServiceState('bright')).toMatchObject({ active: false, status: 'error' });
  });

  it('does not let a transformed stale committed resource error change the current overlay state', async () => {
    const transformRequest = vi.fn((url: string) => ({
      url: `https://proxy.example.test/?url=${encodeURIComponent(url)}`,
    }));
    const oldStyle = {
      ...brightStyle,
      sources: { old: { type: 'vector' as const, url: 'https://old.example.test/tiles.json' } },
      layers: [{ id: 'old', type: 'fill' as const, source: 'old' }],
    } as const satisfies maplibregl.StyleSpecification;
    const currentStyle = {
      ...brightStyle,
      sources: {
        current: { type: 'vector' as const, url: 'https://current.example.test/tiles.json' },
      },
      layers: [{ id: 'current', type: 'fill' as const, source: 'current' }],
    } as const satisfies maplibregl.StyleSpecification;
    const { manager } = createManager([objectBasemap], {
      mapOptions: { transformRequest: transformRequest as never },
    });
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: oldStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'old style was not composed');
    map.emit('style.load');
    await addition;
    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: currentStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'current style was not composed');
    map.emit('style.load');
    await update;

    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) => errors.push(event));
    const rewrittenOldSource = map.options.transformRequest?.(
      oldStyle.sources.old.url,
      'Source',
    )?.url;
    map.emit('error', { error: new Error('stale source failed'), url: rewrittenOldSource });

    expect(errors.filter((event) => event.fatal)).toEqual([]);
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
  });

  it('style overlay update restores the previous prepared style and ready resources after a failure', async () => {
    const oldStyle = brightStyle;
    const replacementStyle = {
      ...brightStyle,
      glyphs: 'https://other-fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const glyphBasemap = {
      ...objectBasemap,
      style: { ...objectBasemap.style, glyphs: oldStyle.glyphs },
    } as const;
    const { manager } = createManager([glyphBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: oldStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'initial style was not composed');
    map.emit('style.load');
    await addition;

    const failedUpdate = manager.updateService('bright', {
      id: 'bright',
      name: 'Replacement',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'rollback style was not composed');
    map.emit('style.load');
    await expect(failedUpdate).rejects.toThrow('glyphs URL conflicts');
    expect(manager.getServices().find((service) => service.id === 'bright')).toMatchObject({
      name: 'Bright',
      style: oldStyle,
    });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
    expect(map.layers.has('emap-overlay:bright:land')).toBe(true);
  });

  it('style overlay removal removes its sprite and sole glyph URL', async () => {
    const style = {
      ...brightStyle,
      sprite: 'https://one.test/sprite',
      glyphs: 'https://fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('style.load');
    await addition;

    const removal = manager.removeService('bright');
    await waitForCondition(() => map.setStyleCalls.length === 2, 'removal was not composed');
    map.emit('style.load');
    await removal;
    expect(map.appliedStyles.at(-1)).not.toHaveProperty('glyphs');
    expect(map.appliedStyles.at(-1)).not.toHaveProperty('sprite');
  });

  it('style overlay update rejects a cross-form replacement without leaving stale resources', async () => {
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('style.load');
    await addition;

    await expect(
      manager.updateService('bright', {
        id: 'bright',
        name: 'Resources',
        role: 'overlay',
        sources: { resources: { type: 'vector', url: 'https://example.test/resources.json' } },
        layers: [{ id: 'resources', type: 'line', source: 'resources' }],
      }),
    ).rejects.toThrow('overlay form cannot change');
    expect(manager.getServices().find((service) => service.id === 'bright')).toMatchObject({
      style: brightStyle,
    });
    expect(map.layers.has('emap-overlay:bright:land')).toBe(true);
  });
  it('glyph URL conflicts roll back a basemap switch while the active style overlay remains ready', async () => {
    const glyphOverlay = {
      ...brightStyle,
      glyphs: 'https://fonts.test/{fontstack}/{range}.pbf',
    } as const;
    const conflictingBasemap = {
      ...objectBasemap,
      id: 'dark',
      name: 'Dark',
      style: {
        ...objectBasemap.style,
        glyphs: 'https://other-fonts.test/{fontstack}/{range}.pbf',
      },
    } as const;
    const { manager } = createManager([objectBasemap, conflictingBasemap]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;
    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: glyphOverlay,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay was not composed');
    map.emit('style.load');
    await addition;

    const switchRequest = manager.setBasemap('dark');
    await expect(switchRequest).rejects.toThrow('glyphs URL conflicts');
    await waitForCondition(() => map.setStyleCalls.length === 2, 'old basemap was not restored');
    map.emit('style.load');
    expect(manager.getServiceState('light')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('dark')).toMatchObject({ active: false, status: 'error' });
  });
  it('composes visible style overlays into the initial blank, object, and URL basemap generations', async () => {
    const blank = createManager([
      { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style: brightStyle },
    ]);
    const blankInitialization = blank.manager.initialize();
    const blankMap = await waitForFakeMap();
    expect(blankMap.options.style).toMatchObject({
      sources: { 'emap-overlay:bright:land': expect.anything() },
    });
    blankMap.emit('style.load');
    await waitForCondition(
      () => blankMap.setStyleCalls.length === 1,
      'blank style did not reconcile',
    );
    blankMap.emit('style.load');
    await blankInitialization;
    expect(blank.manager.getServiceState('bright')).toMatchObject({
      active: true,
      status: 'ready',
    });
    expect(blankMap.layers.has('emap-overlay:bright:land')).toBe(true);

    const object = createManager(
      [
        objectBasemap,
        { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style: brightStyle },
      ],
      { defaultBasemap: 'light' },
    );
    const objectInitialization = object.manager.initialize();
    const objectMap = await waitForFakeMap();
    expect(objectMap.options.style).toMatchObject({
      sources: {
        base: expect.anything(),
        'emap-overlay:bright:land': expect.anything(),
      },
    });
    objectMap.emit('style.load');
    await waitForCondition(
      () => objectMap.setStyleCalls.length === 1,
      'object style did not reconcile',
    );
    objectMap.emit('style.load');
    await objectInitialization;
    expect(object.manager.getServiceState('bright')).toMatchObject({
      active: true,
      status: 'ready',
    });
    expect(objectMap.layers.has('base-fill')).toBe(true);
    expect(objectMap.layers.has('emap-overlay:bright:land')).toBe(true);

    const styleUrl = 'https://example.test/url-style.json';
    const urlBasemap = { ...base, style: styleUrl } as const;
    const url = createManager(
      [
        urlBasemap,
        { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style: brightStyle },
      ],
      {
        defaultBasemap: 'light',
        fetchStyle: vi.fn(async () => new Response(JSON.stringify(objectBasemap.style))),
      },
    );
    const urlInitialization = url.manager.initialize();
    const urlMap = await waitForFakeMap();
    expect(urlMap.options.style).toMatchObject({
      sources: {
        base: expect.anything(),
        'emap-overlay:bright:land': expect.anything(),
      },
    });
    urlMap.emit('style.load');
    await waitForCondition(() => urlMap.setStyleCalls.length === 1, 'URL style did not reconcile');
    urlMap.emit('style.load');
    await urlInitialization;
    expect(url.manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
    expect(urlMap.layers.has('base-fill')).toBe(true);
    expect(urlMap.layers.has('emap-overlay:bright:land')).toBe(true);
  });
  it('passes precomposed object styles directly for established-map overlay changes', async () => {
    const replacementStyle = {
      ...brightStyle,
      sources: {
        replacement: { type: 'vector' as const, url: 'https://example.test/replacement.json' },
      },
      layers: [{ id: 'replacement', type: 'line' as const, source: 'replacement' }],
    } as const satisfies maplibregl.StyleSpecification;
    const darkObjectBasemap = { ...objectBasemap, id: 'dark', name: 'Dark' } as const;
    const { manager } = createManager([objectBasemap, darkObjectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay style did not apply');
    expect(map.setStyleCalls.at(-1)).toMatchObject({
      sources: { base: expect.anything(), 'emap-overlay:bright:land': expect.anything() },
    });
    expect(map.setStyleOptions.at(-1)).toEqual({ diff: false });
    expect(map.setStyleOptions.at(-1)?.transformStyle).toBeUndefined();
    map.emit('style.load');
    await addition;

    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Replacement',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'replacement style did not apply');
    expect(map.setStyleCalls.at(-1)).toMatchObject({
      sources: { base: expect.anything(), 'emap-overlay:bright:replacement': expect.anything() },
    });
    expect(map.setStyleOptions.at(-1)).toEqual({ diff: false });
    expect(map.setStyleOptions.at(-1)?.transformStyle).toBeUndefined();
    map.emit('style.load');
    await update;

    const switchRequest = manager.setBasemap('dark');
    await waitForCondition(() => map.setStyleCalls.length === 3, 'basemap switch did not apply');
    expect(map.setStyleCalls.at(-1)).toMatchObject({
      sources: { base: expect.anything(), 'emap-overlay:bright:replacement': expect.anything() },
    });
    expect(map.setStyleOptions.at(-1)).toEqual({ diff: false });
    expect(map.setStyleOptions.at(-1)?.transformStyle).toBeUndefined();
    map.emit('style.load');
    await switchRequest;
    expect(manager.getServiceState('dark')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
  });
  it('updates and removes URL style overlays with one established-map rebuild each', async () => {
    const styleUrl = 'https://example.test/url-style.json';
    const replacementStyle = {
      ...brightStyle,
      sources: {
        replacement: { type: 'vector' as const, url: 'https://example.test/replacement.json' },
      },
      layers: [{ id: 'replacement', type: 'line' as const, source: 'replacement' }],
    } as const;
    const { manager } = createManager([{ ...base, style: styleUrl }], {
      fetchStyle: vi.fn(async () => new Response(JSON.stringify(objectBasemap.style))),
    });
    FakeMap.urlStyles.set(styleUrl, objectBasemap.style);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;

    const addition = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'URL overlay was not composed');
    map.emit('style.load');
    await addition;

    const update = manager.updateService('bright', {
      id: 'bright',
      name: 'Replacement',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 2, 'URL update was not composed');
    map.emit('style.load');
    await update;
    expect(map.setStyleCalls).toHaveLength(2);

    const removal = manager.removeService('bright');
    await waitForCondition(() => map.setStyleCalls.length === 3, 'URL removal was not composed');
    map.emit('style.load');
    await removal;
    expect(map.setStyleCalls).toHaveLength(3);
  });
  it('attributes tile and source errors during a basemap switch to the detached style overlay', async () => {
    const { manager } = createManager([
      objectBasemap,
      { ...objectBasemap, id: 'dark', name: 'Dark' },
    ]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;
    const overlay = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay was not composed');
    map.emit('style.load');
    await overlay;

    const events: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) =>
      events.push({ serviceId: event.serviceId, phase: event.phase, fatal: event.fatal }),
    );
    const switchRequest = manager.setBasemap('dark');
    await waitForCondition(() => map.setStyleCalls.length === 2, 'basemap switch was not composed');
    const sourceId = 'emap-overlay:bright:land';
    map.emit('error', { error: new Error('overlay tile failed'), tile: {}, sourceId });
    map.emit('error', { error: new Error('overlay source failed'), sourceId });
    map.emit('style.load');
    await switchRequest;

    expect(events).toEqual([
      { serviceId: 'bright', phase: 'tile', fatal: false },
      { serviceId: 'bright', phase: 'source', fatal: true },
    ]);
  });

  it.each([
    ['resource URL', { resourceUrl: 'https://tiles.openfreemap.org/land.json' }],
    ['sprite ID', { spriteId: 'emap-overlay:one:default' }],
    ['glyph URL', { glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf' }],
  ])('attributes an applied %s failure to the non-triggering style overlay', async (_kind, details) => {
    const { manager } = createManager([objectBasemap]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;
    const first = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'first overlay was not composed');
    map.emit('style.load');
    await first;

    const events: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
    manager.on('error', (event) =>
      events.push({ serviceId: event.serviceId, phase: event.phase, fatal: event.fatal }),
    );
    const second = manager
      .addService({
        id: 'two',
        name: 'Two',
        role: 'overlay',
        visible: true,
        style: {
          ...brightStyle,
          glyphs: undefined,
          sources: {
            second: { type: 'vector', url: 'https://example.test/second.json' },
          },
          layers: [{ id: 'second', type: 'line', source: 'second' }],
        },
      })
      .catch((error: unknown) => error);
    await waitForCondition(() => map.setStyleCalls.length === 2, 'second overlay was not composed');
    map.emit('error', { error: new Error('non-trigger overlay resource failed'), ...details });

    await expect(second).resolves.toBeInstanceOf(Error);
    expect(events[0]).toEqual({ serviceId: 'one', phase: 'style', fatal: true });
  });

  it('attributes applied composite style errors to the trigger overlay', async () => {
    const { manager } = createManager([objectBasemap]);
    const basemap = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await basemap;
    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean; message: string }> =
      [];
    manager.on('error', (event) =>
      errors.push({
        serviceId: event.serviceId,
        phase: event.phase,
        fatal: event.fatal,
        message: event.error.message,
      }),
    );
    const addition = manager
      .addService({
        id: 'bright',
        name: 'Bright',
        role: 'overlay',
        visible: true,
        style: brightStyle,
      })
      .catch((error: unknown) => error);
    await waitForCondition(() => map.setStyleCalls.length === 1, 'style was not composed');
    map.emit('error', { error: new Error('sprite request failed') });

    await expect(addition).resolves.toMatchObject({ name: 'AbortError' });
    expect(errors).toEqual([
      {
        serviceId: 'bright',
        phase: 'style',
        fatal: true,
        message: 'sprite request failed',
      },
    ]);
    expect(manager.getServiceState('bright')).toMatchObject({ status: 'error' });
    expect(manager.getServiceState('light')).not.toMatchObject({ status: 'error' });
  });

  it.each([
    ['HTTP', async () => new Response('', { status: 503 }), 'HTTP 503'],
    ['CORS', async () => Promise.reject(new TypeError('Failed to fetch')), 'Failed to fetch'],
    ['JSON', async () => new Response('{', { status: 200 }), 'Expected property'],
    [
      'style validation',
      async () => new Response(JSON.stringify({ version: 7, sources: {}, layers: [] })),
      'version',
    ],
  ])('publishes one fatal style error for %s overlay fetch failures', async (_kind, fetchResult, message) => {
    const { manager } = createManager(
      [
        {
          id: 'bright',
          name: 'Bright',
          role: 'overlay',
          style: 'https://example.test/bright.json',
        },
      ],
      { fetchStyle: vi.fn(fetchResult) },
    );
    const errors: Array<{ serviceId?: string; phase: string; fatal: boolean; message: string }> =
      [];
    manager.on('error', (event) =>
      errors.push({
        serviceId: event.serviceId,
        phase: event.phase,
        fatal: event.fatal,
        message: event.error.message,
      }),
    );

    await expect(manager.setOverlayVisibility('bright', true)).rejects.toThrow(message);
    expect(errors).toEqual([
      expect.objectContaining({
        serviceId: 'bright',
        phase: 'style',
        fatal: true,
        message: expect.stringContaining(message),
      }),
    ]);
    expect(manager.getServiceState('bright')).toMatchObject({ status: 'error' });
  });

  it('destroy aborts style overlay fetches without stale events', async () => {
    const fetchStarted = deferred<void>();
    let signal: AbortSignal | undefined;
    const fetchStyle = vi.fn(async (_url: string, options?: RequestInit) => {
      signal = options?.signal ?? undefined;
      fetchStarted.resolve();
      return new Promise<Response>(() => undefined);
    });
    const { manager } = createManager(
      [
        {
          id: 'bright',
          name: 'Bright',
          role: 'overlay',
          style: 'https://example.test/bright.json',
        },
      ],
      { fetchStyle },
    );
    const events: string[] = [];
    manager.on('change', (event) => events.push(`${event.serviceId}:${event.reason}`));
    const activation = manager
      .setOverlayVisibility('bright', true)
      .catch((error: unknown) => error);

    await fetchStarted.promise;
    manager.destroy();

    expect(signal?.aborted).toBe(true);
    await expect(activation).resolves.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual(['bright:visibility', 'bright:status']);
  });
  it('aborts an obsolete style-overlay update fetch and only readies the replacement', async () => {
    const oldFetch = deferred<Response>();
    let oldSignal: AbortSignal | undefined;
    const fetchStyle = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/old.json')) {
        oldSignal = options?.signal ?? undefined;
        options?.signal?.addEventListener('abort', () =>
          oldFetch.reject(new DOMException('aborted', 'AbortError')),
        );
        return oldFetch.promise;
      }
      return Promise.resolve(new Response(JSON.stringify(brightStyle)));
    });
    const original = {
      id: 'bright',
      name: 'Original',
      role: 'overlay',
      visible: true,
      style: 'https://example.test/original.json',
    } as const;
    const { manager } = createManager([objectBasemap, original], { fetchStyle });
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;

    const first = manager.updateService('bright', {
      ...original,
      style: 'https://example.test/old.json',
    });
    await waitForCondition(() => oldSignal !== undefined, 'old style fetch did not start');
    const replacement = manager.updateService('bright', {
      ...original,
      name: 'Replacement',
      style: 'https://example.test/new.json',
    });
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'replacement composite style did not start',
    );

    expect(oldSignal?.aborted).toBe(true);
    map.emit('style.load');
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await replacement;
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServices().find((service) => service.id === 'bright')).toMatchObject({
      name: 'Replacement',
      style: 'https://example.test/new.json',
    });
  });

  it('removes a style overlay during fetch without publishing a stale error or status', async () => {
    const started = deferred<void>();
    const fetchStyle = vi.fn(async (_url: string, options?: RequestInit) => {
      started.resolve();
      await new Promise<void>((_resolve, reject) =>
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
      return new Response(JSON.stringify(brightStyle));
    });
    const { manager } = createManager(
      [
        {
          id: 'bright',
          name: 'Bright',
          role: 'overlay',
          style: 'https://example.test/bright.json',
        },
      ],
      { fetchStyle },
    );
    const events: string[] = [];
    manager.on('change', (event) =>
      events.push(`${event.serviceId}:${event.reason}:${event.state?.status}`),
    );
    manager.on('error', (event) => events.push(`error:${event.serviceId}:${event.phase}`));
    const activation = manager.setOverlayVisibility('bright', true);
    await started.promise;

    await manager.removeService('bright');
    await expect(activation).rejects.toMatchObject({ name: 'AbortError' });
    expect(manager.getServiceState('bright')).toBeUndefined();
    expect(events).toEqual([
      'bright:visibility:idle',
      'bright:status:loading',
      'bright:remove:undefined',
    ]);
  });

  it('settles two concurrent initialize calls with one style preparation per definition revision', async () => {
    const fetched = deferred<Response>();
    const fetchStyle = vi.fn(() => fetched.promise);
    const { manager } = createManager(
      [
        {
          id: 'bright',
          name: 'Bright',
          role: 'overlay',
          visible: true,
          style: 'https://example.test/bright.json',
        },
      ],
      { fetchStyle },
    );
    const first = manager.initialize();
    const second = manager.initialize();
    await waitForCondition(
      () => fetchStyle.mock.calls.length === 1,
      'style preparation was duplicated',
    );
    fetched.resolve(new Response(JSON.stringify(brightStyle)));
    const map = await waitForFakeMap();
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'initial composite style did not start',
    );
    map.emit('style.load');
    await Promise.all([first, second]);
    expect(fetchStyle).toHaveBeenCalledTimes(1);
    expect(manager.getServiceState('bright')).toMatchObject({ active: true, status: 'ready' });
  });

  it.each([
    'first-first',
    'second-first',
  ] as const)('readies concurrent style overlays when deferred fetches resolve %s', async (order) => {
    const firstFetch = deferred<Response>();
    const secondFetch = deferred<Response>();
    const fetchStyle = vi.fn((url: string) =>
      url.endsWith('/one.json') ? firstFetch.promise : secondFetch.promise,
    );
    const { manager } = createManager([objectBasemap], { fetchStyle });
    const baseRequest = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await baseRequest;
    const errors: Error[] = [];
    manager.on('error', (event) => errors.push(event.error));
    const one = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: 'https://example.test/one.json',
    });
    const two = manager.addService({
      id: 'two',
      name: 'Two',
      role: 'overlay',
      visible: true,
      style: 'https://example.test/two.json',
    });

    if (order === 'first-first') {
      firstFetch.resolve(new Response(JSON.stringify(brightStyle)));
      secondFetch.resolve(new Response(JSON.stringify(brightStyle)));
    } else {
      secondFetch.resolve(new Response(JSON.stringify(brightStyle)));
      firstFetch.resolve(new Response(JSON.stringify(brightStyle)));
    }
    await waitForCondition(() => map.setStyleCalls.length === 1, 'composite style did not start');
    map.emit('style.load');
    await Promise.all([one, two]);
    expect(manager.getServiceState('one')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('two')).toMatchObject({ active: true, status: 'ready' });
    expect(errors.filter((error) => error.name === 'AbortError')).toEqual([]);
  });

  it('does not emit an unrelated lifecycle error while rolling back a failed composite style', async () => {
    const conflictingBasemap = {
      ...objectBasemap,
      id: 'dark',
      name: 'Dark',
      style: { ...objectBasemap.style, glyphs: 'https://other-fonts.test/{fontstack}/{range}.pbf' },
    } as const;
    const { manager } = createManager([objectBasemap, conflictingBasemap]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;
    const overlay = manager.addService({
      id: 'bright',
      name: 'Bright',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'overlay style did not start');
    map.emit('style.load');
    await overlay;
    const errors: Array<{ serviceId?: string; phase: string }> = [];
    manager.on('error', (event) => errors.push({ serviceId: event.serviceId, phase: event.phase }));

    await expect(manager.setBasemap('dark')).rejects.toThrow('glyphs URL conflicts');
    await waitForCondition(() => map.setStyleCalls.length === 2, 'rollback style did not start');
    map.emit('style.load');
    expect(errors.filter((error) => error.phase === 'lifecycle')).toEqual([]);
  });
  it('supersedes a delayed composite style load when a newer basemap is selected', async () => {
    const { manager } = createManager([
      objectBasemap,
      {
        ...objectBasemap,
        id: 'dark',
        name: 'Dark',
        style: { ...objectBasemap.style, name: 'dark' },
      },
      { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style: brightStyle },
    ]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;

    const obsolete = manager.setBasemap('dark').catch((error: unknown) => error);
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'obsolete basemap style did not start',
    );
    const delayedOldLoad = map.delayedStyleLoad();
    const latest = manager.setBasemap('light');
    await Promise.resolve();
    delayedOldLoad();
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'latest basemap style did not start',
    );
    map.emit('style.load');

    await expect(obsolete).resolves.toMatchObject({ name: 'AbortError' });
    await latest;
    expect(manager.getServiceState('light')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('dark')).toMatchObject({ active: false, status: 'idle' });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true });
  });
  it('ignores an untagged stale style-load callback after the current generation starts', async () => {
    const { manager } = createManager([
      objectBasemap,
      {
        ...objectBasemap,
        id: 'dark',
        name: 'Dark',
        style: { ...objectBasemap.style, name: 'dark' },
      },
      { id: 'bright', name: 'Bright', role: 'overlay', visible: true, style: brightStyle },
    ]);
    const initial = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await initial;

    const obsolete = manager.setBasemap('dark').catch((error: unknown) => error);
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'obsolete basemap style did not start',
    );
    const staleLoad = map.captureStyleLoadListener();
    const latest = manager.setBasemap('light');
    await Promise.resolve();
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'current basemap style did not start',
    );
    staleLoad();
    expect(manager.getServiceState('light')).toMatchObject({ status: 'loading' });
    expect(map.listenerCount('style.load')).toBe(1);
    map.emit('style.load');
    await expect(obsolete).resolves.toMatchObject({ name: 'AbortError' });
    await latest;
    expect(manager.getServiceState('light')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('bright')).toMatchObject({ active: true });
  });
  it('replaces a prepared composite snapshot when a second overlay activates before physical application', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const loadMapLibre = vi.fn(() => moduleLoad.promise);
    const manager = createMapLibreServiceManager(createHost(), {}, loadMapLibre);
    const first = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => {
      const request = Reflect.get(manager, '_desiredRequest') as {
        preparedOverlays: Array<{ record: { definition: { id: string } } }>;
      } | null;
      return (
        request?.preparedOverlays.length === 1 &&
        request.preparedOverlays[0]?.record.definition.id === 'one' &&
        Reflect.get(manager, '_appliedRequest') === null
      );
    }, 'first composite snapshot was not captured before MapLibre loading');
    const firstRequest = Reflect.get(manager, '_desiredRequest');
    const second = manager.addService({
      id: 'two',
      name: 'Two',
      role: 'overlay',
      visible: true,
      style: {
        ...brightStyle,
        sources: { second: { type: 'vector' as const, url: 'https://example.test/second.json' } },
        layers: [{ id: 'second', type: 'fill' as const, source: 'second' }],
      },
    });
    await waitForCondition(() => {
      const registry = Reflect.get(manager, '_registry') as Map<
        string,
        { preparedStyle?: unknown }
      >;
      return registry.get('two')?.preparedStyle !== undefined;
    }, 'second overlay did not reach composite coordination');
    await waitForCondition(
      () => Reflect.get(manager, '_desiredRequest') !== firstRequest,
      'second overlay did not replace the stale composite snapshot',
    );

    moduleLoad.resolve(fakeModule());
    const map = await waitForFakeMap();
    await waitForCondition(
      () => map.listenerCount('style.load') === 1,
      'initial composite listener did not attach',
    );
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'replacement composite did not start',
    );
    map.emit('style.load');
    await Promise.all([first, second]);

    for (const id of [
      'emap-overlay:one:land',
      'emap-overlay:one:places',
      'emap-overlay:two:second',
    ]) {
      expect(map.getSource(id)).toBeDefined();
      expect(map.getLayer(id)).toBeDefined();
    }
    const records = Reflect.get(manager, '_registry') as Map<
      string,
      {
        ownedSources: Map<string, { handle: unknown }>;
        ownedLayers: Map<string, { handle: unknown }>;
      }
    >;
    for (const [serviceId, sourceId, layerId] of [
      ['one', 'emap-overlay:one:land', 'emap-overlay:one:land'],
      ['two', 'emap-overlay:two:second', 'emap-overlay:two:second'],
    ] as const) {
      const record = records.get(serviceId);
      expect(record?.ownedSources.get(sourceId)?.handle).toBe(map.getSource(sourceId));
      expect(record?.ownedLayers.get(layerId)?.handle).toBe(map.getLayer(layerId));
    }
    expect(manager.getServiceState('one')).toMatchObject({ active: true, status: 'ready' });
    expect(manager.getServiceState('two')).toMatchObject({ active: true, status: 'ready' });
  });
  it('replaces a prepared snapshot when its style overlay is updated before physical application', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const manager = createMapLibreServiceManager(createHost(), {}, () => moduleLoad.promise);
    const initial = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => {
      const request = Reflect.get(manager, '_desiredRequest') as {
        preparedOverlays: Array<{ record: { definition: { id: string } } }>;
      } | null;
      return request?.preparedOverlays[0]?.record.definition.id === 'one';
    }, 'initial composite snapshot was not captured');
    const staleRequest = Reflect.get(manager, '_desiredRequest');
    const replacementStyle = {
      ...brightStyle,
      sources: {
        replacement: { type: 'vector' as const, url: 'https://example.test/replacement.json' },
      },
      layers: [{ id: 'replacement', type: 'fill' as const, source: 'replacement' }],
    };
    const update = manager.updateService('one', {
      id: 'one',
      name: 'Updated one',
      role: 'overlay',
      visible: true,
      style: replacementStyle,
    });
    await waitForCondition(
      () => Reflect.get(manager, '_desiredRequest') !== staleRequest,
      'update did not replace the stale composite snapshot',
    );

    moduleLoad.resolve(fakeModule());
    const map = await waitForFakeMap();
    await waitForCondition(
      () => map.listenerCount('style.load') === 1,
      'initial listener did not attach',
    );
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 1,
      'replacement composite did not start',
    );
    map.emit('style.load');
    await Promise.all([initial, update]);

    expect(map.getSource('emap-overlay:one:replacement')).toBeDefined();
    expect(map.getLayer('emap-overlay:one:replacement')).toBeDefined();
    expect(map.getSource('emap-overlay:one:land')).toBeUndefined();
    expect(map.getLayer('emap-overlay:one:land')).toBeUndefined();
    expect(manager.getServiceState('one')).toMatchObject({ active: true, status: 'ready' });
  });

  it('replaces a prepared snapshot when its style overlay is removed before physical application', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const manager = createMapLibreServiceManager(createHost(), {}, () => moduleLoad.promise);
    const initial = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => {
      const request = Reflect.get(manager, '_desiredRequest') as {
        preparedOverlays: Array<{ record: { definition: { id: string } } }>;
      } | null;
      return request?.preparedOverlays[0]?.record.definition.id === 'one';
    }, 'initial composite snapshot was not captured');
    const staleRequest = Reflect.get(manager, '_desiredRequest');
    const removal = manager.removeService('one');
    await waitForCondition(
      () => Reflect.get(manager, '_desiredRequest') !== staleRequest,
      'removal did not replace the stale composite snapshot',
    );

    await Promise.all([initial, removal]);

    expect(FakeMap.instances).toEqual([]);
    expect(manager.getServiceState('one')).toBeUndefined();
  });

  it('reopens composite preparation when a second style overlay joins after the first snapshot', async () => {
    const firstStyle = brightStyle;
    const secondStyle = {
      ...brightStyle,
      sources: { second: { type: 'vector' as const, url: 'https://example.test/second.json' } },
      layers: [{ id: 'second', type: 'fill' as const, source: 'second' }],
    } as const;
    const { manager } = createManager([objectBasemap]);
    const baseRequest = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await baseRequest;
    const first = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: firstStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'first composite did not start');
    const second = manager.addService({
      id: 'two',
      name: 'Two',
      role: 'overlay',
      visible: true,
      style: secondStyle,
    });
    map.emit('style.load');
    await waitForCondition(
      () => map.setStyleCalls.length === 2,
      'reopened composite did not start',
    );
    map.emit('style.load');
    await Promise.all([first, second]);
    expect(map.getSource('emap-overlay:one:land')).toBeDefined();
    expect(map.getLayer('emap-overlay:one:land')).toBeDefined();
    expect(map.getSource('emap-overlay:two:second')).toBeDefined();
    expect(map.getLayer('emap-overlay:two:second')).toBeDefined();
  });

  it('ignores an untagged stale style-load callback after a newer composite request', async () => {
    const { manager } = createManager([objectBasemap]);
    const baseRequest = manager.setBasemap('light');
    const map = await waitForFakeMap();
    map.emit('style.load');
    await baseRequest;
    const first = manager.addService({
      id: 'one',
      name: 'One',
      role: 'overlay',
      visible: true,
      style: brightStyle,
    });
    await waitForCondition(() => map.setStyleCalls.length === 1, 'first composite did not start');
    const staleLoad = map.captureStyleLoadListener();
    const second = manager.addService({
      id: 'two',
      name: 'Two',
      role: 'overlay',
      visible: true,
      style: {
        ...brightStyle,
        sources: { second: { type: 'vector', url: 'https://example.test/second.json' } },
        layers: [{ id: 'second', type: 'fill', source: 'second' }],
      },
    });
    map.emit('style.load');
    await waitForCondition(() => map.setStyleCalls.length === 2, 'second composite did not start');
    staleLoad();
    expect(manager.getServiceState('two')).toMatchObject({ status: 'loading' });
    map.emit('style.load');
    await Promise.all([first, second]);
    expect(manager.getServiceState('two')).toMatchObject({ status: 'ready' });
  });

  it('attributes a 30-second style preparation timeout to the current overlay', async () => {
    vi.useFakeTimers();
    try {
      const { manager } = createManager(
        [
          {
            id: 'bright',
            name: 'Bright',
            role: 'overlay',
            style: 'https://example.test/bright.json',
          },
        ],
        { fetchStyle: vi.fn(() => new Promise<Response>(() => undefined)) },
      );
      const errors: Array<{ serviceId?: string; phase: string; fatal: boolean }> = [];
      manager.on('error', (event) =>
        errors.push({ serviceId: event.serviceId, phase: event.phase, fatal: event.fatal }),
      );
      const activation = manager
        .setOverlayVisibility('bright', true)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(activation).resolves.toMatchObject({
        message: expect.stringContaining('timed out'),
      });
      expect(errors).toEqual([{ serviceId: 'bright', phase: 'style', fatal: true }]);
      expect(manager.getServiceState('bright')).toMatchObject({ status: 'error' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('aborts a deferred second style preparation when initial runtime failure resets the manager', async () => {
    const fetched = deferred<Response>();
    let signal: AbortSignal | undefined;
    const fetchStyle = vi.fn((_url: string, options?: RequestInit) => {
      signal = options?.signal ?? undefined;
      options?.signal?.addEventListener('abort', () =>
        fetched.reject(new DOMException('aborted', 'AbortError')),
      );
      return fetched.promise;
    });
    const { manager } = createManager([{ ...roads, visible: true }], { fetchStyle });
    const events: string[] = [];
    manager.on('change', (event) =>
      events.push(`${event.serviceId}:${event.reason}:${event.state?.status}`),
    );
    manager.on('error', (event) => events.push(`error:${event.serviceId}:${event.phase}`));
    const initialization = manager.initialize().catch((error: unknown) => error);
    const map = await waitForFakeMap();
    const activation = manager
      .addService({
        id: 'bright',
        name: 'Bright',
        role: 'overlay',
        visible: true,
        style: 'https://example.test/bright.json',
      })
      .catch((error: unknown) => error);
    await waitForCondition(() => signal !== undefined, 'second style preparation did not start');

    map.emit('error', { error: new Error('initial style failed') });
    expect(signal?.aborted).toBe(true);
    fetched.resolve(new Response(JSON.stringify(brightStyle)));
    await expect(initialization).resolves.toBeInstanceOf(Error);
    await expect(activation).resolves.toMatchObject({ name: 'AbortError' });
    expect(manager.getMapLibreMap()).toBeNull();
    expect(FakeMap.instances).toHaveLength(1);
    expect(events.filter((event) => event.startsWith('error:bright'))).toEqual([]);
    expect(events.filter((event) => event === 'bright:status:ready')).toEqual([]);
  });
});
