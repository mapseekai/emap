import type { EditCommand } from '../edit-command';
import type { MapshaperLayer } from '../../types/mapshaper-types';

export interface FieldRenameCommandOptions {
  layer: MapshaperLayer;
  from: string;
  to: string;
}

/**
 * Rename a column on every record in a layer. Each record that has the
 * `from` key has its value moved to `to` and the old key dropped. Records
 * without the `from` key are left untouched in both directions.
 */
export class FieldRenameCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: FieldRenameCommandOptions) {
    this.label = `Rename field ${opts.from} → ${opts.to}`;
  }

  do(): void {
    rename(this.opts.layer, this.opts.from, this.opts.to);
  }

  undo(): void {
    rename(this.opts.layer, this.opts.to, this.opts.from);
  }
}

function rename(layer: MapshaperLayer, from: string, to: string): void {
  const records = layer.data?.getRecords?.();
  if (!records) return;
  for (const r of records) {
    if (r && from in r) {
      r[to] = r[from];
      delete r[from];
    }
  }
}
