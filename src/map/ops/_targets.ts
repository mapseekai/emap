import { resolveLayerInList } from '../layer-registry';
import { Err, okValue, type OpResult } from '../op-result';
import type { MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';

export function resolveCommaTargets(
  dataset: MapshaperDataset,
  targets: readonly string[],
): OpResult<{ targetList: string; layers: MapshaperLayer[] }> {
  for (const target of targets) {
    if (typeof target !== 'string' || target.includes(',')) {
      return Err.validation('targets', `target name must not contain ',': ${String(target)}`);
    }
  }

  const layers: MapshaperLayer[] = [];
  for (const target of targets) {
    const layer = resolveLayerInList(dataset.layers, target);
    if (!layer) return Err.notFound('layer', target);
    layers.push(layer);
  }
  return okValue({ targetList: targets.join(','), layers });
}

export function validateBbox(bbox: unknown): OpResult {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  ) {
    return Err.validation('bbox', 'must be [xmin, ymin, xmax, ymax] of finite numbers');
  }
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    return Err.validation('bbox', 'must satisfy xmin<xmax and ymin<ymax');
  }
  return okValue(undefined);
}
