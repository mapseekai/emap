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

describe('attached symbol style API', () => {
  function setup() {
    return new LayerServiceImpl({
      document: { _sources: new Map([['s', {}]]), layers: {} },
      events: new EventDispatcher(),
      signals: { requestRender: vi.fn() },
    } as any);
  }
  it('accepts symbol on addLayer and adjusts independent layout/paint properties without changing tree entries', () => {
    const service = setup();
    service.addLayer({
      id: 'p',
      source: 's',
      type: 'circle',
      paint: { 'circle-radius': 4 },
      symbol: {
        images: { marker: { url: '/pin.png', size: [24, 32] } },
        layout: {
          'icon-image': 'marker',
          'icon-size': 1,
          'text-field': ['get', 'name'],
          'text-size': 14,
          'text-offset': [0, 1.2],
        },
      },
    });
    service.setSymbolLayoutProperty('p', 'text-size', 20);
    service.setSymbolPaintProperty('p', 'icon-opacity', 0.5);
    expect(service.getLayer('p')!.label!.offset).toEqual([0, 24]);
    expect((service.getLayer('p') as any).icon.opacity).toBe(0.5);
    expect(service.getLayer('p')!.paint).toEqual({ 'circle-radius': 4 });
    expect(service.getLayers().map((l) => l.id)).toEqual(['p']);
    service.setLayerLabel('p', { field: 'title', fontSize: 18 });
    expect(service.getLayer('p')!.symbol!.layout!['text-field']).toEqual(['get', 'title']);
    expect((service.getLayer('p') as any).icon.opacity).toBe(0.5);
    service.setLayerIcon('p', { url: '/camera.png', size: 30 });
    expect(service.getLayer('p')!.label!.field).toBe('title');
    service.removeLayerSymbol('p');
    expect(service.getLayer('p')!.symbol).toBeUndefined();
    expect(service.getLayers()).toHaveLength(1);
  });
  it('keeps state unchanged on bad mappings, typo, wrong section and unresolved image names', () => {
    const service = setup();
    service.addLayer({
      id: 'p',
      source: 's',
      type: 'circle',
      symbol: { layout: { 'text-field': ['get', 'name'] } },
    });
    const before = service.getLayer('p');
    expect(() => service.setSymbolLayoutProperty('p', 'icon-image', 'missing')).toThrow('missing');
    expect(() => service.setSymbolPaintProperty('p', 'text-size' as any, 20)).toThrow('layout');
    expect(() => service.setLayerSymbol('p', { layout: { 'text-size': NaN } })).toThrow();
    expect(service.getLayer('p')).toEqual(before);
    expect(() =>
      service.addLayer({
        id: 'bad',
        source: 's',
        type: 'fill',
        symbol: { images: { i: { url: '/pin.png', size: 32 } }, layout: { 'icon-image': 'i' } },
      }),
    ).toThrow('point');
    expect(service.getLayers()).toHaveLength(1);
  });
  it('copies symbol definitions on writes and reads so no caller can mutate stored settings', () => {
    const service = setup();
    const symbol: any = {
      images: { i: { url: '/x.png', size: [20, 30] } },
      layout: { 'icon-image': 'i', 'text-field': ['match', ['get', 'kind'], 1, 'A', 'B'] },
    };
    service.addLayer({ id: 'p', source: 's', type: 'circle', symbol });
    symbol.images.i.size[0] = 400;
    symbol.layout['text-field'][1][1] = 'broken';
    const copy = service.getLayer('p')!;
    expect(copy.symbol!.images!.i.size).toEqual([20, 30]);
    const coordinates = copy.symbol!.images!.i.size;
    if (!Array.isArray(coordinates)) throw new Error('Expected cloned coordinate tuple');
    Reflect.set(coordinates, 0, 500);
    expect((service.getLayer('p') as any).icon.size).toEqual([20, 30]);
    expect((service.getLayer('p')!.symbol!.layout!['text-field'] as any[])[1][1]).toBe('kind');
  });
});

describe('symbol mapping keeps preexisting validation strict', () => {
  it('does not normalize invalid pointLod values into valid empty objects', () => {
    const service = new LayerServiceImpl({
      document: { _sources: new Map([['s', {}]]), layers: {} },
      events: new EventDispatcher(),
      signals: { requestRender: vi.fn() },
    } as any);
    for (const pointLod of [true, null, 3, [], { cellSize: 0 }])
      for (const symbol of [undefined, {}])
        expect(() =>
          service.addLayer({ id: 'bad', source: 's', type: 'circle', pointLod, symbol } as any),
        ).toThrow('pointLod');
    expect(() =>
      service.addLayer({ id: 'bad', source: 's', type: 'circle', symbol: null } as any),
    ).toThrow('symbol');
    expect(service.getLayers()).toHaveLength(0);
  });
});
