import type {
  LineDashStyle,
  PointMarkerShape,
  PointStyle,
  StrokeStyle,
} from '../types/mapshaper-types';
import { EMAP_THEME_COLORS } from '../theme/colors';
import type { StyleExpression } from './style-expression';

/**
 * Paint options for polygon fills.
 *
 * @example
 * const paint: FillPaint = { 'fill-color': '#2f6f73', 'fill-opacity': 0.32 };
 */
export interface FillPaint {
  'fill-color'?: string | StyleExpression;
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
  /** Alternating dash and gap lengths in CSS pixels. */
  'line-dasharray'?: readonly number[];
  /** Named dash pattern. `arrow-dot` replaces repeated dots with directional arrows. */
  'line-dashstyle'?: LineDashStyle;
  /** Arrow-to-arrow spacing in CSS pixels for `arrow-dot`. Default `32`. */
  'line-arrow-spacing'?: number;
  /** Arrow wing length in CSS pixels for `arrow-dot`. Default `6`. */
  'line-arrow-size'?: number;
}

export interface CirclePaint {
  'circle-color'?: string;
  'circle-radius'?: number;
  'circle-fill'?: boolean;
  'circle-shape'?: PointMarkerShape;
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
  /** 显式 opt-in：读取 mapshaper 兼容烘焙样式字段（fill/stroke/stroke-width/r）。 */
  styleSource?: 'mapshaper';
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
    case 'line':
      return {
        ...layer,
        paint: layer.paint
          ? {
              ...layer.paint,
              ...(layer.paint['line-dasharray']
                ? { 'line-dasharray': [...layer.paint['line-dasharray']] }
                : {}),
            }
          : undefined,
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

export const DEFAULT_LAYER_COLOR = EMAP_THEME_COLORS.primary;

export function resolveStrokeStyle(
  paint: LinePaint | FillLayerPaint | undefined,
  lineScale: number,
): StrokeStyle {
  const p = paint || {};
  const fillColor =
    'fill-color' in p && typeof p['fill-color'] === 'string' ? p['fill-color'] : undefined;
  const dash = p['line-dasharray'];
  const dashStyle = p['line-dashstyle'];
  const parsedArrowSpacing =
    typeof p['line-arrow-spacing'] === 'number' ? Math.max(4, p['line-arrow-spacing']) : undefined;
  const parsedArrowSize =
    typeof p['line-arrow-size'] === 'number' ? Math.max(2, p['line-arrow-size']) : undefined;
  const arrowSpacing = parsedArrowSpacing ?? 32;
  const arrowSize = parsedArrowSize ?? 6;

  const dashType = dashStyle ?? (dash?.length ? 'dash' : 'solid');

  const getDash = (): readonly number[] | undefined => {
    if (!dashStyle) return dash?.map((length) => length * lineScale);
    if (dashType === 'dash') return [8 * lineScale, 6 * lineScale];
    if (dashType === 'dot') return [1.5 * lineScale, 5 * lineScale];
    if (dashType === 'dash-dot')
      return [12 * lineScale, 4 * lineScale, 3 * lineScale, 4 * lineScale];
    if (dashType === 'arrow-dot') return undefined;
    return undefined;
  };

  const resolvedDash = getDash();

  return {
    color: p['line-color'] || fillColor || DEFAULT_LAYER_COLOR,
    width: (p['line-width'] ?? 0.8) * lineScale,
    dashType,
    ...(dashType === 'arrow-dot'
      ? {
          arrowSpacing,
          arrowSize,
        }
      : {}),
    ...(resolvedDash ? { dash: resolvedDash } : {}),
  };
}

export function resolvePointStyle(paint: CirclePaint | undefined): PointStyle {
  const p = paint || {};
  return {
    color: p['circle-color'] || DEFAULT_LAYER_COLOR,
    radius: p['circle-radius'] ?? 4,
    fill: p['circle-fill'] !== false,
    shape: p['circle-shape'] ?? 'circle',
  };
}
