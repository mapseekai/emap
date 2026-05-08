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

import type { FeatureRef } from './types';
import type {
  PathShape,
  PointShape,
  LegacyPointShape,
} from '../types/mapshaper-types';
import type { EmapHostInternal } from './emap-host';

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
  constructor(private readonly _host: EmapHostInternal) {}

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

  /** Number of features in the layer, or `0` for unresolved layers. */
  count(sourceId: string, layerId: string): number {
    const layer = this._host.layers.resolve(sourceId, layerId);
    return layer?.shapes?.length ?? 0;
  }
}
