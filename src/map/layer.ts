import type { StrokeStyle, PointStyle } from '../types/mapshaper-types';

export type LayerType = 'fill' | 'line' | 'circle';

export interface FillPaint {
  'fill-color'?: string;
  'fill-opacity'?: number;
}

export interface LinePaint {
  'line-color'?: string;
  'line-width'?: number;
}

export interface CirclePaint {
  'circle-color'?: string;
  'circle-radius'?: number;
  'circle-fill'?: boolean;
}

export type LayerPaint = FillPaint | LinePaint | CirclePaint;

export interface LayerLayout {
  visibility?: 'visible' | 'none';
}

export interface LayerSpecification {
  id: string;
  type: LayerType;
  source: string;
  'source-layer'?: string;
  paint?: LayerPaint;
  layout?: LayerLayout;
}

export function resolveStrokeStyle(
  paint: LinePaint | FillPaint | undefined,
  lineScale: number,
): StrokeStyle {
  const p = paint || {};
  return {
    color:
      (p as LinePaint)['line-color'] ||
      (p as FillPaint)['fill-color'] ||
      '#333',
    width: ((p as LinePaint)['line-width'] ?? 0.8) * lineScale,
  };
}

export function resolvePointStyle(
  paint: CirclePaint | undefined,
): PointStyle {
  const p = paint || {};
  return {
    color: p['circle-color'] || '#333',
    radius: p['circle-radius'] ?? 4,
    fill: p['circle-fill'] !== false,
  };
}
