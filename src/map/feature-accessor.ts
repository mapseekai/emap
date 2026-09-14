// Feature accessor — typed read-side API for individual features.
//
// Editor / SDK code repeatedly needs "given a FeatureRef, hand me the
// geometry shape and the attribute record". The raw path is:
//
//     const layer = registry.resolve(ref.source, ref.layer);
//     const geometry = layer?.shapes?.[ref.id];
//     const properties = layer?.data?.getRecords()?.[ref.id] ?? {};
//
// Repeated in 5+ call sites with subtly different undefined handling.
// `FeatureAccessor` collapses that into one place with one well-defined
// null contract (return `null` for any failed lookup, freeze properties
// so callers can't accidentally mutate the live record).
//
// Read-only by design: this module exposes no `update` / `set` paths —
// mutations go through the existing `attribute-ops` / edit-command
// pipeline so they participate in undo / history.

import type { LegacyPointShape, PathShape, PointShape } from '../types/mapshaper-types';
import type { EmapHostInternal } from './emap-host';
import type { FeatureRef } from './types';

export type FeatureReadContext = Pick<
  EmapHostInternal,
  'layers' | '_resolveRenderLayerTarget' | '_filterMaskForRenderLayer'
>;

/**
 * Read-only view of a single feature — geometry + frozen properties.
 * Returned by every successful {@link FeatureAccessor.get} / `iter`
 * call. The `properties` object is `Object.freeze`d so accidental
 * mutation by the caller can't bleed back into the underlying dataset
 * record.
 */
export interface Feature {
  ref: FeatureRef;
  /**
   * Geometry shape for this feature, or `null` when the feature row
   * exists but has no geometry attached (legal in mapshaper for
   * data-only layers and for explicit holes in some pipelines).
   */
  geometry: PathShape | PointShape | LegacyPointShape | null;
  /** Frozen view of the row's attribute record (or empty object). */
  properties: Readonly<Record<string, unknown>>;
}

/**
 * Read-only feature lookups. Hangs off `Emap.features`. Stateless
 * beyond the host reference; safe to call from any phase.
 */
export class FeatureAccessor {
  constructor(private readonly _host: FeatureReadContext) {}

  /**
   * Look up one feature by reference. Returns `null` if the source,
   * layer, or id can't be resolved (instead of throwing) so call sites
   * can write `if (!f) skip` ergonomically.
   */
  get(ref: FeatureRef): Feature | null {
    const layer = this._host.layers.resolve(ref.source, ref.layer);
    if (!layer) return null;
    if (!Number.isInteger(ref.id) || ref.id < 0) return null;
    const shapes = layer.shapes ?? null;
    if (!shapes || ref.id >= shapes.length) return null;
    const geometry = shapes[ref.id] as Feature['geometry'];
    const records = layer.data?.getRecords?.() ?? [];
    const properties = Object.freeze({ ...(records[ref.id] ?? {}) });
    return { ref, geometry, properties };
  }

  /**
   * Iterate every feature in `(sourceId, layerId)`. Yields nothing if
   * the layer doesn't resolve or has no shapes. Each yielded `Feature`
   * is a fresh allocation — safe to retain across iterations.
   */
  *iter(sourceId: string, layerId: string): IterableIterator<Feature> {
    const layer = this._host.layers.resolve(sourceId, layerId);
    if (!layer || !layer.shapes) return;
    const shapes = layer.shapes;
    const records = layer.data?.getRecords?.() ?? [];
    for (let i = 0; i < shapes.length; i++) {
      yield {
        ref: { source: sourceId, layer: layerId, id: i },
        geometry: shapes[i] as Feature['geometry'],
        properties: Object.freeze({ ...(records[i] ?? {}) }),
      };
    }
  }

  /**
   * Iterate the features visible through a render layer's display filter.
   * `renderLayerId` is a render layer id (`addLayer` / `setFilter` 的那个 id)，
   * 与按数据层寻址的 {@link iter} 区分：同一数据层上不同渲染层可有不同条件。
   * 该渲染层无过滤器时等价于全量迭代。
   */
  *iterFiltered(renderLayerId: string): IterableIterator<Feature> {
    const target = this._host._resolveRenderLayerTarget(renderLayerId);
    if (!target) return;
    const layer = this._host.layers.resolve(target.sourceId, target.layerId);
    if (!layer?.shapes) return;
    const mask = this._host._filterMaskForRenderLayer(renderLayerId);
    const shapes = layer.shapes;
    const records = layer.data?.getRecords?.() ?? [];
    for (let i = 0; i < shapes.length; i++) {
      if (mask && mask[i] !== 1) continue;
      yield {
        ref: { source: target.sourceId, layer: target.layerId, id: i },
        geometry: shapes[i] as Feature['geometry'],
        properties: Object.freeze({ ...(records[i] ?? {}) }),
      };
    }
  }

  /** Number of features in the layer, or `0` for unresolved layers. */
  count(sourceId: string, layerId: string): number {
    const layer = this._host.layers.resolve(sourceId, layerId);
    return layer?.shapes?.length ?? 0;
  }

  /** Number of features visible through a render layer's display filter. */
  countFiltered(renderLayerId: string): number {
    const target = this._host._resolveRenderLayerTarget(renderLayerId);
    if (!target) return 0;
    const layer = this._host.layers.resolve(target.sourceId, target.layerId);
    if (!layer?.shapes) return 0;
    const mask = this._host._filterMaskForRenderLayer(renderLayerId);
    if (!mask) return layer.shapes.length;
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i]!;
    return n;
  }
}
