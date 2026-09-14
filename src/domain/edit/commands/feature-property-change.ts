import type { EditCommand } from '../edit-command';
import {
  bumpAttributeVersion,
  type MapshaperDataset,
  type MapshaperLayer,
} from '../../../shared/types/mapshaper-types';

export interface FeaturePropertyChangeCommandOptions {
  /** Layer that owns the feature. */
  layer: MapshaperLayer;
  /** Index of the feature within `layer.shapes`. */
  featureId: number;
  /**
   * Sparse patch of pre-edit values, keyed by field name. The presence of a
   * key means "the record had this key with this value before the edit"; an
   * absent key means "the record did not have this key before the edit".
   */
  prev: Record<string, unknown>;
  /**
   * Sparse patch of post-edit values. Same key-presence semantics as `prev`:
   * present = "this key should exist with this value", absent = "this key
   * should not exist".
   */
  next: Record<string, unknown>;
  /** Optional human-readable label for `historychange`. */
  label?: string;
  dataset: MapshaperDataset;
}

/**
 * Reverse a single-feature attribute edit by walking a sparse `prev` / `next`
 * patch. Memory cost is proportional to the number of keys that actually
 * changed, not the size of the record.
 */
export class FeaturePropertyChangeCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: FeaturePropertyChangeCommandOptions) {
    this.label = opts.label ?? 'Edit properties';
  }

  do(): void {
    applyPatch(this.opts.layer, this.opts.featureId, this.opts.prev, this.opts.next);
    bumpAttributeVersion(this.opts.dataset);
  }

  undo(): void {
    applyPatch(this.opts.layer, this.opts.featureId, this.opts.next, this.opts.prev);
    bumpAttributeVersion(this.opts.dataset);
  }
}

/**
 * Apply a directional patch to one record. For each key in `to`, write
 * `record[key] = to[key]`. For each key in `from` that is NOT in `to`,
 * delete the key from the record. Keys present in `to` but absent in `from`
 * were added by the edit; keys present in `from` but absent in `to` were
 * removed by the edit.
 */
function applyPatch(
  layer: MapshaperLayer,
  featureId: number,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): void {
  const records = layer.data?.getRecords?.();
  const record = records?.[featureId];
  if (!record) return;
  // Forward: write everything in `to`.
  for (const key of Object.keys(to)) {
    // Define an own data property, including keys such as __proto__.
    Object.defineProperty(record, key, {
      value: to[key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  // Cleanup: drop keys that existed in `from` but are no longer in `to`.
  for (const key of Object.keys(from)) {
    if (!Object.hasOwn(to, key)) {
      delete record[key];
    }
  }
}
