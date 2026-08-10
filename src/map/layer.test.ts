import { describe, expect, it } from 'vitest';
import { cloneLayerSpecification, resolveStrokeStyle, resolvePointStyle } from './layer';
import type { LinePaint, FillPaint, CirclePaint, LineLayerSpecification } from './layer';
import { EMAP_THEME_COLORS } from '../theme/colors';

describe('resolveStrokeStyle', () => {
  it('returns defaults when paint is undefined', () => {
    const style = resolveStrokeStyle(undefined, 1);
    expect(style).toMatchObject({
      color: EMAP_THEME_COLORS.primary,
      width: 0.8,
      dashType: 'solid',
    });
  });

  it('uses line-color and line-width from LinePaint', () => {
    const paint: LinePaint = { 'line-color': '#f00', 'line-width': 3 };
    const style = resolveStrokeStyle(paint, 2);
    expect(style).toMatchObject({ color: '#f00', width: 6, dashType: 'solid' });
  });

  it('uses fill-color from FillPaint', () => {
    const paint: FillPaint = { 'fill-color': '#0f0' };
    const style = resolveStrokeStyle(paint, 1);
    expect(style).toMatchObject({ color: '#0f0', width: 0.8, dashType: 'solid' });
  });

  it('scales width by lineScale', () => {
    const paint: LinePaint = { 'line-width': 2 };
    const style = resolveStrokeStyle(paint, 0.5);
    expect(style.width).toBe(1);
  });

  it('scales line-dasharray by lineScale', () => {
    const paint: LinePaint = { 'line-dasharray': [8, 4] };
    const style = resolveStrokeStyle(paint, 0.5);
    expect(style.dashType).toBe('dash');
    expect(style.dash).toEqual([4, 2]);
  });

  it('maps line-dashstyle dot to pattern', () => {
    const paint: LinePaint = { 'line-dashstyle': 'dot' };
    const style = resolveStrokeStyle(paint, 2);
    expect(style).toEqual({
      color: EMAP_THEME_COLORS.primary,
      width: 1.6,
      dashType: 'dot',
      dash: [3, 10],
    });
  });

  it('maps line-dashstyle dash-dot to the established point-dash pattern', () => {
    const paint: LinePaint = { 'line-dashstyle': 'dash-dot' };
    const style = resolveStrokeStyle(paint, 1);
    expect(style).toEqual({
      color: EMAP_THEME_COLORS.primary,
      width: 0.8,
      dashType: 'dash-dot',
      dash: [12, 4, 3, 4],
    });
  });

  it('lets an explicit named style override a custom dasharray', () => {
    const paint: LinePaint = { 'line-dashstyle': 'solid', 'line-dasharray': [8, 4] };
    const style = resolveStrokeStyle(paint, 1);
    expect(style.dashType).toBe('solid');
    expect(style.dash).toBeUndefined();
  });

  it('maps arrow-dot style with defaults', () => {
    const paint: LinePaint = { 'line-dashstyle': 'arrow-dot' };
    const style = resolveStrokeStyle(paint, 1);
    expect(style).toEqual({
      color: EMAP_THEME_COLORS.primary,
      width: 0.8,
      dashType: 'arrow-dot',
      arrowSpacing: 32,
      arrowSize: 6,
    });
  });
});

describe('cloneLayerSpecification', () => {
  it('clones line-dasharray values', () => {
    const layer: LineLayerSpecification = {
      id: 'roads',
      type: 'line',
      source: 'main',
      paint: { 'line-dasharray': [8, 4], 'line-dashstyle': 'dash', 'line-arrow-size': 8 },
    };

    const clone = cloneLayerSpecification(layer);

    expect(clone.paint?.['line-dasharray']).toEqual([8, 4]);
    expect(clone.paint?.['line-dasharray']).not.toBe(layer.paint?.['line-dasharray']);
    expect(clone.paint?.['line-dashstyle']).toBe('dash');
    expect(clone.paint?.['line-arrow-size']).toBe(8);
  });
});

describe('resolvePointStyle', () => {
  it('returns defaults when paint is undefined', () => {
    const style = resolvePointStyle(undefined);
    expect(style).toEqual({
      color: EMAP_THEME_COLORS.primary,
      radius: 4,
      fill: true,
      shape: 'circle',
    });
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
