import { cloneIconOptions, type IconOptions } from '../../map/icon';
import { cloneLabelOptions, validateLabelOptions, type LabelOptions } from '../../map/label';
import type { LayerChangeReason } from '../../core/event-map';
import { EventDispatcher } from '../../core/events';
import { FilterEvaluationError, FilterResolver } from '../../map/filter-resolver';
import {
  cloneLayerSpecification,
  DEFAULT_LAYER_COLOR,
  type LayerPaint,
  type LayerSpecification,
} from '../../map/layer';
import { addLayerKey, type MutableLayerKeyIndex } from '../../map/structured-keys';
import {
  compileStyleExpression,
  isStyleExpression,
  type StyleExpression,
} from '../../map/style-expression';
import { StyleResolver } from '../../map/style-resolver';
import { getLayerId } from '../../../domain/source/layer-utils';
import type { MapshaperLayer } from '../../../shared/types/mapshaper-types';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';

function assertValidPaint(
  id: string,
  paint: LayerPaint | Record<string, unknown> | undefined,
): void {
  if (!paint) return;
  for (const [key, value] of Object.entries(paint)) {
    if (isStyleExpression(value)) {
      try {
        compileStyleExpression(value);
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`Layer "${id}" paint "${key}": ${err.name}: ${err.message}`, {
            cause: err,
          });
        }
        throw err;
      }
    }
  }
}

function assertValidPointLod(layer: LayerSpecification): void {
  if ('pointLod' in layer && layer.pointLod !== undefined) {
    const lod = layer.pointLod;
    if (
      layer.type !== 'circle' ||
      (lod !== false &&
        (!lod ||
          typeof lod !== 'object' ||
          Array.isArray(lod) ||
          Object.keys(lod).some((key) => key !== 'cellSize') ||
          (lod.cellSize !== undefined &&
            (typeof lod.cellSize !== 'number' ||
              !Number.isFinite(lod.cellSize) ||
              lod.cellSize < 1 ||
              lod.cellSize > 64))))
    ) {
      throw new Error(
        `Layer "${layer.id}": pointLod must be false or { cellSize: 1..64 } on a circle layer`,
      );
    }
  }
}

