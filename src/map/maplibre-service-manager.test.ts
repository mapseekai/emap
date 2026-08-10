// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type * as maplibregl from 'maplibre-gl';
import type { MapLibreOverlayService, MapLibreService } from './maplibre-service';
import { createMapLibreServiceManager } from './maplibre-service-manager';

type FakeMapListener = (event?: unknown) => void;

class FakeMap {
  static instances: FakeMap[] = [];
  static rebuildOnSetStyle = true;

  readonly options: maplibregl.MapOptions;
  readonly sources = new Map<string, unknown>();
  readonly layers = new Map<string, unknown>();
  readonly layerOrder: string[] = [];
  readonly resourceSnapshots: Array<{ sources: string[]; layers: string[] }> = [];
  readonly operations: string[] = [];
  readonly jumpToCalls: Array<{ center: [number, number]; zoom: number }> = [];
  readonly ignoredRemovals = new Set<string>();
  resizeCalls = 0;
  removed = false;
  private readonly _listeners = new Map<string, Set<FakeMapListener>>();

  constructor(options: maplibregl.MapOptions) {
    this.options = options;
    FakeMap.instances.push(this);
  }

  on(type: string, listener: FakeMapListener): this {
    const listeners = this._listeners.get(type) ?? new Set<FakeMapListener>();
    listeners.add(listener);
    this._listeners.set(type, listeners);
    return this;
  }

  off(type: string, listener: FakeMapListener): this {
    this._listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this._listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(type: string): number {
    return this._listeners.get(type)?.size ?? 0;
  }

  setStyle(style: string | maplibregl.StyleSpecification | null): void {
    void style;
    this.resourceSnapshots.push({
      sources: [...this.sources.keys()],
      layers: [...this.layerOrder],
    });
    this.operations.push('setStyle');
    if (FakeMap.rebuildOnSetStyle) {
      this.sources.clear();
      this.layers.clear();
      this.layerOrder.length = 0;
    }
  }

  addSource(id: string, source: maplibregl.SourceSpecification): void {
    this.operations.push(`addSource:${id}`);
    this.sources.set(id, { id, specification: source });
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  removeSource(id: string): void {
    this.operations.push(`removeSource:${id}`);
    if (this.ignoredRemovals.has(id)) return;
    this.sources.delete(id);
  }

  addLayer(layer: maplibregl.LayerSpecification, beforeId?: string): void {
    this.operations.push(`addLayer:${layer.id}:${beforeId ?? ''}`);
    this.layers.set(layer.id, { id: layer.id, specification: layer });
    const beforeIndex = beforeId === undefined ? -1 : this.layerOrder.indexOf(beforeId);
    if (beforeIndex === -1) this.layerOrder.push(layer.id);
    else this.layerOrder.splice(beforeIndex, 0, layer.id);
  }

  getLayer(id: string): unknown {
    return this.layers.get(id);
  }

  removeLayer(id: string): void {
    this.operations.push(`removeLayer:${id}`);
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
  }
}

const base = {
  id: 'light',
  name: 'Light',
  role: 'basemap',
  style: 'https://example.test/light.json',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
  options: { crs?: string; mapOptions?: maplibregl.MapOptions } = {},
) {
  FakeMap.instances.length = 0;
  const host = createHost(options.crs);
  const loadMapLibre = vi.fn(
    async () => ({ Map: FakeMap }) as unknown as typeof import('maplibre-gl'),
  );
  const manager = createMapLibreServiceManager(
    host,
    { services, mapOptions: options.mapOptions },
    loadMapLibre,
  );
  return { host, loadMapLibre, manager };
}

async function waitForFakeMap(): Promise<FakeMap> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const map = FakeMap.instances[0];
    if (map) return map;
    await Promise.resolve();
  }
  throw new Error('FakeMap was not constructed');
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
    const { loadMapLibre } = createManager();

    expect(loadMapLibre).not.toHaveBeenCalled();
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

    await manager.setBasemap('light');
    await manager.setBasemap('dark');
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

    await manager.setOverlayVisibility('roads', true);
    expect(host.reproject).toHaveBeenCalledTimes(0);
    host.setCRS('epsg:3857');
    host.emit('crschange');
    expect(container.hidden).toBe(false);
    expect(map.resizeCalls).toBe(2);
    expect(map.jumpToCalls.at(-1)).toEqual({ center: [121, 31], zoom: 6 });
  });

  it('allows deactivation while suspended and only reprojects on a new activation', async () => {
    const { host, manager } = createManager([roads]);
    const map = await activateOverlay(manager);
    host.setCRS('epsg:4326');
    host.emit('crschange');

    await manager.setOverlayVisibility('roads', false);
    expect(host.reproject).not.toHaveBeenCalled();
    expect((map.options.container as HTMLElement).hidden).toBe(true);

    const reactivation = manager.setOverlayVisibility('roads', true);
    await reactivation;
    expect(host.reproject).toHaveBeenCalledWith('webmercator');
    expect((map.options.container as HTMLElement).hidden).toBe(false);
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

  it('aborts a show superseded by hide during import and leaves no resources', async () => {
    FakeMap.instances.length = 0;
    const moduleLoad = deferred<typeof import('maplibre-gl')>();
    const loadMapLibre = vi.fn(() => moduleLoad.promise);
    const host = createHost();
    const manager = createMapLibreServiceManager(host, { services: [roads] }, loadMapLibre);

    const showResult = manager.setOverlayVisibility('roads', true).catch((error: unknown) => error);
    await Promise.resolve();
    await manager.setOverlayVisibility('roads', false);
    moduleLoad.resolve(fakeModule());
    const map = await waitForFakeMap();

    await expect(showResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
    expect((map.options.container as HTMLElement).hidden).toBe(true);
    expect(manager.getServiceState('roads')).toMatchObject({ active: false });
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
    const addMap = await waitForFakeMap();
    await expect(addResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(addMap.layers.size).toBe(0);
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

  it('rejects teardown when MapLibre fails a removal postcondition', async () => {
    const { manager } = createManager([traffic]);
    const map = await activateOverlay(manager, 'traffic');
    map.ignoredRemovals.add('traffic-line');

    await expect(manager.setOverlayVisibility('traffic', false)).rejects.toThrow('traffic-line');
    expect(map.sources.has('traffic')).toBe(true);
    expect(map.layers.has('traffic-line')).toBe(true);
    expect(manager.getServiceState('traffic')).toMatchObject({ active: false, status: 'error' });
  });
});
