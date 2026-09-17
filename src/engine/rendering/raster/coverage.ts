import type { RasterWindow } from '../../../domain/raster/types';

/** Disjoint, map-coordinate ownership. A transparent tile owns its rectangle too. */
export interface RasterPatch {
  readonly key: string;
  readonly bounds: RasterWindow;
}

export function intersectCoverage(a: RasterWindow, b: RasterWindow): RasterWindow | null {
  const left = Math.max(a[0], b[0]),
    bottom = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]),
    top = Math.min(a[3], b[3]);
  return left < right && bottom < top ? [left, bottom, right, top] : null;
}
function subtract(bounds: RasterWindow, cover: RasterWindow): RasterWindow[] {
  const cut = intersectCoverage(bounds, cover);
  if (!cut) return [bounds];
  const out: RasterWindow[] = [];
  if (bounds[1] < cut[1]) out.push([bounds[0], bounds[1], bounds[2], cut[1]]);
  if (cut[3] < bounds[3]) out.push([bounds[0], cut[3], bounds[2], bounds[3]]);
  if (bounds[0] < cut[0]) out.push([bounds[0], cut[1], cut[0], cut[3]]);
  if (cut[2] < bounds[2]) out.push([cut[2], cut[1], bounds[2], cut[3]]);
  return out;
}
/** Replace only this rectangle; never draw old samples underneath a new alpha pixel. */
export function replaceCoverage(
  patches: readonly RasterPatch[],
  key: string,
  bounds: RasterWindow,
): RasterPatch[] {
  const out: RasterPatch[] = [];
  for (const patch of patches)
    for (const remainder of subtract(patch.bounds, bounds))
      out.push({ key: patch.key, bounds: remainder });
  out.push({ key, bounds });
  return out;
}
/** Cached parents may fill missing regions, but cannot overwrite already resolved coverage. */
export function fillCoverage(
  patches: readonly RasterPatch[],
  key: string,
  bounds: RasterWindow,
): RasterPatch[] {
  let remaining: RasterWindow[] = [bounds];
  for (const patch of patches) {
    remaining = remaining.flatMap((region) => subtract(region, patch.bounds));
    if (!remaining.length) break;
  }
  return [...patches, ...remaining.map((bounds) => ({ key, bounds }))];
}
export function clipCoverage(patches: readonly RasterPatch[], bounds: RasterWindow): RasterPatch[] {
  const out: RasterPatch[] = [];
  for (const patch of patches) {
    const clipped = intersectCoverage(patch.bounds, bounds);
    if (clipped) out.push({ key: patch.key, bounds: clipped });
  }
  return out;
}
