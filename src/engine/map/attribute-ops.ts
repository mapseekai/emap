// Per-feature attribute editing (set property/properties) and per-layer
// schema editing (add/remove/rename field). Composed onto Emap as
// `emap.attributes`.

import type { EditCommand } from '../../domain/edit/edit-command';
import { FeaturePropertyChangeCommand } from '../../domain/edit/commands/feature-property-change';
import { FieldAddCommand } from '../../domain/edit/commands/field-add';
import { FieldRemoveCommand } from '../../domain/edit/commands/field-remove';
import { FieldRenameCommand } from '../../domain/edit/commands/field-rename';
import type { FeatureRef } from './types';
import type { EmapHostInternal } from './emap-host';
import { Err, OK, type OpResult } from './op-result';

/**
 * Attribute-editing manager. Owned by Emap and exposed as `emap.attributes`.
 * Construction takes the host Emap; the manager calls back into a small
 * surface of internal helpers (`layers.resolve`, `_history`, ...) on the host.
 *
 * Every method returns `OpResult<void>` — `{ ok: true, value: undefined }` on
 * success, `{ ok: false, error: OpError }` for unresolvable refs or no-op
 * calls. Errors carry a structured `kind` so UIs can branch on the cause.
 */
export class AttributeOps {
  constructor(private _emap: EmapHostInternal) {}

  setFeatureProperty(ref: FeatureRef, key: string, value: unknown): OpResult {
    return this.setFeatureProperties(ref, { [key]: value });
  }

  /**
   * Set multiple properties on one feature in a single undo entry.
   *
   * Per-key semantics:
   * - `props[key] === undefined` → delete the key from the record
   * - any other value → set / overwrite the key
   *
   * Returns a `validation` error when every key already has the requested
   * value (no-op call); no command is pushed and no events fire.
   */
  setFeatureProperties(ref: FeatureRef, props: Record<string, unknown>): OpResult {
    const layer = this._emap.layers.resolve(ref.source, ref.layer);
    if (!layer) return Err.notFound('layer', ref.layer);
    const records = layer.data?.getRecords?.();
    const record = records?.[ref.id];
    if (!record) return Err.notFound('field', `record#${ref.id}`);

    const prev: Record<string, unknown> = Object.create(null);
    const next: Record<string, unknown> = Object.create(null);

    for (const key of Object.keys(props)) {
      const had = Object.hasOwn(record, key);
      const prevValue = had ? record[key] : undefined;
      const nextValue = props[key];

      if (nextValue === undefined && !had) continue;
      if (nextValue !== undefined && had && record[key] === nextValue) continue;

      if (had) prev[key] = prevValue;
      if (nextValue !== undefined) next[key] = nextValue;
    }

    if (Object.keys(prev).length === 0 && Object.keys(next).length === 0) {
      return Err.validation('props', 'no-op: every requested value already matches the record');
    }

    const dataset = this._emap._sources.get(ref.source)?.getDataset();
    if (!dataset) return Err.notFound('source', ref.source);
    const cmd = new FeaturePropertyChangeCommand({
      layer,
      featureId: ref.id,
      prev,
      next,
      dataset,
    });
    return this._commit(cmd);
  }

  /**
   * Add a new column to a layer's data table. Records that already carry the
   * key are skipped (and not rolled back by undo). `defaultValue` defaults to
   * `null`. Returns a `not-found` error when the source / target / data table
   * cannot be resolved.
   */
  addField(opts: {
    source: string;
    target: string;
    field: string;
    defaultValue?: unknown;
  }): OpResult {
    const layer = this._emap.layers.resolve(opts.source, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);
    if (!layer.data) return Err.validation('target', 'layer has no data table');
    if (
      layer.fields &&
      (!opts.field.trim() ||
        (opts.defaultValue != null &&
          !['string', 'number', 'boolean'].includes(typeof opts.defaultValue)) ||
        (typeof opts.defaultValue === 'number' && !Number.isFinite(opts.defaultValue)))
    ) {
      return Err.validation('field', 'Schema fields require a name and a finite scalar default');
    }
    const dataset = this._emap._sources.get(opts.source)?.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const cmd = new FieldAddCommand({
      layer,
      field: opts.field,
      defaultValue: opts.defaultValue,
      dataset,
    });
    return this._commit(cmd);
  }

  /**
   * Drop a column from a layer's data table. Per-record values are
   * snapshotted for undo so removing the field is fully reversible.
   */
  removeField(opts: { source: string; target: string; field: string }): OpResult {
    const layer = this._emap.layers.resolve(opts.source, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);
    if (!layer.data) return Err.validation('target', 'layer has no data table');
    const dataset = this._emap._sources.get(opts.source)?.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const cmd = new FieldRemoveCommand({ layer, field: opts.field, dataset });
    return this._commit(cmd);
  }

  /**
   * Rename a column on every record in a layer. Refuses with a `validation`
   * error when any record already carries both `from` and `to` so silent
   * overwrites are impossible. Use `removeField(to)` first if that is the
   * intent.
   */
  renameField(opts: { source: string; target: string; from: string; to: string }): OpResult {
    const layer = this._emap.layers.resolve(opts.source, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);
    if (!layer.data) return Err.validation('target', 'layer has no data table');
    const records = layer.data.getRecords?.();
    if (!records) return Err.validation('target', 'data table has no records');
    if (opts.from === opts.to) return Err.validation('to', '`from` and `to` are identical');
    if (layer.fields && (!opts.to.trim() || layer.fields.some((field) => field.name === opts.to))) {
      return Err.validation('to', 'Field name is empty or already exists in the schema');
    }
    for (const r of records) {
      if (r && Object.hasOwn(r, opts.from) && Object.hasOwn(r, opts.to)) {
        return Err.validation('to', `would overwrite existing '${opts.to}' on at least one record`);
      }
    }
    const dataset = this._emap._sources.get(opts.source)?.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const cmd = new FieldRenameCommand({ layer, from: opts.from, to: opts.to, dataset });
    return this._commit(cmd);
  }

  private _commit(cmd: EditCommand): OpResult {
    cmd.do();
    this._emap._history.push(cmd);
    this._emap._fireHistoryChange();
    this._emap._scheduleRender();
    return OK;
  }
}
