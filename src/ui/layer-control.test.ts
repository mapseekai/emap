// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as emap from '../index';
import type { Emap } from '../map/map';
import type { LayerSpecification } from '../map/layer';
import type {
  MapLibreBasemapService,
  MapLibreService,
  MapLibreServiceEventMap,
  MapLibreServiceManager,
  MapLibreServiceState,
} from '../map/maplibre-service';

type LayerControlInstance = {
  onAdd(map: Emap): HTMLElement;
  onRemove(): void;
};
type LayerControlConstructor = new () => LayerControlInstance;
type LayerListener = (event: { type: 'layerchange' }) => void;
type ManagerEvent<K extends keyof MapLibreServiceEventMap> = {
  type: K;
} & MapLibreServiceEventMap[K];
type ManagerListener<K extends keyof MapLibreServiceEventMap> = (event: ManagerEvent<K>) => void;

const LayerControl = (emap as unknown as { LayerControl: LayerControlConstructor }).LayerControl;

class FakeMap {
  private renderedLayers: LayerSpecification[];
  private readonly layerListeners = new Set<LayerListener>();

  readonly mapLibreServices: FakeManager;
  readonly getLayers = vi.fn((): readonly LayerSpecification[] => []);
  readonly getRenderedLayers = vi.fn((): readonly LayerSpecification[] =>
    this.renderedLayers.map((layer) => ({ ...layer })),
  );
  readonly setLayerVisibility = vi.fn(
    (_id: string, _visibility: 'visible' | 'none'): void => undefined,
  );

  constructor(layers: readonly LayerSpecification[], manager: FakeManager) {
    this.renderedLayers = [...layers];
    this.mapLibreServices = manager;
  }

  on(type: 'layerchange', listener: LayerListener): this {
    expect(type).toBe('layerchange');
    this.layerListeners.add(listener);
    return this;
  }

  off(type: 'layerchange', listener: LayerListener): this {
    expect(type).toBe('layerchange');
    this.layerListeners.delete(listener);
    return this;
  }

  setRenderedLayers(layers: readonly LayerSpecification[]): void {
    this.renderedLayers = [...layers];
  }

  emitLayerChange(): void {
    for (const listener of [...this.layerListeners]) listener({ type: 'layerchange' });
  }

  listenerCount(): number {
    return this.layerListeners.size;
  }
}

function initialState(service: MapLibreService): MapLibreServiceState {
  return {
    id: service.id,
    active: service.role === 'overlay' && service.visible === true,
    status: 'idle',
  };
}

class FakeManager implements MapLibreServiceManager {
  private services: MapLibreService[];
  private readonly states = new Map<string, MapLibreServiceState>();
  private readonly listeners: {
    [K in keyof MapLibreServiceEventMap]: Set<ManagerListener<K>>;
  } = {
    change: new Set(),
    error: new Set(),
  };

  readonly addService = vi.fn(async (): Promise<void> => undefined);
  readonly updateService = vi.fn(async (): Promise<void> => undefined);
  readonly removeService = vi.fn(async (): Promise<void> => undefined);
  readonly setBasemap = vi.fn(async (): Promise<void> => undefined);
  readonly setOverlayVisibility = vi.fn(
    async (_id: string, _visible: boolean): Promise<void> => undefined,
  );
  readonly destroy = vi.fn();
  readonly hide = vi.fn();

  constructor(services: readonly MapLibreService[] = []) {
    this.services = [...services];
    for (const service of services) this.states.set(service.id, initialState(service));
  }

  getServices(): readonly MapLibreService[] {
    return [...this.services];
  }

  getServiceState(id: string): MapLibreServiceState | undefined {
    const state = this.states.get(id);
    return state ? { ...state } : undefined;
  }

  getMapLibreMap(): null {
    return null;
  }

  on<K extends keyof MapLibreServiceEventMap>(type: K, listener: ManagerListener<K>): this {
    this.listeners[type].add(listener);
    return this;
  }

  off<K extends keyof MapLibreServiceEventMap>(type: K, listener: ManagerListener<K>): this {
    this.listeners[type].delete(listener);
    return this;
  }

  once<K extends keyof MapLibreServiceEventMap>(type: K, listener: ManagerListener<K>): this {
    const onceListener = ((event: ManagerEvent<K>) => {
      this.off(type, onceListener);
      listener(event);
    }) as ManagerListener<K>;
    return this.on(type, onceListener);
  }

  setServices(services: readonly MapLibreService[]): void {
    this.services = [...services];
    for (const service of services) {
      if (!this.states.has(service.id)) this.states.set(service.id, initialState(service));
    }
  }

  setState(id: string, state: Omit<MapLibreServiceState, 'id'>): void {
    this.states.set(id, { id, ...state });
  }

