// renameFields — bulk-rename multiple attribute fields via mapshaper's
// `-rename-fields`. Mapping order is preserved (object iteration order).
// Both old and new names must be non-empty after trimming and free of
// `,` / `=`.

import { Err } from '../op-result';
import type { RenameFieldsOptions } from '../types';
import { defineLayerOp } from './_define';

export const renameFields = defineLayerOp<RenameFieldsOptions>({
  name: 'renameFields',
  command: 'rename-fields',
  label: (o) => `Rename fields ${o.target}`,
  validate: (o) => {
    if (!o.mapping || typeof o.mapping !== 'object') {
      return Err.validation('mapping', 'must be an object of { oldName: newName }');
    }
    const entries = Object.entries(o.mapping);
    if (entries.length === 0) {
      return Err.validation('mapping', 'must contain at least one rename pair');
    }
    for (const [oldName, newName] of entries) {
      const oldField = (oldName ?? '').trim();
      const newField = (newName ?? '').trim();
      if (oldField.length === 0 || newField.length === 0) {
        return Err.validation('mapping', `field names must be non-empty: ${oldName}=${newName}`);
      }
      if (
        oldField.includes(',') ||
        oldField.includes('=') ||
        newField.includes(',') ||
        newField.includes('=')
      ) {
        return Err.validation(
          'mapping',
          `field names must not contain ',' or '=': ${oldName}=${newName}`,
        );
      }
    }
  },
  options: (o) => ({
    fields: Object.entries(o.mapping).map(
      ([oldName, newName]) => `${oldName.trim()}=${newName.trim()}`,
    ),
  }),
});
