// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Emap } from '../map/map';
import type {
  MapLibreBasemapService,
  MapLibreService,
  MapLibreServiceEventMap,
  MapLibreServiceManager,
  MapLibreServiceState,
} from '../map/maplibre-service';
import { BasemapControl, type BasemapOptions } from './basemap-control';

type ManagerEvent<K extends keyof MapLibreServiceEventMap> = {
  type: K;
} & MapLibreServiceEventMap[K];
type ManagerListener<K extends keyof MapLibreServiceEventMap> = (event: ManagerEvent<K>) => void;

const legacyDefaults: readonly MapLibreBasemapService[] = [
  {
    id: 'emap-legacy-basemap-0',
    name: 'OSM',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        'basemap-tiles': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 512,
        },
      },
      layers: [
        {
          id: 'basemap-layer',
          type: 'raster',
          source: 'basemap-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
  },
  {
    id: 'emap-legacy-basemap-1',
    name: 'CartoDB Light',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        'basemap-tiles': {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
          tileSize: 512,
        },
      },
      layers: [
        {
          id: 'basemap-layer',
          type: 'raster',
          source: 'basemap-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
  },
  {
    id: 'emap-legacy-basemap-2',
    name: 'CartoDB Dark',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        'basemap-tiles': {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
          tileSize: 512,
        },
      },
      layers: [
        {
          id: 'basemap-layer',
          type: 'raster',
          source: 'basemap-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
  },
];

function initialState(service: MapLibreService): MapLibreServiceState {
  return {
    id: service.id,
    active: service.role === 'overlay' && service.visible === true,
    status: 'idle',
  };
}

class FakeManager implements MapLibreServiceManager {
  private services: MapLibreService[];
  private states = new Map<string, MapLibreServiceState>();
  private listeners: {
    [K in keyof MapLibreServiceEventMap]: Set<ManagerListener<K>>;
  } = {
    change: new Set(),
    error: new Set(),
  };

  readonly addService = vi.fn(async (service: MapLibreService): Promise<void> => {
    if (this.services.some((candidate) => candidate.id === service.id)) {
      throw new Error(`duplicate service: ${service.id}`);
    }
    this.services.push(service);
    const state = initialState(service);
    this.states.set(service.id, state);
    this.emit('change', { serviceId: service.id, role: service.role, reason: 'add', state });
  });

  readonly updateService = vi.fn(async (id: string, service: MapLibreService): Promise<void> => {
    const index = this.services.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new Error(`missing service: ${id}`);
    this.services[index] = service;
    this.emit('change', {
      serviceId: id,
      role: service.role,
      reason: 'update',
      state: this.states.get(id),
    });
  });

  readonly removeService = vi.fn(async (id: string): Promise<void> => {
    const service = this.services.find((candidate) => candidate.id === id);
    if (!service) return;
    this.services = this.services.filter((candidate) => candidate.id !== id);
    this.states.delete(id);
    this.emit('change', { serviceId: id, role: service.role, reason: 'remove' });
  });

  readonly setBasemap = vi.fn(async (id: string | null): Promise<void> => {
    for (const service of this.services) {
      if (service.role !== 'basemap') continue;
      const state = this.states.get(service.id) ?? initialState(service);
      this.states.set(service.id, { ...state, active: service.id === id });
    }
    this.emit('change', {
      serviceId: id ?? '',
      role: 'basemap',
      reason: 'basemap',
      state: id === null ? undefined : this.states.get(id),
    });
  });

  readonly setOverlayVisibility = vi.fn(async (id: string, visible: boolean): Promise<void> => {
    const state = this.states.get(id);
    if (state) this.states.set(id, { ...state, active: visible });
  });

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

  setState(id: string, state: Omit<MapLibreServiceState, 'id'>): void {
    this.states.set(id, { id, ...state });
  }

  setServices(services: readonly MapLibreService[]): void {
    this.services = [...services];
    for (const service of services) {
      if (!this.states.has(service.id)) this.states.set(service.id, initialState(service));
    }
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

function basemap(id: string, name: string): MapLibreBasemapService {
  return { id, name, role: 'basemap', style: `https://example.test/${id}.json` };
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

function mount(
  manager: FakeManager,
  options?: BasemapOptions,
): { control: BasemapControl; root: HTMLElement } {
  const control = new BasemapControl(options);
  const root = control.onAdd({ mapLibreServices: manager } as unknown as Emap);
  document.body.append(root);
  return { control, root };
}

function radios(root: HTMLElement): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
}

function trigger(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('.emap-panel-trigger');
  if (!button) throw new Error('Missing basemap panel trigger');
  return button;
}

function panel(root: HTMLElement): HTMLElement {
  const element = root.querySelector<HTMLElement>('.emap-control-panel');
  if (!element) throw new Error('Missing basemap panel');
  return element;
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('BasemapControl legacy registration', () => {
  it('registers the three built-in legacy basemaps once in an empty registry', () => {
    const manager = new FakeManager();

    mount(manager);

    expect(manager.addService).toHaveBeenCalledTimes(3);
    expect(manager.addService.mock.calls.map(([service]) => service)).toEqual(legacyDefaults);
  });

  it('assigns deterministic ids and preserves raster-template versus style-URL adaptation', () => {
    const manager = new FakeManager();

    mount(manager, {
      styles: [
        { name: 'Typed raster', url: 'https://tiles.test/raster.png', type: 'raster' },
        { name: 'Template raster', url: 'https://tiles.test/{z}/{x}/{y}.png' },
        { name: 'Vector style', url: 'https://styles.test/vector.json', type: 'vector' },
      ],
    });

    const registered = manager.addService.mock.calls.map(([service]) => service);
    expect(registered.map((service) => service.id)).toEqual([
      'emap-legacy-basemap-0',
      'emap-legacy-basemap-1',
      'emap-legacy-basemap-2',
    ]);
    expect(registered[0]).toEqual({
      id: 'emap-legacy-basemap-0',
      name: 'Typed raster',
      role: 'basemap',
      style: {
        version: 8,
        sources: {
          'basemap-tiles': {
            type: 'raster',
            tiles: ['https://tiles.test/raster.png'],
            tileSize: 512,
          },
        },
        layers: [
          {
            id: 'basemap-layer',
            type: 'raster',
            source: 'basemap-tiles',
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
    });
    expect((registered[1] as MapLibreBasemapService).style).toEqual({
      version: 8,
      sources: {
        'basemap-tiles': {
          type: 'raster',
          tiles: ['https://tiles.test/{z}/{x}/{y}.png'],
          tileSize: 512,
        },
      },
      layers: [
        {
          id: 'basemap-layer',
          type: 'raster',
          source: 'basemap-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    });
    expect((registered[2] as MapLibreBasemapService).style).toBe('https://styles.test/vector.json');
  });

  it('selects the first legacy style matching defaultStyle after registration', async () => {
    const manager = new FakeManager();

    mount(manager, {
      styles: [
        { name: 'Duplicate', url: 'https://styles.test/first.json' },
        { name: 'Duplicate', url: 'https://styles.test/second.json' },
      ],
      defaultStyle: 'Duplicate',
    });
    await settlePromises();

    expect(manager.addService).toHaveBeenCalledTimes(2);
    expect(manager.setBasemap).toHaveBeenCalledTimes(1);
    expect(manager.setBasemap).toHaveBeenCalledWith('emap-legacy-basemap-0');
    expect(manager.addService.mock.invocationCallOrder.at(-1)).toBeLessThan(
      manager.setBasemap.mock.invocationCallOrder[0],
    );
  });

  it('uses built-in styles for defaultStyle alone and rejects explicit legacy/map registry conflicts', async () => {
    const emptyManager = new FakeManager();
    mount(emptyManager, { defaultStyle: 'CartoDB Dark' });
    await settlePromises();

    expect(emptyManager.addService.mock.calls.map(([service]) => service)).toEqual(legacyDefaults);
    expect(emptyManager.setBasemap).toHaveBeenCalledWith('emap-legacy-basemap-2');

    const configured = new FakeManager([basemap('configured', 'Configured')]);
    expect(() => mount(configured, { styles: [] })).toThrow(/legacy.*registry|registry.*legacy/i);
    expect(() => mount(configured, { defaultStyle: 'Configured' })).toThrow(
      /legacy.*registry|registry.*legacy/i,
    );
    expect(configured.addService).not.toHaveBeenCalled();
  });

  it('acts as a pure view over a non-empty registry when no legacy options are supplied', () => {
    const manager = new FakeManager([basemap('configured', 'Configured')]);

    const { root } = mount(manager);

    expect(manager.addService).not.toHaveBeenCalled();
    expect(radios(root).map((radio) => radio.value)).toEqual(['', 'configured']);
  });
});

describe('BasemapControl manager-driven UI', () => {
  it('renders one leading no-basemap radio and basemaps only in registry order', () => {
    const manager = new FakeManager([
      overlay('roads', 'Road overlay'),
      basemap('light', 'Light'),
      overlay('labels', 'Label overlay'),
      basemap('dark', 'Dark'),
    ]);

    const { root } = mount(manager);

    expect(radios(root).map((radio) => radio.value)).toEqual(['', 'light', 'dark']);
    expect([...root.querySelectorAll('label')].map((label) => label.textContent)).toEqual([
      'No basemap',
      'Light',
      'Dark',
    ]);
    expect(root.textContent).not.toContain('Road overlay');
    expect(root.textContent).not.toContain('Label overlay');
  });

  it('changes basemap selection exactly once for a service or no basemap', () => {
    const manager = new FakeManager([basemap('light', 'Light')]);
    const { root } = mount(manager);
    const [none, light] = radios(root);

    light.checked = true;
    light.dispatchEvent(new Event('change', { bubbles: true }));
    expect(manager.setBasemap).toHaveBeenCalledTimes(1);
    expect(manager.setBasemap).toHaveBeenLastCalledWith('light');

    const currentNone = radios(root)[0];
    currentNone.checked = true;
    currentNone.dispatchEvent(new Event('change', { bubbles: true }));
    expect(manager.setBasemap).toHaveBeenCalledTimes(2);
    expect(manager.setBasemap).toHaveBeenLastCalledWith(null);
    expect(none).not.toBe(currentNone);
  });

  it('derives isOn from active basemap manager state and ignores active overlays', () => {
    const manager = new FakeManager([basemap('light', 'Light'), overlay('roads', 'Roads')]);
    manager.setState('roads', { active: true, status: 'ready' });
    const { control } = mount(manager);

    expect(control.isOn()).toBe(false);
    manager.setState('light', { active: true, status: 'ready' });
    expect(control.isOn()).toBe(true);
    manager.setState('light', { active: false, status: 'ready' });
    expect(control.isOn()).toBe(false);
  });

  it('rereads services and state on manager events without repeating manager mutations', () => {
    const manager = new FakeManager([basemap('light', 'Light'), basemap('dark', 'Dark')]);
    const { root } = mount(manager);
    manager.setBasemap.mockClear();
    manager.addService.mockClear();

    manager.setState('dark', { active: true, status: 'loading' });
    manager.emit('change', {
      serviceId: 'dark',
      role: 'basemap',
      reason: 'status',
      state: manager.getServiceState('dark'),
    });

    expect(radios(root).find((radio) => radio.value === 'dark')?.checked).toBe(true);
    expect(panel(root).getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('[role="status"]')?.textContent).toMatch(/loading.*dark/i);
    expect(manager.setBasemap).not.toHaveBeenCalled();
    expect(manager.addService).not.toHaveBeenCalled();

    const terrain = basemap('terrain', 'Terrain');
    manager.setServices([basemap('light', 'Light'), basemap('dark', 'Dark'), terrain]);
    manager.emit('change', {
      serviceId: 'terrain',
      role: 'basemap',
      reason: 'add',
      state: manager.getServiceState('terrain'),
    });
    expect(radios(root).map((radio) => radio.value)).toEqual(['', 'light', 'dark', 'terrain']);
    expect(manager.addService).not.toHaveBeenCalled();

    const error = new Error('tile request failed');
    manager.setState('dark', { active: false, status: 'error', error });
    manager.emit('error', {
      serviceId: 'dark',
      phase: 'tile',
      error,
      fatal: false,
    });

    expect(panel(root).getAttribute('aria-busy')).toBe('false');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('tile request failed');
    expect(radios(root).every((radio) => !radio.disabled)).toBe(true);
    expect(manager.setBasemap).not.toHaveBeenCalled();
  });

  it.each([
    { phase: 'tile' as const, serviceId: 'light', message: 'tile request failed' },
    { phase: 'lifecycle' as const, serviceId: undefined, message: 'runtime warning' },
  ])('shows a transient $phase error whose service state remains ready', ({
    phase,
    serviceId,
    message,
  }) => {
    const manager = new FakeManager([basemap('light', 'Light')]);
    manager.setState('light', { active: true, status: 'ready' });
    const { root } = mount(manager);

    manager.emit('error', {
      serviceId,
      phase,
      error: new Error(message),
      fatal: false,
    });

    expect(manager.getServiceState('light')).toEqual({
      id: 'light',
      active: true,
      status: 'ready',
    });
    expect(root.querySelector('[role="status"]')?.textContent).toContain(message);
    expect(panel(root).getAttribute('aria-busy')).toBe('false');
    expect(radios(root).find((radio) => radio.value === 'light')?.checked).toBe(true);
    expect(manager.addService).not.toHaveBeenCalled();
    expect(manager.updateService).not.toHaveBeenCalled();
    expect(manager.removeService).not.toHaveBeenCalled();
    expect(manager.setBasemap).not.toHaveBeenCalled();
    expect(manager.setOverlayVisibility).not.toHaveBeenCalled();

    manager.emit('change', {
      serviceId: 'light',
      role: 'basemap',
      reason: 'status',
      state: manager.getServiceState('light'),
    });
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Light selected');
  });

  it('reports non-abort promise failures but ignores superseded AbortErrors', async () => {
    const manager = new FakeManager([basemap('light', 'Light')]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { root } = mount(manager);
    manager.setBasemap.mockRejectedValueOnce(new DOMException('superseded', 'AbortError'));

    radios(root)[1].checked = true;
    radios(root)[1].dispatchEvent(new Event('change', { bubbles: true }));
    await settlePromises();
    expect(errorSpy).not.toHaveBeenCalled();

    const failure = new Error('selection failed');
    manager.setBasemap.mockRejectedValueOnce(failure);
    radios(root)[1].checked = true;
    radios(root)[1].dispatchEvent(new Event('change', { bubbles: true }));
    await settlePromises();
    expect(errorSpy).toHaveBeenCalledWith(failure);
  });

  it('exposes linked panel ARIA and unique radio-group names per instance', () => {
    const first = mount(new FakeManager([basemap('light', 'Light')])).root;
    const second = mount(new FakeManager([basemap('dark', 'Dark')])).root;
    const firstTrigger = trigger(first);
    const firstPanel = panel(first);

    expect(first.className).toBe('emap-ctrl emap-panel-control emap-basemap-ctrl');
    expect(firstTrigger.tagName).toBe('BUTTON');
    expect(firstTrigger.getAttribute('aria-haspopup')).toBe('true');
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(firstTrigger.getAttribute('aria-controls')).toBe(firstPanel.id);
    expect(firstPanel.hidden).toBe(true);
    expect(firstPanel.getAttribute('aria-busy')).toBe('false');
    expect(firstPanel.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
      'Basemap',
    );
    const status = firstPanel.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
    expect(new Set(radios(first).map((radio) => radio.name)).size).toBe(1);
    expect(radios(first)[0].name).not.toBe(radios(second)[0].name);
    expect(new Set([...radios(first), ...radios(second)].map((radio) => radio.id)).size).toBe(4);
  });

  it('supports focus-on-open, radio keyboard navigation, Escape, and outside close', () => {
    const manager = new FakeManager([basemap('light', 'Light'), basemap('dark', 'Dark')]);
    manager.setState('light', { active: true, status: 'ready' });
    const { root } = mount(manager);
    const openButton = trigger(root);

    openButton.click();
    expect(panel(root).hidden).toBe(false);
    expect(openButton.getAttribute('aria-expanded')).toBe('true');
    expect((document.activeElement as HTMLInputElement).value).toBe('light');

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(manager.setBasemap).toHaveBeenLastCalledWith('dark');
    expect((document.activeElement as HTMLInputElement).value).toBe('dark');

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    );
    expect(manager.setBasemap).toHaveBeenLastCalledWith(null);
    expect((document.activeElement as HTMLInputElement).value).toBe('');

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(manager.setBasemap).toHaveBeenLastCalledWith('dark');
    expect((document.activeElement as HTMLInputElement).value).toBe('dark');

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(panel(root).hidden).toBe(true);
    expect(openButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(openButton);

    openButton.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(panel(root).hidden).toBe(true);
    expect(openButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('onRemove detaches listeners and DOM without mutating or destroying manager services', () => {
    const manager = new FakeManager([basemap('light', 'Light')]);
    const { control, root } = mount(manager);
    const openButton = trigger(root);
    openButton.click();

    expect(manager.listenerCount('change')).toBe(1);
    expect(manager.listenerCount('error')).toBe(1);
    control.onRemove();

    expect(root.isConnected).toBe(false);
    expect(manager.listenerCount('change')).toBe(0);
    expect(manager.listenerCount('error')).toBe(0);
    expect(manager.removeService).not.toHaveBeenCalled();
    expect(manager.setBasemap).not.toHaveBeenCalled();
    expect(manager.setOverlayVisibility).not.toHaveBeenCalled();
    expect(manager.hide).not.toHaveBeenCalled();
    expect(manager.destroy).not.toHaveBeenCalled();

    manager.emit('change', {
      serviceId: 'light',
      role: 'basemap',
      reason: 'status',
      state: manager.getServiceState('light'),
    });
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(openButton.getAttribute('aria-expanded')).toBe('true');
  });
});
