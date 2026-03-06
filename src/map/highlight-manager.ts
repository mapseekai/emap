import { Painter } from '../renderer/painter';
import { Transform } from '../geo/transform';
import { TopologySource } from '../source/source';
import type { HighlightStyle, HighlightFeatureRef, RenderedFeatureAttributes } from './map';

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
    features: Array<RenderedFeatureAttributes | HighlightFeatureRef>,
    style?: HighlightStyle,
  ): void {
    this._highlighted.clear();
    if (style) {
      this._highlightStyle = { ...this._highlightStyle, ...style };
    }
    features.forEach((feature) => {
      const sourceMap =
        this._highlighted.get(feature.source) || new globalThis.Map();
      const ids = sourceMap.get(feature.layer) || new Set<number>();
      ids.add(feature.id);
      sourceMap.set(feature.layer, ids);
      this._highlighted.set(feature.source, sourceMap);
    });
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
    painter: Painter,
    sources: globalThis.Map<string, TopologySource>,
    transform: Transform,
    lineScale: number,
  ): void {
    if (this._highlighted.size === 0) return;
    const highlightColor = this._highlightStyle.color || '#ff7a00';
    const highlightWidth = (this._highlightStyle.width ?? 2.2) * lineScale;
    const highlightRadius = this._highlightStyle.radius ?? 6;
    const highlightFill = this._highlightStyle.fill !== false;
    const pixelSize = 1 / Math.abs(transform.mx || 1);

    sources.forEach((source: TopologySource, sourceId: string) => {
      const sourceHighlights = this._highlighted.get(sourceId);
      if (!sourceHighlights) return;
      const layers = source.getLayers();
      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();
      layers.forEach((layer: any, layerIndex: number) => {
        if (!layer?.shapes) return;
        const layerId = this._getLayerId(layer, layerIndex);
        const ids = sourceHighlights.get(layerId);
        if (!ids || ids.size === 0) return;
        const shapes: any[] = [];
        ids.forEach((id) => {
          const shape = layer.shapes[id];
          if (shape) shapes.push(shape);
        });
        if (shapes.length === 0) return;
        if (layer.geometry_type === 'point') {
          painter.drawPoints(shapes, {
            color: highlightColor,
            radius: highlightRadius,
            fill: highlightFill,
          });
        } else {
          painter.drawPaths(
            shapes,
            { color: highlightColor, width: highlightWidth },
            arcs,
          );
        }
      });
    });
  }

  private _getLayerId(layer: any, index: number): string {
    if (layer?.name) return String(layer.name);
    if (layer?.id) return String(layer.id);
    return `layer-${index}`;
  }
}
