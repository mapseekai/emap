import { describe, expect, it } from 'vitest';
import { materializeSymbolLayer, replaceLayerSymbol, changeSymbolProperty } from './symbol-layer';
import { cloneLayerSpecification, type LayerSpecification } from './layer';
const parent: LayerSpecification = {
  id: 'poi',
  source: 's',
  type: 'circle',
  paint: { 'circle-radius': 4 },
  label: { field: 'old' },
  icon: { url: '/old.png', size: 32 },
};
describe('symbol settings boundaries', () => {
  it('materializes once, gives symbol precedence, and keeps native readback and source identity', () => {
    const next = materializeSymbolLayer({
      ...parent,
      symbol: { layout: { 'text-field': ['get', 'name'], 'text-size': 14 } },
    });
    expect(next.label!.field).toBe('name');
    expect(next.type === 'circle' && next.icon).toBeUndefined();
    expect(next.id).toBe(parent.id);
    expect(next.source).toBe(parent.source);
    expect(next.paint).toEqual(parent.paint);
    const copy = cloneLayerSpecification(next);
    (copy.symbol!.layout!['text-field'] as any[])[1] = 'changed';
    expect(next.label!.field).toBe('name');
  });
  it('migrates legacy settings on first property edit, preserves the opposite channel and resets defaults', () => {
    const next = changeSymbolProperty(parent, 'layout', 'text-offset', [0, 1.2]);
    expect(next.symbol!.layout!['text-field']).toEqual(['get', 'old']);
    expect(next.label!.offset).toEqual([0, 16.8]);
    expect(next.type === 'circle' && next.icon!.url).toBe('/old.png');
    const reset = changeSymbolProperty(next, 'layout', 'text-offset', null);
    expect(reset.label!.offset).toBeUndefined();
    expect(parent.symbol).toBeUndefined();
    expect(parent.label!.field).toBe('old');
  });
  it('removes only symbols without altering paint, parent visibility or creating replacement layer IDs', () => {
    const layer = replaceLayerSymbol(parent, null);
    expect(layer.symbol).toBeUndefined();
    expect(layer.label).toBeUndefined();
    expect(layer.type === 'circle' && layer.icon).toBeUndefined();
    expect(layer.paint).toEqual(parent.paint);
  });
});
