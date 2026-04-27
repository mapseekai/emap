import type { EditCommand } from '../edit-command';
import type { MapshaperLayer } from '../../types/mapshaper-types';

export interface FieldRemoveCommandOptions {
  layer: MapshaperLayer;
  /** Field name to drop from every record in the layer. */
  field: string;
}

/**
 * Drop a column from a layer's data table. Each record's prior value is
 * snapshotted on `do()` so `undo()` can restore exact contents — including
 * leaving records that never had the field untouched.
 */
export class FieldRemoveCommand implements EditCommand {
  readonly label: string;
  private _snapshot: globalThis.Map<number, unknown> = new globalThis.Map();

  constructor(private readonly opts: FieldRemoveCommandOptions) {
    this.label = `Remove field ${opts.field}`;
  }

  do(): void {
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    this._snapshot.clear();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r && this.opts.field in r) {
        this._snapshot.set(i, r[this.opts.field]);
        delete r[this.opts.field];
      }
    }
  }

  undo(): void {
    const records = this.opts.layer.data?.getRecords?.();
    if (!records) return;
    for (const [i, value] of this._snapshot) {
      const r = records[i];
      if (r) r[this.opts.field] = value;
    }
  }
}
