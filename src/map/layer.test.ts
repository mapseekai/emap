import { describe, expect, it } from 'vitest';
import { cloneLayerSpecification, resolveStrokeStyle, resolvePointStyle } from './layer';
import type { LinePaint, FillPaint, CirclePaint, LineLayerSpecification } from './layer';

describe('resolveStrokeStyle', () => {
  it('returns defaults when paint is undefined', () => {
    const style = resolveStrokeStyle(undefined, 1);
    expect(style).toEqual({ color: '#1e88e5', width: 0.8 });
  });

  it('uses line-color and line-width from LinePaint', () => {
    const paint: LinePaint = { 'line-color': '#f00', 'line-width': 3 };
    const style = resolveStrokeStyle(paint, 2);
    expect(style).toEqual({ color: '#f00', width: 6 });
  });

  it('uses fill-color from FillPaint', () => {
    const paint: FillPaint = { 'fill-color': '#0f0' };
    const style = resolveStrokeStyle(paint, 1);
    expect(style).toEqual({ color: '#0f0', width: 0.8 });
  });

  it('scales width by lineScale', () => {
    const paint: LinePaint = { 'line-width': 2 };
    const style = resolveStrokeStyle(paint, 0.5);
    expect(style.width).toBe(1);
  });

  it('scales line-dasharray by lineScale', () => {
    const paint: LinePaint = { 'line-dasharray': [8, 4] };
    const style = resolveStrokeStyle(paint, 0.5);
    expect(style.dash).toEqual([4, 2]);
  });
});

describe('cloneLayerSpecification', () => {
  it('clones line-dasharray values', () => {
    const layer: LineLayerSpecification = {
      id: 'roads',
      type: 'line',
      source: 'main',
      paint: { 'line-dasharray': [8, 4] },
    };

    const clone = cloneLayerSpecification(layer);

    expect(clone.paint?.['line-dasharray']).toEqual([8, 4]);
    expect(clone.paint?.['line-dasharray']).not.toBe(layer.paint?.['line-dasharray']);
  });
});

describe('resolvePointStyle', () => {
  it('returns defaults when paint is undefined', () => {
    const style = resolvePointStyle(undefined);
    expect(style).toEqual({ color: '#1e88e5', radius: 4, fill: true, shape: 'circle' });
  });

  it('uses circle paint properties', () => {
    const paint: CirclePaint = {
      'circle-color': '#00f',
      'circle-radius': 8,
      'circle-fill': false,
      'circle-shape': 'star',
    };
    const style = resolvePointStyle(paint);
    expect(style).toEqual({ color: '#00f', radius: 8, fill: false, shape: 'star' });
  });

  it('defaults fill to true when circle-fill is not set', () => {
    const paint: CirclePaint = { 'circle-color': '#abc' };
    const style = resolvePointStyle(paint);
    expect(style.fill).toBe(true);
  });
});
