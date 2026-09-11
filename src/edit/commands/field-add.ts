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
  private _previousFields: MapshaperLayer['fields'];

  constructor(private readonly opts: FieldAddCommandOptions) {
    this.label = `Add field ${opts.field}`;
  }

  do(): void {
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    const value = this.opts.defaultValue ?? null;
    this._previousFields = this.opts.layer.fields;
    if (
      this._previousFields &&
      !this._previousFields.some((field) => field.name === this.opts.field)
    ) {
      const type = typeof value;
      if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
        throw new Error('Field default must be a string, number, boolean or null');
      }
      this.opts.layer.fields = [
        ...this._previousFields,
        {
          name: this.opts.field,
          type: type === 'number' || type === 'boolean' ? type : 'string',
          defaultValue: value as string | number | boolean | null,
        },
      ];
    }
    this._addedIndices = [];
    for (let i = 0; i < records.length; i++) {
      if (records[i] && !Object.hasOwn(records[i], this.opts.field)) {
        Object.defineProperty(records[i], this.opts.field, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        this._addedIndices.push(i);
      }
    }
    bumpAttributeVersion(this.opts.dataset);
  }

  undo(): void {
    this.opts.layer.fields = this._previousFields;
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    for (const i of this._addedIndices) {
      delete records[i]?.[this.opts.field];
    }
    this._addedIndices = [];
    bumpAttributeVersion(this.opts.dataset);
  }
}
