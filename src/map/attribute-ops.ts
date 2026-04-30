// Per-feature attribute editing (set property/properties) and per-layer
// schema editing (add/remove/rename field). Composed onto Emap as
// `emap.attributes`.

import { FeaturePropertyChangeCommand } from '../edit/commands/feature-property-change';
import { FieldAddCommand } from '../edit/commands/field-add';
import { FieldRemoveCommand } from '../edit/commands/field-remove';
import { FieldRenameCommand } from '../edit/commands/field-rename';
import type { FeatureRef } from './types';

/**
 * Attribute-editing manager. Owned by Emap and exposed as `emap.attributes`.
 * Construction takes the host Emap; the manager calls back into a small
 * surface of internal helpers (`_resolveLayer`, `_history`, ...) on the host.
 */
export class AttributeOps {
  constructor(private _emap: any) {}

  setFeatureProperty(ref: FeatureRef, key: string, value: unknown): boolean {
    return this.setFeatureProperties(ref, { [key]: value });
  }

  /**
   * Set multiple properties on one feature in a single undo entry.
   *
   * Per-key semantics:
   * - `props[key] === undefined` → delete the key from the record
   * - any other value → set / overwrite the key
   *
   * Returns `false` for unresolvable refs or when every key already has the
   * requested value (no-op call); no command is pushed and no events fire.
   */
  setFeatureProperties(
    ref: FeatureRef,
    props: Record<string, unknown>,
  ): boolean {
    const layer = this._emap._resolveLayer(ref.source, ref.layer);
    if (!layer) return false;
    const records = layer.data?.getRecords?.();
    const record = records?.[ref.id];
    if (!record) return false;

    const prev: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(props)) {
      const had = key in record;
      const prevValue = had ? record[key] : undefined;
      const nextValue = props[key];

      if (nextValue === undefined && !had) continue;
      if (nextValue !== undefined && had && record[key] === nextValue) continue;

      if (had) prev[key] = prevValue;
      if (nextValue !== undefined) next[key] = nextValue;
    }

    if (Object.keys(prev).length === 0 && Object.keys(next).length === 0) {
      return false;
    }

    const cmd = new FeaturePropertyChangeCommand({
      layer,
      featureId: ref.id,
      prev,
      next,
    });
    cmd.do();
    this._emap._history.push(cmd);
    this._emap._fireHistoryChange();
    this._emap._scheduleRender();
    return true;
  }

  /**
   * Add a new column to a layer's data table. Records that already carry the
   * key are skipped (and not rolled back by undo). `defaultValue` defaults to
   * `null`. Returns `false` if the source / target / data table cannot be
   * resolved.
   */
  addField(
    opts: { source: string; target: string; field: string; defaultValue?: unknown },
  ): boolean {
    const layer = this._emap._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const cmd = new FieldAddCommand({
      layer,
      field: opts.field,
      defaultValue: opts.defaultValue,
    });
    cmd.do();
    this._emap._history.push(cmd);
    this._emap._fireHistoryChange();
    this._emap._scheduleRender();
    return true;
  }

  /**
   * Drop a column from a layer's data table. Per-record values are
   * snapshotted for undo so removing the field is fully reversible.
   * Returns `false` if the source / target / data table cannot be resolved.
   */
  removeField(
    opts: { source: string; target: string; field: string },
  ): boolean {
    const layer = this._emap._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const cmd = new FieldRemoveCommand({ layer, field: opts.field });
    cmd.do();
    this._emap._history.push(cmd);
    this._emap._fireHistoryChange();
    this._emap._scheduleRender();
    return true;
  }

  /**
   * Rename a column on every record in a layer. Refuses (returns `false`) when
   * any record already carries both `from` and `to` so silent overwrites are
   * impossible. Use `removeField(to)` first if that is the intent.
   */
  renameField(
    opts: { source: string; target: string; from: string; to: string },
  ): boolean {
    const layer = this._emap._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const records = layer.data.getRecords?.();
    if (!records) return false;
    if (opts.from === opts.to) return false;
    for (const r of records) {
      if (r && opts.from in r && opts.to in r) {
        return false;
      }
    }
    const cmd = new FieldRenameCommand({ layer, from: opts.from, to: opts.to });
    cmd.do();
    this._emap._history.push(cmd);
    this._emap._fireHistoryChange();
    this._emap._scheduleRender();
    return true;
  }
}