function assertValidFilter(id: string, filter: StyleExpression | undefined): void {
  if (filter === undefined) return;
  try {
    compileStyleExpression(filter);
  } catch (err) {
    throw new Error(
      `Layer "${id}" filter: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
  }
}

interface Dependencies {
  document: Pick<WorkspaceDocument, '_sources' | 'layers'>;
  events: EventDispatcher;
  signals: RenderSignals;
}

/** layers implementation, wired through explicit service dependencies. */
export class LayerServiceImpl {
  _layers: LayerSpecification[] = [];

  _styleResolver = new StyleResolver({
    onWarn: (w) => this.deps.events.fire('warning', w),
  });

  _filterResolver = new FilterResolver({
    onError: (e) =>
      this.deps.events.fire('error', {
        error: e.error,
        layerId: e.layerId,
        filterExpression: e.expression,
        valueType: e.error instanceof FilterEvaluationError ? e.error.valueType : undefined,
      }),
  });

  _effectiveLayersCache: LayerSpecification[] = [];

  _defaultLayersDirty = true;

  public addLayer(layer: LayerSpecification, before?: string): void {
    if (!this.deps.document._sources.has(layer.source)) {
      throw new Error(`Source "${layer.source}" not found`);
    }
    if (this._layers.some((l) => l.id === layer.id)) {
      throw new Error(`Layer "${layer.id}" already exists`);
    }
    if (layer.label !== undefined) validateLabelOptions(layer.label);
    assertValidPointLod(layer);
    assertValidPaint(layer.id, layer.paint);
    assertValidFilter(layer.id, layer.filter);
    if (before) {
      const idx = this._layers.findIndex((l) => l.id === before);
      if (idx === -1) {
        throw new Error(`Layer "${before}" not found`);
      }
      this._layers.splice(idx, 0, cloneLayerSpecification(layer));
    } else {
      this._layers.push(cloneLayerSpecification(layer));
    }
    this._defaultLayersDirty = true;
    this.deps.signals.requestRender();
    this._fireLayerChange('add', layer.id);
  }

  public removeLayer(id: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx !== -1) {
      this._layers.splice(idx, 1);
      this._filterResolver.clear(id);
      this.deps.events.fire('rendercacheclear', { layerId: id });
      this._defaultLayersDirty = true;
      this.deps.signals.requestRender();
      this._fireLayerChange('remove', id);
    }
  }

  public getLayer(id: string): LayerSpecification | undefined {
    const layer = this._layers.find((candidate) => candidate.id === id);
    return layer ? cloneLayerSpecification(layer) : undefined;
  }

  public getLayers(): readonly LayerSpecification[] {
    return this._layers.map(cloneLayerSpecification);
  }

  public getRenderedLayers(): readonly LayerSpecification[] {
    return this._getEffectiveLayers().map(cloneLayerSpecification);
  }

  public setLayerVisibility(id: string, visibility: 'visible' | 'none'): void {
    let layer = this._layers.find((candidate) => candidate.id === id);
    if (!layer && this._layers.length === 0) {
      const effectiveLayers = this._getEffectiveLayers();
      const index = effectiveLayers.findIndex((candidate) => candidate.id === id);
      if (index === -1) return;
      if ((effectiveLayers[index].layout?.visibility ?? 'visible') === visibility) return;
      this._layers = effectiveLayers.map(cloneLayerSpecification);
      layer = this._layers[index];
    }
    if (!layer || (layer.layout?.visibility ?? 'visible') === visibility) return;
    if (!layer.layout) layer.layout = {};
    layer.layout.visibility = visibility;
    this.deps.signals.requestRender();
    this._fireLayerChange('visibility', id);
  }

  public setPaintProperty(id: string, name: string, value: unknown): void {
    const layer = this._layers.find((l) => l.id === id);
    if (layer) {
      assertValidPaint(id, { [name]: value });
      if (!layer.paint) layer.paint = {};
      (layer.paint as Record<string, unknown>)[name] = value;
      this.deps.signals.requestRender();
    }
  }

  /** Replace only the parent layer's label configuration. null disables/removes labels. */
  public setLayerIcon(id: string, options: IconOptions | null): void {
    const icon = options === null ? undefined : cloneIconOptions(options);
    const effective = this._layers.length ? this._layers : this._getEffectiveLayers();
    const index = effective.findIndex((layer) => layer.id === id);
    if (index < 0) throw new Error(`Layer "${id}" not found`);
    if (effective[index].type !== 'circle')
      throw new Error('Icons are supported only on circle/point layers.');
    if (!this._layers.length) this._layers = effective.map(cloneLayerSpecification);
    const layer = this._layers[index];
    if (layer.type !== 'circle') return;
    layer.icon = icon;
    this.deps.signals.requestRender();
    this._fireLayerChange('effective', id);
  }

  public setLayerLabel(id: string, options: LabelOptions | null): void {
    const label = options === null ? undefined : cloneLabelOptions(options);
    let index = this._layers.findIndex((candidate) => candidate.id === id);
    if (index < 0 && this._layers.length === 0) {
      const effective = this._getEffectiveLayers();
      index = effective.findIndex((candidate) => candidate.id === id);
      if (index < 0) throw new Error(`Layer "${id}" not found`);
      this._layers = effective.map(cloneLayerSpecification);
    }
    if (index < 0) throw new Error(`Layer "${id}" not found`);
    this._layers[index].label = label;
    this.deps.signals.requestRender();
    this._fireLayerChange('effective', id);
  }

  public setFilter(id: string, expression: StyleExpression | null): void {
    let layer = this._layers.find((candidate) => candidate.id === id);
    if (!layer && this._layers.length === 0) {
      const effectiveLayers = this._getEffectiveLayers();
      const index = effectiveLayers.findIndex((candidate) => candidate.id === id);
      if (index === -1) return;
      this._layers = effectiveLayers.map(cloneLayerSpecification);
      layer = this._layers[index];
    }
    if (!layer) return;
    if (expression !== null) assertValidFilter(id, expression);
    layer.filter = expression === null ? undefined : expression;
    this._filterResolver.clear(id);
    this.deps.signals.requestRender();
    this._fireLayerChange('filter', id);
  }

  public getFilter(id: string): StyleExpression | undefined {
    return this.getLayer(id)?.filter;
  }

  public moveLayer(id: string, beforeId?: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const [layer] = this._layers.splice(idx, 1);
    if (beforeId) {
      const beforeIdx = this._layers.findIndex((l) => l.id === beforeId);
      if (beforeIdx === -1) {
        this._layers.push(layer);
      } else {
        this._layers.splice(beforeIdx, 0, layer);
      }
    } else {
      this._layers.push(layer);
    }
    this._defaultLayersDirty = true;
    this.deps.signals.requestRender();
    this._fireLayerChange('effective', id);
  }

  _fireLayerChange(
    reason: LayerChangeReason,
    layerId?: string,
    renderedLayers?: readonly LayerSpecification[],
  ): void {
    const layers = renderedLayers
      ? renderedLayers.map(cloneLayerSpecification)
      : this.getRenderedLayers();
    this.deps.events.fire('layerchange', { reason, layerId, layers });
  }

  _getEffectiveLayers(): LayerSpecification[] {
    if (this._layers.length > 0) return this._layers;

    if (!this._defaultLayersDirty) {
      return this._effectiveLayersCache;
    }

    const defaults: LayerSpecification[] = [];
    for (const [sourceId, source] of this.deps.document._sources) {
      const mapshaperLayers = source.getLayers() as MapshaperLayer[];
      if (mapshaperLayers.length === 0) {
        defaults.push({
          id: `${sourceId}:default`,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': DEFAULT_LAYER_COLOR, 'line-width': 0.8 },
        });
      } else {
        for (let i = 0; i < mapshaperLayers.length; i++) {
          const ml = mapshaperLayers[i];
          const layerId = getLayerId(ml, i);
          const geomType = ml.geometry_type;
          // Default polygon rendering is outline-only (`type: 'line'`) to match
          // mapshaper GUI's behaviour and emap's pre-layer-concept default.
          // Canvas 2D fill is significantly more expensive than stroke for
          // many-polygon datasets (winding-rule rasterization vs straight
          // strokes). Callers who want a filled appearance add an explicit
          // `type: 'fill'` layer via addLayer().
          if (geomType === 'point') {
            defaults.push({
              id: `${sourceId}:${layerId}`,
              type: 'circle',
              source: sourceId,
              'source-layer': layerId,
              paint: { 'circle-color': DEFAULT_LAYER_COLOR, 'circle-radius': 4 },
            });
          } else {
            defaults.push({
              id: `${sourceId}:${layerId}`,
              type: 'line',
              source: sourceId,
              'source-layer': layerId,
              paint: { 'line-color': DEFAULT_LAYER_COLOR, 'line-width': 0.8 },
            });
          }
        }
      }
    }

    this._effectiveLayersCache = defaults;
    this._defaultLayersDirty = false;
    return defaults;
  }

  _getVisibleLayerKeys(): MutableLayerKeyIndex {
    const keys: MutableLayerKeyIndex = new globalThis.Map();
    const layers = this._getEffectiveLayers();
    for (const layer of layers) {
      if (layer.layout?.visibility === 'none') continue;
      const source = this.deps.document._sources.get(layer.source);
      if (!source) continue;
      const ml = this.deps.document.layers.resolve(layer.source, layer['source-layer']);
      if (ml) {
        const mapshaperLayers = source.getLayers() as MapshaperLayer[];
        const idx = mapshaperLayers.indexOf(ml);
        const lid = getLayerId(ml, idx >= 0 ? idx : 0);
        addLayerKey(keys, layer.source, lid);
      }
    }
    return keys;
  }

  _featureMaskForPick = (sourceId: string, dataLayerId: string): Uint8Array | null => {
    const source = this.deps.document._sources.get(sourceId);
    if (!source) return null;
    let union: Uint8Array | null = null;
    for (const layer of this._getEffectiveLayers()) {
      if (layer.source !== sourceId) continue;
      if (layer.layout?.visibility === 'none') continue;
      const ml = this.deps.document.layers.resolve(layer.source, layer['source-layer']);
      if (!ml?.shapes) continue;
      const mapshaperLayers = source.getLayers() as MapshaperLayer[];
      const idx = mapshaperLayers.indexOf(ml);
      if (getLayerId(ml, idx >= 0 ? idx : 0) !== dataLayerId) continue;
      if (!layer.filter) return null;
      const dataset = source.getDataset?.();
      if (!dataset) return null;
      const mask = this._filterResolver.mask({
        layerId: layer.id,
        filter: layer.filter,
        dataset,
        layer: ml,
      });
      if (!mask) return null;
      if (!union) {
        union = mask.slice();
      } else {
        for (let i = 0; i < union.length; i++) union[i]! = union[i]! | mask[i]!;
      }
    }
    return union;
  };

  _resolveRenderLayerTarget(renderLayerId: string): { sourceId: string; layerId: string } | null {
    const spec = this._getEffectiveLayers().find((l) => l.id === renderLayerId);
    if (!spec) return null;
    const source = this.deps.document._sources.get(spec.source);
    const ml = this.deps.document.layers.resolve(spec.source, spec['source-layer']);
    if (!source || !ml) return null;
    const mapshaperLayers = source.getLayers() as MapshaperLayer[];
    const idx = mapshaperLayers.indexOf(ml);
    return { sourceId: spec.source, layerId: getLayerId(ml, idx >= 0 ? idx : 0) };
  }

  _filterMaskForRenderLayer(renderLayerId: string): Uint8Array | null {
    const spec = this._getEffectiveLayers().find((l) => l.id === renderLayerId);
    if (!spec?.filter) return null;
    const source = this.deps.document._sources.get(spec.source);
    const ml = this.deps.document.layers.resolve(spec.source, spec['source-layer']);
    const dataset = source?.getDataset?.();
    if (!source || !ml?.shapes || !dataset) return null;
    return this._filterResolver.mask({
      layerId: spec.id,
      filter: spec.filter,
      dataset,
      layer: ml,
    });
  }

  constructor(private readonly deps: Dependencies) {}
}
