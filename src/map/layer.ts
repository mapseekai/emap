import type { StrokeStyle, PointStyle } from '../types/mapshaper-types';

export type LayerType = 'fill' | 'line' | 'circle';

/**
 * Paint options for polygon fills.
 *
 * @example
 * const paint: FillPaint = { 'fill-color': '#2f6f73', 'fill-opacity': 0.32 };
 */
export interface FillPaint {
  'fill-color'?: string;
  'fill-opacity'?: number;
}

/**
 * Paint options for line and polygon outline strokes.
 *
 * @example
 * const paint: LinePaint = { 'line-color': '#335c99', 'line-width': 2 };
 */
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

/**
 * Declarative layer configuration used by `Emap.addLayer`.
 *
 * @example
 * const layer: LayerSpecification = {
 *   id: 'points-circle',
 *   type: 'circle',
 *   source: 'example',
 *   paint: { 'circle-color': '#b3425f', 'circle-radius': 6 },
 * };
 */
export interface LayerSpecification {
  id: string;
  type: LayerType;
  source: string;
  'source-layer'?: string;
  paint?: LayerPaint;
  layout?: LayerLayout;
}

export const DEFAULT_LAYER_COLOR = '#1e88e5';

export function resolveStrokeStyle(
  paint: LinePaint | FillPaint | undefined,
  lineScale: number,
): StrokeStyle {
  const p = paint || {};
  return {
    color: (p as LinePaint)['line-color'] || (p as FillPaint)['fill-color'] || DEFAULT_LAYER_COLOR,
    width: ((p as LinePaint)['line-width'] ?? 0.8) * lineScale,
  };
}

export function resolvePointStyle(paint: CirclePaint | undefined): PointStyle {
  const p = paint || {};
  return {
    color: p['circle-color'] || DEFAULT_LAYER_COLOR,
    radius: p['circle-radius'] ?? 4,
    fill: p['circle-fill'] !== false,
  };
}
