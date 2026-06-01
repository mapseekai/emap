import type { CorePainter } from '../renderer/painter';
import { AffineTransform } from '../geo/transform';
import { TopologySource } from '../source/source';
import { getLayerId } from '../source/layer-utils';
import type { HighlightStyle, HighlightFeatureRef, QueriedFeature } from './map';
import type { FeatureShape } from '../types/mapshaper-types';

/**
 * Manages feature highlighting state and rendering.
 * Extracted from Emap to isolate highlight concerns.
 */
export class HighlightManager {
  private _highlighted: globalThis.Map<
    string,
    globalThis.Map<string, Set<number>>
  > = new globalThis.Map();

  private _highlightStyle: HighlightStyle = {
    color: '#ff7a00',
    width: 2.2,
    radius: 6,
    fill: true,
  };

  get size(): number {
    return this._highlighted.size;
  }

  setHighlightedFeatures(
    features: Array<QueriedFeature | HighlightFeatureRef>,
    style?: HighlightStyle,
  ): void {
    this._highlighted.clear();
    if (style) {
      this._highlightStyle = { ...this._highlightStyle, ...style };
    }
    for (const feature of features) {
      const sourceMap =
        this._highlighted.get(feature.source) || new globalThis.Map();
      const ids = sourceMap.get(feature.layer) || new Set<number>();
      ids.add(feature.id);
      sourceMap.set(feature.layer, ids);
      this._highlighted.set(feature.source, sourceMap);
    }
  }

  clearHighlightedFeatures(): boolean {
    if (this._highlighted.size === 0) return false;
    this._highlighted.clear();
    return true;
  }

  setHighlightStyle(style: HighlightStyle): boolean {
    this._highlightStyle = { ...this._highlightStyle, ...style };
    return this._highlighted.size > 0;
  }

  renderHighlights(
    painter: CorePainter,
    sources: globalThis.Map<string, TopologySource>,
    transform: AffineTransform,
    lineScale: number,
    visibleLayers?: Set<string>,
  ): void {
    if (this._highlighted.size === 0) return;
    const highlightColor = this._highlightStyle.color || '#ff7a00';
    const highlightWidth = (this._highlightStyle.width ?? 2.2) * lineScale;
    const highlightRadius = this._highlightStyle.radius ?? 6;
    const highlightFill = this._highlightStyle.fill !== false;
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    for (const [sourceId, source] of sources) {
      const sourceHighlights = this._highlighted.get(sourceId);
      if (!sourceHighlights) continue;
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();

      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex];
        if (!layer?.shapes) continue;
        const layerId = getLayerId(layer, layerIndex);
        if (visibleLayers && !visibleLayers.has(`${sourceId}:${layerId}`)) continue;
        const ids = sourceHighlights.get(layerId);
        if (!ids || ids.size === 0) continue;
        const shapes: FeatureShape[] = [];
        for (const id of ids) {
          const shape = layer.shapes[id];
          if (shape) shapes.push(shape);
        }
        if (shapes.length === 0) continue;
        if (layer.geometry_type === 'point') {
          painter.drawPoints(shapes, {
            color: highlightColor,
            radius: highlightRadius,
            fill: highlightFill,
          });
        } else if (arcs) {
          painter.drawPaths(
            shapes,
            { color: highlightColor, width: highlightWidth },
            arcs,
          );
        }
      }
    }
  }
}
