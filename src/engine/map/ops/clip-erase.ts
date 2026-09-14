// clipLayer / eraseLayer — clip / erase a target polygon layer either
// against a polygon mask layer in the same source OR against a fixed
// rectangular bbox. Uses mapshaper's `-clip` / `-erase` pipelines.
//
// Region selectors (mutually exclusive — caller must supply exactly one):
//   - `mask`: name of a polygon layer in the same source.
//   - `bbox`: `[xmin, ymin, xmax, ymax]` rectangle in source coords.
//
// Optional post-processing flags `cleanup` and `removeSlivers` map
// 1:1 onto mapshaper's `-clip cleanup` / `-clip remove-slivers`.

import { resolveLayerInList } from '../layer-registry';
import { Err } from '../op-result';
import type { ClipEraseOptions } from '../types';
import { defineLayerOp } from './_define';
import { validateBbox } from './_targets';

const defineClipEraseLayer = (op: 'clip' | 'erase') =>
  defineLayerOp<ClipEraseOptions>({
    name: op === 'clip' ? 'clipLayer' : 'eraseLayer',
    command: op,
    label: (o) => `${op === 'clip' ? 'Clip' : 'Erase'} ${o.target}`,
    validate: (o, _layer, dataset) => {
      // Region: exactly one of `mask` or `bbox`.
      const hasMask = typeof o.mask === 'string' && o.mask.length > 0;
      const hasBbox = Array.isArray(o.bbox);
      if (hasMask === hasBbox) {
        return Err.validation(
          hasMask ? 'mask' : 'bbox',
          'must supply exactly one of `mask` or `bbox`',
        );
      }
      if (hasMask) {
        if (!resolveLayerInList(dataset.layers, o.mask!)) return Err.notFound('mask', o.mask!);
      } else {
        const validation = validateBbox(o.bbox);
        if (!validation.ok) return validation;
      }
    },
    options: (o) => {
      const hasMask = typeof o.mask === 'string' && o.mask.length > 0;
      const opOpts: Record<string, unknown> = hasMask ? { source: o.mask! } : { bbox: o.bbox! };
      if (o.cleanup) opOpts.cleanup = true;
      if (o.removeSlivers) opOpts.remove_slivers = true;
      return opOpts;
    },
  });

export const clipLayer = defineClipEraseLayer('clip');
export const eraseLayer = defineClipEraseLayer('erase');