  emit<K extends keyof MapLibreServiceEventMap>(type: K, event: MapLibreServiceEventMap[K]): void {
    for (const listener of [...this.listeners[type]]) {
      listener({ type, ...event } as ManagerEvent<K>);
    }
  }

  listenerCount(type: keyof MapLibreServiceEventMap): number {
    return this.listeners[type].size;
  }
}

function layer(id: string, visibility: 'visible' | 'none' = 'visible'): LayerSpecification {
  return { id, type: 'line', source: 'business', layout: { visibility } };
}

function overlay(id: string, name: string): MapLibreService {
  return {
    id,
    name,
    role: 'overlay',
    sources: {
      [id]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [{ id, type: 'line', source: id }],
  };
}

function basemap(id: string, name: string): MapLibreBasemapService {
  return { id, name, role: 'basemap', style: `https://example.test/${id}.json` };
}

function mount(
  layers: readonly LayerSpecification[],
  services: readonly MapLibreService[] = [],
): { control: LayerControlInstance; map: FakeMap; manager: FakeManager; root: HTMLElement } {
  const manager = new FakeManager(services);
  const map = new FakeMap(layers, manager);
  const control = new LayerControl();
  const root = control.onAdd(map as unknown as Emap);
  document.body.append(root);
  return { control, map, manager, root };
}

function checkboxes(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

function group(root: HTMLElement, modifier: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(modifier);
  if (!element) throw new Error(`Missing layer group: ${modifier}`);
  return element;
}

function trigger(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('.emap-panel-trigger');
  if (!button) throw new Error('Missing layer panel trigger');
  return button;
}

function panel(root: HTMLElement): HTMLElement {
  const element = root.querySelector<HTMLElement>('.emap-control-panel');
  if (!element) throw new Error('Missing layer panel');
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('LayerControl fixed layer groups', () => {
  it('renders generated business layers from getRenderedLayers when getLayers is empty', () => {
    const { map, root } = mount([layer('generated:default')]);

    expect(
      checkboxes(group(root, '.emap-layer-group--business')).map((input) => input.value),
    ).toEqual(['generated:default']);
    expect(map.getLayers).not.toHaveBeenCalled();
    expect(map.getRenderedLayers).toHaveBeenCalled();
  });

  it('renders business first and online second while preserving source orders and excluding basemaps', () => {
    const { root } = mount(
      [layer('parcels'), layer('roads'), layer('labels')],
      [
        overlay('weather', 'Weather'),
        basemap('dark', 'Dark basemap'),
        overlay('traffic', 'Traffic'),
      ],
    );

    const groups = [...root.querySelectorAll<HTMLElement>('.emap-layer-group')];
    expect(groups).toHaveLength(2);
    expect(groups[0].classList).toContain('emap-layer-group--business');
    expect(groups[1].classList).toContain('emap-layer-group--online');
    expect(checkboxes(groups[0]).map((input) => input.value)).toEqual([
      'parcels',
      'roads',
      'labels',
    ]);
    expect(checkboxes(groups[1]).map((input) => input.value)).toEqual(['weather', 'traffic']);
    expect(root.textContent).not.toContain('Dark basemap');
  });

  it('maps business checkbox changes to visible and none layer visibility values', () => {
    const { map, root } = mount([layer('roads'), layer('labels', 'none')]);
    const [roads, labels] = checkboxes(group(root, '.emap-layer-group--business'));

    roads.checked = false;
    roads.dispatchEvent(new Event('change', { bubbles: true }));
    labels.checked = true;
    labels.dispatchEvent(new Event('change', { bubbles: true }));

    expect(map.setLayerVisibility.mock.calls).toEqual([
      ['roads', 'none'],
      ['labels', 'visible'],
    ]);
  });

  it('maps online checkbox changes to boolean overlay visibility and absorbs AbortError', async () => {
    const { manager, root } = mount([], [overlay('weather', 'Weather')]);
    manager.setOverlayVisibility.mockRejectedValueOnce(
      new DOMException('Superseded', 'AbortError'),
    );
    const [weather] = checkboxes(group(root, '.emap-layer-group--online'));

    weather.checked = true;
    weather.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(manager.setOverlayVisibility).toHaveBeenCalledWith('weather', true);
  });

  it('rerenders API-driven layer and manager state without invoking either mutation API', () => {
    const { map, manager, root } = mount([layer('roads')], [overlay('traffic', 'Traffic')]);
    map.setLayerVisibility.mockClear();
    manager.setOverlayVisibility.mockClear();

    map.setRenderedLayers([layer('roads', 'none')]);
    map.emitLayerChange();
    manager.setState('traffic', { active: true, status: 'ready' });
    manager.emit('change', {
      serviceId: 'traffic',
      role: 'overlay',
      reason: 'visibility',
      state: manager.getServiceState('traffic'),
    });

    expect(checkboxes(group(root, '.emap-layer-group--business'))[0].checked).toBe(false);
    expect(checkboxes(group(root, '.emap-layer-group--online'))[0].checked).toBe(true);
    expect(map.setLayerVisibility).not.toHaveBeenCalled();
    expect(manager.setOverlayVisibility).not.toHaveBeenCalled();
    expect(map.getLayers).not.toHaveBeenCalled();
  });

  it('updates dynamic rows plus loading and error text in an aria-live status', () => {
    const roads = layer('roads');
    const weather = overlay('weather', 'Weather');
    const traffic = overlay('traffic', 'Traffic');
    const { map, manager, root } = mount([roads], [weather]);
    const status = root.querySelector<HTMLElement>('[role="status"]');

    map.setRenderedLayers([roads, layer('parcels')]);
    map.emitLayerChange();
    manager.setServices([weather, traffic]);
    manager.setState('traffic', { active: true, status: 'loading' });
    manager.emit('change', {
      serviceId: 'traffic',
      role: 'overlay',
      reason: 'status',
      state: manager.getServiceState('traffic'),
    });

    expect(checkboxes(root).map((input) => input.value)).toEqual([
      'roads',
      'parcels',
      'weather',
      'traffic',
    ]);
    expect(panel(root).getAttribute('aria-busy')).toBe('true');
    expect(status).toMatchObject({ ariaLive: 'polite' });
    expect(status?.textContent).toContain('Loading Traffic');

    manager.setServices([traffic]);
    manager.setState('traffic', {
      active: false,
      status: 'error',
      error: new Error('Tile request failed'),
    });
    manager.emit('error', {
      serviceId: 'traffic',
      phase: 'tile',
      error: new Error('Tile request failed'),
      fatal: false,
    });

    expect(
      checkboxes(group(root, '.emap-layer-group--online')).map((input) => input.value),
    ).toEqual(['traffic']);
    expect(panel(root).getAttribute('aria-busy')).toBe('false');
    expect(status?.textContent).toContain('Tile request failed');
  });
});

describe('LayerControl accessibility and lifecycle', () => {
  it('labels trigger, panel, groups, and checkboxes and manages focus, Escape, and outside close', () => {
    const { root } = mount([layer('roads')], [overlay('weather', 'Weather')]);
    const button = trigger(root);
    const layerPanel = panel(root);
    const business = group(root, '.emap-layer-group--business');
    const online = group(root, '.emap-layer-group--online');

    expect(button.textContent).toBe('Layers');
    expect(button.getAttribute('aria-controls')).toBe(layerPanel.id);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(layerPanel.getAttribute('aria-label')).toBe('Layers');
    expect(business.getAttribute('role')).toBe('group');
    expect(business.getAttribute('aria-label')).toBe('Business layers');
    expect(online.getAttribute('role')).toBe('group');
    expect(online.getAttribute('aria-label')).toBe('Online overlays');
    expect(checkboxes(root).map((input) => input.labels?.[0]?.textContent)).toEqual([
      'roads',
      'Weather',
    ]);

    button.click();
    expect(layerPanel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(checkboxes(root)[0]);

    layerPanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(layerPanel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);

    button.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(layerPanel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('onRemove detaches exact event sources and document listeners without changing state', () => {
    const addDocumentListener = vi.spyOn(document, 'addEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const { control, map, manager, root } = mount(
      [layer('roads')],
      [overlay('weather', 'Weather')],
    );
    const outsideListener = addDocumentListener.mock.calls.find(
      ([type]) => type === 'mousedown',
    )?.[1];
    const renderedBefore = map.getRenderedLayers();
    const servicesBefore = manager.getServices();
    map.setLayerVisibility.mockClear();
    manager.setOverlayVisibility.mockClear();

    expect(map.listenerCount()).toBe(1);
    expect(manager.listenerCount('change')).toBe(1);
    expect(manager.listenerCount('error')).toBe(1);

    control.onRemove();

    expect(map.listenerCount()).toBe(0);
    expect(manager.listenerCount('change')).toBe(0);
    expect(manager.listenerCount('error')).toBe(0);
    expect(removeDocumentListener).toHaveBeenCalledWith('mousedown', outsideListener);
    expect(root.isConnected).toBe(false);
    expect(map.getRenderedLayers()).toEqual(renderedBefore);
    expect(manager.getServices()).toEqual(servicesBefore);
    expect(map.setLayerVisibility).not.toHaveBeenCalled();
    expect(manager.setOverlayVisibility).not.toHaveBeenCalled();

    map.emitLayerChange();
    manager.emit('change', {
      serviceId: 'weather',
      role: 'overlay',
      reason: 'status',
      state: manager.getServiceState('weather'),
    });
  });
});
