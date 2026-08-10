// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { MapLibreOverlayService, MapLibreService } from './maplibre-service';
import { createMapLibreServiceManager } from './maplibre-service-manager';

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
  layers: [
    { id: 'roads-line', type: 'line', source: 'roads', 'source-layer': 'roads' },
  ],
} as const satisfies MapLibreOverlayService;

function createHost() {
  return {
    getCanvasContainer: vi.fn(() => document.createElement('div')),
    getCRS: vi.fn(() => 'webmercator'),
    reproject: vi.fn(async () => undefined),
    getCenter: vi.fn(() => [120, 30] as [number, number]),
    getZoom: vi.fn(() => 4),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createManager(services: readonly MapLibreService[] = []) {
  const host = createHost();
  const loadMapLibre = vi.fn(async () => ({} as typeof import('maplibre-gl')));
  const manager = createMapLibreServiceManager(host, { services }, loadMapLibre);
  return { host, loadMapLibre, manager };
}

describe('MapLibreServiceManager registry', () => {
  it('does not load MapLibre when construction has no visible service', () => {
    const { loadMapLibre } = createManager();

    expect(loadMapLibre).not.toHaveBeenCalled();
  });

  it('adds cloned inactive services and emits one add snapshot', async () => {
    const { manager } = createManager();
    const changes: Array<{ serviceId: string; reason: string; active: boolean }> = [];
    manager.on('change', (event) => changes.push({
      serviceId: event.serviceId,
      reason: event.reason,
      active: event.state?.active ?? true,
    }));

    await manager.addService(base);
    await manager.addService(roads);
    const services = manager.getServices();
    (services[1] as MapLibreOverlayService).sources.roads.url = 'changed';

    expect(changes).toEqual([
      { serviceId: 'light', reason: 'add', active: false },
      { serviceId: 'roads', reason: 'add', active: false },
    ]);
    expect(manager.getServiceState('roads')).toEqual({ id: 'roads', active: false, status: 'idle' });
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

    await expect(manager.removeService('missing')).rejects.toThrow('MapLibre service "missing" does not exist');
    await expect(manager.setBasemap('roads')).rejects.toThrow('MapLibre service "roads" is not a basemap');
    await expect(manager.setOverlayVisibility('light', true)).rejects.toThrow(
      'MapLibre service "light" is not an overlay',
    );
  });

  it('rejects invalid initial services and default basemaps synchronously', () => {
    const host = createHost();
    const loader = vi.fn(async () => ({} as typeof import('maplibre-gl')));

    expect(() => createMapLibreServiceManager(host, { services: [base, base] }, loader)).toThrow(
      'MapLibre service "light" already exists',
    );
    expect(() => createMapLibreServiceManager(host, { services: [{ ...base, id: '' }] }, loader)).toThrow(
      'MapLibre service id must be a non-empty string',
    );
    expect(() => createMapLibreServiceManager(host, { defaultBasemap: 'missing' }, loader)).toThrow(
      'MapLibre default basemap "missing" does not exist',
    );
    expect(() => createMapLibreServiceManager(host, { services: [roads], defaultBasemap: 'roads' }, loader)).toThrow(
      'MapLibre default basemap "roads" is not a basemap',
    );
  });

  it('normalizes throwing lifecycle listeners into non-fatal error events', async () => {
    const { manager } = createManager();
    const errors: Array<{ phase: string; fatal: boolean; message: string }> = [];
    manager.on('change', () => {
      throw new Error('listener failed');
    });
    manager.on('error', (event) => errors.push({
      phase: event.phase,
      fatal: event.fatal,
      message: event.error.message,
    }));

    await manager.addService(base);

    expect(errors).toEqual([{ phase: 'lifecycle', fatal: false, message: 'listener failed' }]);
  });

  it('preserves overlay active intent across visible-hint updates', async () => {
    const { manager } = createManager([roads]);

    await manager.updateService('roads', { ...roads, visible: true });
    expect(manager.getServiceState('roads')).toMatchObject({ active: false });
    await manager.setOverlayVisibility('roads', true);
    await manager.updateService('roads', { ...roads, name: 'Current overlay', visible: false });

    expect(manager.getServiceState('roads')).toMatchObject({ active: true, status: 'idle' });
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
