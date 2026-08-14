// renameLayer — rename one layer in a source dataset via mapshaper's
// `-rename-layers`. The new name is trimmed and validated for
// non-emptiness and absence of collision with any other existing layer
// in the same dataset.

import { Err } from '../op-result';
import type { RenameLayerOptions } from '../types';
import { defineLayerOp } from './_define';

export const renameLayer = defineLayerOp<RenameLayerOptions>({
  name: 'renameLayer',
  command: 'rename-layers',
  label: (o) => `Rename ${o.target} → ${(o.name ?? '').trim()}`,
  validate: (o, _layer, dataset) => {
    const newName = (o.name ?? '').trim();
    if (newName.length === 0) return Err.validation('name', 'must be a non-empty string');
    // mapshaper's -rename-layers DEFAULT is `names` (comma-list). A name
    // containing `,` would silently split into N rename pairs.
    if (newName.includes(',')) return Err.validation('name', 'must not contain `,`');
    // Allow renaming to the same name (no-op-ish), but reject if another
    // layer in this dataset already owns it.
    if (newName !== o.target) {
      const collision = dataset.layers.some((l) => (l?.name ?? '') === newName);
      if (collision) return Err.validation('name', `another layer already named '${newName}'`);
    }
  },
  options: (o) => ({ names: [(o.name ?? '').trim()] }),
});
