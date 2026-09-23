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
