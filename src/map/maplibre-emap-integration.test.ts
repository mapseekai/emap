// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Control } from '../ui/control';
import { Emap } from './map';
import type { MapLibreServiceManager } from './maplibre-service';
import { MapLibreServiceManagerImpl } from './maplibre-service-manager';
import type { MapOptions } from './types';

const mapLibreModuleLoaded = vi.hoisted(() => vi.fn());

vi.mock('maplibre-gl', () => {
  mapLibreModuleLoaded();
  return { Map: class {} };
});

const canvasContext = {
  scale: () => {},
  clearRect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  arc: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  setTransform: () => {},
  drawImage: () => {},
  measureText: () => ({ width: 0 }),
} as unknown as CanvasRenderingContext2D;

const maps: Emap[] = [];

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  for (const map of maps.splice(0)) map.remove();
  vi.restoreAllMocks();
  mapLibreModuleLoaded.mockClear();
});

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  return container;
}

function createMap(options: Omit<MapOptions, 'container'> = {}): Emap {
  const map = new Emap({ container: createContainer(), ...options });
  maps.push(map);
  return map;
}

function getOwnedManager(map: Emap): MapLibreServiceManager | undefined {
  return (map as unknown as { _mapLibreServices?: MapLibreServiceManager })._mapLibreServices;
}

const inactiveOverlay = {
  id: 'roads',
  name: 'Roads',
  role: 'overlay',
  sources: {
    roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [{ id: 'roads', type: 'line', source: 'roads' }],
} as const;

const basemap = {
  id: 'base',
  name: 'Base',
  role: 'basemap',
  style: { version: 8, sources: {}, layers: [] },
} as const;

describe('Emap MapLibre service ownership', () => {
  it('does not create an unconfigured manager until the getter is read', () => {
    const map = createMap();

    expect(getOwnedManager(map)).toBeUndefined();
    const manager = map.mapLibreServices;

    expect(manager).toBeDefined();
    expect(getOwnedManager(map)).toBe(manager);
  });

  it('returns the same lazy manager on repeated getter reads', () => {
    const map = createMap();
    const manager = map.mapLibreServices;

    expect(manager).toBeDefined();
    expect(map.mapLibreServices).toBe(manager);
  });

  it('registers inactive configured services without importing MapLibre', async () => {
    const map = createMap({ mapLibre: { services: [inactiveOverlay] } });

    await Promise.resolve();
    await Promise.resolve();

    expect(map.mapLibreServices.getServices()).toEqual([inactiveOverlay]);
    expect(mapLibreModuleLoaded).not.toHaveBeenCalled();
  });

  it('rejects an invalid default basemap synchronously during construction', () => {
    expect(
      () =>
        new Emap({
          container: createContainer(),
          mapLibre: { services: [basemap], defaultBasemap: 'missing' },
        }),
    ).toThrow('MapLibre default basemap "missing" does not exist');
  });

  it('initializes configured visible overlays and the default basemap exactly once', () => {
    const initialize = vi
      .spyOn(MapLibreServiceManagerImpl.prototype, 'initialize')
      .mockResolvedValue();

    const map = createMap({
      mapLibre: {
        services: [basemap, { ...inactiveOverlay, visible: true }],
        defaultBasemap: 'base',
      },
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(map.mapLibreServices.getServices()).toHaveLength(2);
  });

  it('removes controls before destroying its manager exactly once', () => {
    const order: string[] = [];
    const destroyImplementation = MapLibreServiceManagerImpl.prototype.destroy;
    const destroy = vi
      .spyOn(MapLibreServiceManagerImpl.prototype, 'destroy')
      .mockImplementation(function (this: MapLibreServiceManagerImpl) {
        order.push('manager');
        destroyImplementation.call(this);
      });
    const map = createMap();
    void map.mapLibreServices;
    const control: Control = {
      onAdd: () => document.createElement('div'),
      onRemove: () => {
        order.push('control');
      },
    };
    map.addControl(control);

    map.remove();
    map.remove();

    expect(order).toEqual(['control', 'manager']);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(getOwnedManager(map)).toBeUndefined();
  });
});
