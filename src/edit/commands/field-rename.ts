import type { EditCommand } from '../edit-command';
import {
  bumpAttributeVersion,
  type MapshaperDataset,
  type MapshaperLayer,
} from '../../types/mapshaper-types';

export interface FieldRenameCommandOptions {
  layer: MapshaperLayer;
  from: string;
  to: string;
  dataset: MapshaperDataset;
}

/**
 * Rename a column on every record in a layer. Each record that has the
 * `from` key has its value moved to `to` and the old key dropped. Records
 * without the `from` key are left untouched in both directions.
 */
export class FieldRenameCommand implements EditCommand {
  readonly label: string;
  private _renamedIndices: number[] = [];
  private _previousFields: MapshaperLayer['fields'];

  constructor(private readonly opts: FieldRenameCommandOptions) {
    this.label = `Rename field ${opts.from} → ${opts.to}`;
  }

  do(): void {
    this._previousFields = this.opts.layer.fields;
    if (this._previousFields) {
      this.opts.layer.fields = this._previousFields.map((field) =>
        field.name === this.opts.from ? { ...field, name: this.opts.to } : field,
      );
    }
    this._renamedIndices = rename(this.opts.layer, this.opts.from, this.opts.to);
    bumpAttributeVersion(this.opts.dataset);
  }

  undo(): void {
    this.opts.layer.fields = this._previousFields;
    rename(this.opts.layer, this.opts.to, this.opts.from, this._renamedIndices);
    bumpAttributeVersion(this.opts.dataset);
  }
}

function rename(
  layer: MapshaperLayer,
  from: string,
  to: string,
  indices?: readonly number[],
): number[] {
  const records = layer.data?.getRecords?.();
  const changed: number[] = [];
  if (!records || from === to) return changed;
  const count = indices?.length ?? records.length;
  for (let k = 0; k < count; k++) {
    const i = indices ? indices[k] : k;
    const r = records[i];
    if (r && Object.hasOwn(r, from)) {
      Object.defineProperty(r, to, {
        value: r[from],
        writable: true,
        enumerable: true,
        configurable: true,
      });
      delete r[from];
      changed.push(i);
    }
  }
  return changed;
}
