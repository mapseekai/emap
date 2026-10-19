import type { EditCommand } from '../edit-command';
import {
  bumpAttributeVersion,
  type MapshaperDataset,
  type MapshaperLayer,
} from '../../../shared/types/mapshaper-types';

export interface FieldRemoveCommandOptions {
  layer: MapshaperLayer;
  /** Field name to drop from every record in the layer. */
  field: string;
  dataset: MapshaperDataset;
}

/**
 * Drop a column from a layer's data table. Each record's prior value is
 * snapshotted on `do()` so `undo()` can restore exact contents — including
 * leaving records that never had the field untouched.
 */
export class FieldRemoveCommand implements EditCommand {
  readonly label: string;
  private _snapshot: globalThis.Map<number, unknown> = new globalThis.Map<number, unknown>();
  private _previousFields: MapshaperLayer['fields'];

  constructor(private readonly opts: FieldRemoveCommandOptions) {
    this.label = `Remove field ${opts.field}`;
  }

  do(): void {
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    this._snapshot.clear();
    this._previousFields = this.opts.layer.fields;
    if (this._previousFields) {
      this.opts.layer.fields = this._previousFields.filter(
        (field) => field.name !== this.opts.field,
      );
    }
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r && Object.hasOwn(r, this.opts.field)) {
        this._snapshot.set(i, r[this.opts.field]);
        delete r[this.opts.field];
      }
    }
    bumpAttributeVersion(this.opts.dataset);
  }

  undo(): void {
    this.opts.layer.fields = this._previousFields;
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    for (const [i, value] of this._snapshot) {
      const r = records[i];
      if (r)
        Object.defineProperty(r, this.opts.field, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
    }
    bumpAttributeVersion(this.opts.dataset);
  }
}
