import { describe, it, expect, vi } from 'vitest';
import { LayerServiceImpl } from './layers';
import { EventDispatcher } from '../../core/events';

describe('labels are parent-layer configuration, not extra layers', () => {
  const setup = () =>
    new LayerServiceImpl({
      document: { _sources: new Map([['s', {}]]), layers: {} },
      events: new EventDispatcher(),
      signals: { requestRender: vi.fn() },
    } as any);
  it('sets, disables and clones labels without changing the layer list or type', () => {
    const service = setup();
    service.addLayer({ id: 'p', source: 's', type: 'fill' });
    const options = { field: 'name', offset: [1, 2] as [number, number] };
    service.setLayerLabel('p', options);
    options.offset[0] = 100;
    expect(service.getLayer('p')?.label?.offset).toEqual([1, 2]);
    expect(service.getLayers().map((l) => [l.id, l.type])).toEqual([['p', 'fill']]);
    service.setLayerVisibility('p', 'none');
    expect(service.getLayer('p')?.label?.field).toBe('name');
    service.setLayerLabel('p', null);
    expect(service.getLayer('p')?.label).toBeUndefined();
    expect(service.getLayers()).toHaveLength(1);
  });
  it('validates before replacing a valid configuration', () => {
    const service = setup();
    service.addLayer({ id: 'p', source: 's', type: 'circle', label: { field: 'name' } });
    expect(() => service.setLayerLabel('p', { field: 'name', fontSize: -1 })).toThrow();
    expect(service.getLayer('p')?.label).toEqual({ field: 'name' });
    expect(() => service.setLayerLabel('unknown', { field: 'name' })).toThrow('not found');
  });
});

describe('icons belong to existing point layers', () => {
  const setup = () =>
    new LayerServiceImpl({
      document: { _sources: new Map([['s', {}]]), layers: {} },
      events: new EventDispatcher(),
      signals: { requestRender: vi.fn() },
    } as any);
  it('supports image symbols and labels together without adding layer IDs', () => {
    const service = setup();
    service.addLayer({ id: 'p', source: 's', type: 'circle', label: { field: 'name' } });
    const icon = { url: '/pin.png', anchor: [0.5, 1] as [number, number] };
    service.setLayerIcon('p', icon);
    icon.anchor[0] = 0;
    const layer = service.getLayer('p');
    expect(layer?.type === 'circle' && layer.icon?.anchor).toEqual([0.5, 1]);
    expect(layer?.label).toEqual({ field: 'name' });
    expect(service.getLayers()).toHaveLength(1);
    service.setLayerIcon('p', null);
    expect(service.getLayer('p')).not.toHaveProperty('icon', expect.anything());
    expect(service.getLayers()).toHaveLength(1);
  });
  it('rejects nonpoint icons and failed changes without mutating layer configuration', () => {
    const service = setup();
    service.addLayer({ id: 'p', source: 's', type: 'circle', icon: { url: '/pin.png' } });
    service.addLayer({ id: 'f', source: 's', type: 'fill' });
    expect(() => service.setLayerIcon('p', { url: '/x', size: NaN })).toThrow();
    expect(() => service.setLayerIcon('f', { url: '/x' })).toThrow('point');
    expect(() =>
      service.addLayer({ id: 'bad', source: 's', type: 'fill', icon: { url: '/x' } } as any),
    ).toThrow();
    expect(service.getLayers()).toHaveLength(2);
    expect(service.getLayer('p')).toHaveProperty('icon.url', '/pin.png');
  });
});
