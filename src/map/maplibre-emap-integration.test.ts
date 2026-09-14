import { MapLibreService } from '../services/keys';
import {
  createTestMap,
  createBrowserTestMap,
  fixtureGet,
  fixtureSet,
  fixtureCall,
} from '../../test/utils/plugin-test-map';
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
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
  const map = createBrowserTestMap({ container: createContainer(), ...options });
  maps.push(map);
  return map;
}

function getOwnedManager(map: Emap): MapLibreServiceManager | undefined {
  return map.services.has(MapLibreService) ? map.getService(MapLibreService) : undefined;
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
  it('provides an unconfigured service without initializing the MapLibre runtime', () => {
    const map = createMap();

    expect(getOwnedManager(map)?.getMapLibreMap()).toBeNull();
    expect(mapLibreModuleLoaded).not.toHaveBeenCalled();
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

  it('finishes teardown before reporting a manager destroy failure through dispose', async () => {
    const order: string[] = [];
    const container = createContainer();
    const map = createBrowserTestMap({ container });
    maps.push(map);
    const manager = map.mapLibreServices as MapLibreServiceManagerImpl;
    const destroy = vi.spyOn(manager, 'destroy').mockImplementation(() => {
      order.push('manager');
      throw new Error('manager destroy failed');
    });
    const control: Control = {
      onAdd: () => document.createElement('div'),
      onRemove: () => {
        order.push('control');
      },
    };
    map.addControl(control);

    const failure = await map.dispose().catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    const leafErrors = (error: unknown): unknown[] =>
      error instanceof AggregateError ? error.errors.flatMap(leafErrors) : [error];
    expect(leafErrors(failure).map((error) => (error as Error).message)).toContain(
      'manager destroy failed',
    );

    expect(order).toEqual(['control', 'manager']);
    expect(getOwnedManager(map)).toBeUndefined();
    expect(container.childElementCount).toBe(0);
    expect(() => map.remove()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cleans partial DOM, handler, and worker ownership when configured validation throws', async () => {
    const container = createContainer();
    const workerPool = new MapshaperWorkerPool({ workerUrl: 'emap-worker.js' });
    let canvasContainer: HTMLElement | undefined;
    const appendChild = container.appendChild.bind(container);
    container.appendChild = (<T extends Node>(node: T): T => {
      if (node instanceof HTMLElement && node.classList.contains('emap-canvas-container')) {
        canvasContainer = node;
      }
      return appendChild(node);
    }) as typeof container.appendChild;

    expect(() =>
      createBrowserTestMap({
        container,
        useWorker: true,
        workerPool,
        mapLibre: { services: [basemap], defaultBasemap: 'missing' },
      }),
    ).toThrow('MapLibre default basemap "missing" does not exist');

    expect(container.querySelector('.emap-canvas-container')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(canvasContainer).toBeDefined();
    const detachedCanvasContainer = canvasContainer as HTMLElement;
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(detachedCanvasContainer.style.cursor).toBe('');
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 1 });
    detachedCanvasContainer.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    await expect(workerPool.run('-clip', { datasets: [] })).rejects.toThrow(
      'MapshaperWorkerPool: destroyed',
    );
  });
});
