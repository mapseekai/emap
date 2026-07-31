import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import {
  normalizeProjectCrsMetadata,
  resolveDatasetCRS,
  resolveProjectCrs,
  setDatasetCrsMetadata,
} from '../geo/crs-resolver';
import type { MapshaperDataset } from '../types/mapshaper-types';

/**
 * Return `secondary` in the first input's CRS without mutating either caller-owned dataset.
 * Equal CRS inputs keep the original reference; mismatched inputs project a working copy.
 */
export async function alignSecondaryDatasetCrs(
  primary: MapshaperDataset,
  secondary: MapshaperDataset,
): Promise<MapshaperDataset> {
  const primaryCrs = resolveDatasetCRS(primary);
  const secondaryCrs = resolveDatasetCRS(secondary);
  const [resolvedPrimary, resolvedSecondary] = await Promise.all([
    resolveProjectCrs(primaryCrs),
    resolveProjectCrs(secondaryCrs),
  ]);
  if (resolvedPrimary === resolvedSecondary) return secondary;

  const adapter = getDefaultMapshaperAdapter();
  const working = adapter.copyDataset(secondary);
  if (secondary.info) {
    working.info = {
      ...secondary.info,
      ...(secondary.info.crs ? { crs: { ...secondary.info.crs } } : {}),
    };
  }
  working.arcs?.setRetainedInterval?.(0);
  const result = await adapter.runOnDataset(`-proj ${resolvedPrimary}`, working);
  setDatasetCrsMetadata(result, normalizeProjectCrsMetadata(primaryCrs) ?? primaryCrs);
  return result;
}
