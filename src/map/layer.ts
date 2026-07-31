import type { StrokeStyle, PointStyle } from '../types/mapshaper-types';

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

export interface FillLayerPaint extends FillPaint, LinePaint {}

export type LayerPaint = FillLayerPaint | LinePaint | CirclePaint;

export interface LayerLayout {
  visibility?: 'visible' | 'none';
}

interface LayerSpecificationBase {
  id: string;
  source: string;
  'source-layer'?: string;
  layout?: LayerLayout;
}

export interface FillLayerSpecification extends LayerSpecificationBase {
  type: 'fill';
  paint?: FillLayerPaint;
}

export interface LineLayerSpecification extends LayerSpecificationBase {
  type: 'line';
  paint?: LinePaint;
}

export interface CircleLayerSpecification extends LayerSpecificationBase {
  type: 'circle';
  paint?: CirclePaint;
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
export type LayerSpecification =
  | FillLayerSpecification
  | LineLayerSpecification
  | CircleLayerSpecification;

export type LayerType = LayerSpecification['type'];

export function cloneLayerSpecification(layer: LayerSpecification): LayerSpecification {
  switch (layer.type) {
    case 'fill':
      return {
        ...layer,
        paint: layer.paint ? { ...layer.paint } : undefined,
        layout: layer.layout ? { ...layer.layout } : undefined,
      };
    case 'line':
      return {
        ...layer,
        paint: layer.paint ? { ...layer.paint } : undefined,
        layout: layer.layout ? { ...layer.layout } : undefined,
      };
    case 'circle':
      return {
        ...layer,
        paint: layer.paint ? { ...layer.paint } : undefined,
        layout: layer.layout ? { ...layer.layout } : undefined,
      };
  }
}

export const DEFAULT_LAYER_COLOR = '#1e88e5';

export function resolveStrokeStyle(
  paint: LinePaint | FillLayerPaint | undefined,
  lineScale: number,
): StrokeStyle {
  const p = paint || {};
  const fillColor =
    'fill-color' in p && typeof p['fill-color'] === 'string' ? p['fill-color'] : undefined;
  return {
    color: p['line-color'] || fillColor || DEFAULT_LAYER_COLOR,
    width: (p['line-width'] ?? 0.8) * lineScale,
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
