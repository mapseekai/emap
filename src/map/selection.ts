import type { FeatureRef } from './types';
import type { SelectMode } from '../core/handlers/select-mode';

/** Mutation modes for {@link Selection.apply}. Canonical declaration lives
 *  in `core/handlers/select-mode.ts`; re-exported here for back-compat
 *  (the public `@/map/selection` path is unchanged). */
export type { SelectMode } from '../core/handlers/select-mode';

/** Diff produced by every selection mutation. */
export interface SelectionDiff {
  /** Refs newly present after the mutation */
  added: FeatureRef[];
  /** Refs newly absent after the mutation */
  removed: FeatureRef[];
  /** True when at least one of `added` / `removed` is non-empty */
  changed: boolean;
}

/**
 * Opaque snapshot returned by {@link Selection.snapshot} and consumed by
 * {@link Selection.restore}. Implementation detail — do not depend on
 * the concrete shape.
 */
export type SelectionSnapshot = ReadonlySet<string>;

/**
 * Persistent multi-source / multi-layer feature selection.
 *
 * Storage shape mirrors `HighlightManager`: `Map<source, Map<layer, Set<id>>>`.
 * That gives O(1) `has` checks, O(1) iteration per layer for downstream
 * operations, and free deduplication.
 *
 * Distinct from highlight on purpose: selection is persistent state ("what
 * the next operation will act on"), highlight is transient render state
 * ("what to draw extra strokes on right now").
 */
export class Selection {
  private _byKey: globalThis.Map<string, globalThis.Map<string, Set<number>>> =
    new globalThis.Map();
  private _size = 0;

  /** Number of distinct selected features across all source/layer pairs. */
  get size(): number {
    return this._size;
  }

  /** Returns `true` when the given feature is currently in the selection. */
  has(ref: FeatureRef): boolean {
    return this._byKey.get(ref.source)?.get(ref.layer)?.has(ref.id) ?? false;
  }

  /** Flat list of every selected ref, in insertion order within each layer. */
  getAll(): FeatureRef[] {
    const out: FeatureRef[] = [];
    for (const [source, byLayer] of this._byKey) {
      for (const [layer, ids] of byLayer) {
        for (const id of ids) {
          out.push({ source, layer, id });
        }
      }
    }
    return out;
  }

  /** Numeric ids selected within a single source/layer, in insertion order. */
  getByLayer(source: string, layer: string): number[] {
    const ids = this._byKey.get(source)?.get(layer);
    return ids ? Array.from(ids) : [];
  }

  /** Remove every entry. Returns the diff of refs that were actually cleared. */
  clear(): SelectionDiff {
    if (this._size === 0) {
      return { added: [], removed: [], changed: false };
    }
    const removed = this.getAll();
    this._byKey.clear();
    this._size = 0;
    return { added: [], removed, changed: true };
  }

  /**
   * Mutate the set according to `mode`:
   * - `replace`: result is exactly `refs` (clears prior state)
   * - `add`: union of current state and `refs`
   * - `toggle`: each ref is flipped (present → removed, absent → added)
   *
   * Returns a diff so the caller can fire events with `{ added, removed }`.
   */
  apply(refs: ReadonlyArray<FeatureRef>, mode: SelectMode): SelectionDiff {
    const dedup = uniqueRefs(refs);

    if (mode === 'replace') {
      const before = this._refSetSnapshot();
      this._byKey.clear();
      this._size = 0;
      for (const ref of dedup) this._addOne(ref);
      return diffSnapshots(before, this._refSetSnapshot());
    }

    const added: FeatureRef[] = [];
    const removed: FeatureRef[] = [];
    if (mode === 'add') {
      for (const ref of dedup) {
        if (this._addOne(ref)) added.push(ref);
      }
    } else {
      // toggle
      for (const ref of dedup) {
        if (this.has(ref)) {
          if (this._removeOne(ref)) removed.push(ref);
        } else {
          if (this._addOne(ref)) added.push(ref);
        }
      }
    }
    return { added, removed, changed: added.length > 0 || removed.length > 0 };
  }

  /** Remove the listed refs. Refs not present in the selection are skipped silently. */
  remove(refs: ReadonlyArray<FeatureRef>): SelectionDiff {
    const removed: FeatureRef[] = [];
    for (const ref of uniqueRefs(refs)) {
      if (this._removeOne(ref)) removed.push(ref);
    }
    return { added: [], removed, changed: removed.length > 0 };
  }

  /**
   * Capture the current selection as an opaque snapshot. The returned
   * value is meant to be handed back to {@link restore} later — its
   * shape (currently `Set<string>` of encoded refs) is an implementation
   * detail and may change.
   *
   * Used by `Transaction` for rollback so a transaction-internal
   * operation that clears the selection can be reverted.
   */
  snapshot(): SelectionSnapshot {
    return this._refSetSnapshot();
  }

  /**
   * Replace the current selection with the contents of a previously
   * captured snapshot. Returns the diff between the old state and the
   * restored state so callers can fire a single `selectionchange` event.
   */
  restore(snap: SelectionSnapshot): SelectionDiff {
    const before = this._refSetSnapshot();
    this._byKey.clear();
    this._size = 0;
    for (const k of snap) this._addOne(parseRefKey(k));
    return diffSnapshots(before, snap);
  }

  // --- internals --------------------------------------------------------

  private _addOne(ref: FeatureRef): boolean {
    let byLayer = this._byKey.get(ref.source);
    if (!byLayer) {
      byLayer = new globalThis.Map();
      this._byKey.set(ref.source, byLayer);
    }
    let ids = byLayer.get(ref.layer);
    if (!ids) {
      ids = new Set<number>();
      byLayer.set(ref.layer, ids);
    }
    if (ids.has(ref.id)) return false;
    ids.add(ref.id);
    this._size++;
    return true;
  }

  private _removeOne(ref: FeatureRef): boolean {
    const byLayer = this._byKey.get(ref.source);
    const ids = byLayer?.get(ref.layer);
    if (!ids?.has(ref.id)) return false;
    ids.delete(ref.id);
    this._size--;
    if (ids.size === 0) {
      byLayer!.delete(ref.layer);
      if (byLayer!.size === 0) this._byKey.delete(ref.source);
    }
    return true;
  }

  private _refSetSnapshot(): Set<string> {
    const out = new Set<string>();
    for (const [source, byLayer] of this._byKey) {
      for (const [layer, ids] of byLayer) {
        for (const id of ids) out.add(refKey(source, layer, id));
      }
    }
    return out;
  }
}

function refKey(source: string, layer: string, id: number): string {
  // JSON-encode the parts so any character (including separators a user might
  // pick for source/layer ids) is safely escaped — no collision risk.
  return JSON.stringify([source, layer, id]);
}

function parseRefKey(key: string): FeatureRef {
  const [source, layer, id] = JSON.parse(key) as [string, string, number];
  return { source, layer, id };
}

function diffSnapshots(before: ReadonlySet<string>, after: ReadonlySet<string>): SelectionDiff {
  const added: FeatureRef[] = [];
  const removed: FeatureRef[] = [];
  for (const k of after) if (!before.has(k)) added.push(parseRefKey(k));
  for (const k of before) if (!after.has(k)) removed.push(parseRefKey(k));
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

function uniqueRefs(refs: ReadonlyArray<FeatureRef>): FeatureRef[] {
  const seen = new Set<string>();
  const out: FeatureRef[] = [];
  for (const ref of refs) {
    const k = refKey(ref.source, ref.layer, ref.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ref);
  }
  return out;
}
