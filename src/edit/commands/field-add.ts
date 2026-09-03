import type { EditCommand } from '../edit-command';
import {
  bumpAttributeVersion,
  type MapshaperDataset,
  type MapshaperLayer,
} from '../../types/mapshaper-types';

export interface FieldAddCommandOptions {
  layer: MapshaperLayer;
  /** Field name to add to every record that does not already have it. */
  field: string;
  /** Default value to assign. Defaults to `null` when omitted. */
  defaultValue?: unknown;
  dataset: MapshaperDataset;
}

/**
 * Add a new column to a layer's data table by setting `field` = `defaultValue`
 * on every record that does not already have the key. Records that already
 * carry the key are skipped (and not undone) so the operation is safely
 * idempotent.
 */
export class FieldAddCommand implements EditCommand {
  readonly label: string;
  /** Indices of records this command added the key to (used by undo). */
  private _addedIndices: number[] = [];

  constructor(private readonly opts: FieldAddCommandOptions) {
    this.label = `Add field ${opts.field}`;
  }

  do(): void {
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    const value = this.opts.defaultValue ?? null;
    this._addedIndices = [];
    for (let i = 0; i < records.length; i++) {
      if (records[i] && !(this.opts.field in records[i])) {
        records[i][this.opts.field] = value;
        this._addedIndices.push(i);
      }
    }
    bumpAttributeVersion(this.opts.dataset);
  }

  undo(): void {
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    for (const i of this._addedIndices) {
      delete records[i]?.[this.opts.field];
    }
    this._addedIndices = [];
    bumpAttributeVersion(this.opts.dataset);
  }
}
