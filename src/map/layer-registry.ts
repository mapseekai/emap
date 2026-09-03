// Single source of truth for resolving a `(sourceId, layerId)` reference to
// the underlying MapshaperLayer. Replaces three earlier ad-hoc lookups that
// each implemented a slightly different matching rule:
//
//   - `Emap._resolveLayer` matched on `getLayerId(layer, idx)`, which falls
//     back to `'layer-N'` for unnamed layers — so callers could pass the
//     positional id.
//   - `Emap._resolveSourceLayer` ran the same `getLayerId` lookup but inside
//     the renderer.
//   - `MapshaperOps.findLayerByName` matched on `layer.name === id` OR
//     `layer.id === id` and ignored positional ids.
//
// The new `LayerRegistry.resolve` accepts the union of all three: positional
// `'layer-N'`, explicit `layer.name`, and explicit `layer.id`. That keeps
// every existing call site working without changing public API behaviour.

import type { TopologySource } from '../source/source';
import { getLayerId } from '../source/layer-utils';
import type { MapshaperLayer } from '../types/mapshaper-types';

/**
 * Resolve `layerId` against an ad-hoc layer list. Callable as a free
 * function so ops that take a dataset snapshot (and don't have a host
 * reference) can share the same matching rule. Use {@link LayerRegistry.resolve}
 * when you have a `(sourceId, layerId)` tuple instead.
 */
export function resolveLayerInList(
  layers: ReadonlyArray<MapshaperLayer>,
  layerId: string,
): MapshaperLayer | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer) continue;
    if (getLayerId(layer, i) === layerId) return layer;
  }
  for (const layer of layers) {
    if (layer?.name === layerId) return layer;
  }
  for (const layer of layers) {
    if (layer?.id === layerId) return layer;
  }
  return null;
}

export class LayerRegistry {
  constructor(private readonly _sources: globalThis.Map<string, TopologySource>) {}

  /**
   * Resolve `(sourceId, layerId)` to the underlying MapshaperLayer. When
   * `layerId` is omitted, resolve the source's first layer.
   *
   * `layerId` is matched in this priority order:
   *   1. The canonical id from `getLayerId(layer, idx)` — i.e. layer.name,
   *      then layer.id, then the positional `'layer-N'` fallback.
   *   2. `layer.name` (exact match).
   *   3. `layer.id` (exact match).
   *
   * Returns the FIRST hit; in a well-formed dataset every layer's
   * `getLayerId` is unique so the priority list is theoretical.
   */
  resolve(sourceId: string, layerId?: string): MapshaperLayer | null {
    const source = this._sources.get(sourceId);
    if (!source) return null;
    const layers = source.getLayers() as MapshaperLayer[];
    return layerId === undefined ? (layers[0] ?? null) : resolveLayerInList(layers, layerId);
  }
}
