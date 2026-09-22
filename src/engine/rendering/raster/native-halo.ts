import { groundBounds } from '../../../domain/geo/perspective-transform';
import { AffineTransform } from '../../../domain/geo/transform';
import type { RasterMetadata, RasterWindow } from '../../../domain/raster/types';
import { intersectCoverage } from './coverage';
import type { NativeRasterTile } from './native-tiles';
import { planNativeRasterBatch, type NativeRasterBatch } from './native-batches';

export interface NativeHaloPlan {
  readonly reads: readonly NativeRasterTile[];
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
}

/** Only require neighbor cores whose pixels may be sampled in the actual view.
 * A full offscreen ring would waste both CPU and GPU memory at deep zoom.
 * Keep one conservative source-pixel margin; integer texture copies retain all
 * original values, including NoData. No recursive halo dependencies. */
export function planNativeHalo(
  metadata: RasterMetadata,
  visible: readonly NativeRasterTile[],
  view: AffineTransform,
  width: number,
  height: number,
): NativeHaloPlan {
  const dependencies = new Map<string, string[]>(),
    tiles = new Map(visible.map((t) => [t.key, t]));
  if (!visible.length) return { reads: [], dependencies };
  const level = visible[0].level,
    base = metadata.levels[0];
  const tw = Math.max(512, Math.min(1024, level.tileWidth));
  const th = Math.max(512, Math.min(1024, level.tileHeight));
  const pixels = new AffineTransform(
    (metadata.resolution[0] * base.width) / level.width,
    (metadata.resolution[1] * base.height) / level.height,
    ...metadata.origin,
  );
  const footprint = groundBounds(view, width, height);
  const p = pixels.unproject(footprint[0], footprint[3]),
    q = pixels.unproject(footprint[2], footprint[1]);
  const sampled: RasterWindow = [
    Math.max(0, Math.floor(p[0]) - 1),
    Math.max(0, Math.floor(p[1]) - 1),
    Math.min(level.width, Math.ceil(q[0]) + 1),
    Math.min(level.height, Math.ceil(q[1]) + 1),
  ];
  for (const tile of visible) {
    const deps: string[] = [],
      cx = Math.floor(tile.core[0] / tw),
      cy = Math.floor(tile.core[1] / th);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx,
          y = cy + dy;
        if (x < 0 || y < 0 || x * tw >= level.width || y * th >= level.height) continue;
        const core: RasterWindow = [
          x * tw,
          y * th,
          Math.min((x + 1) * tw, level.width),
          Math.min((y + 1) * th, level.height),
        ];
        const overlap = intersectCoverage(core, tile.window);
        if (!overlap || !intersectCoverage(overlap, sampled)) continue;
        const key = `${level.id}:${x}:${y}`;
        deps.push(key);
        if (!tiles.has(key)) {
          const low = pixels.project(core[0], core[3]),
            high = pixels.project(core[2], core[1]);
          tiles.set(key, {
            key,
            level,
            core,
            window: [
              Math.max(0, core[0] - 1),
              Math.max(0, core[1] - 1),
              Math.min(level.width, core[2] + 1),
              Math.min(level.height, core[3] + 1),
            ],
            bounds: [low[0], low[1], high[0], high[1]],
          });
        }
      }
    dependencies.set(tile.key, deps);
  }
  return { reads: [...tiles.values()], dependencies };
}

/** Use existing bounded batching with core-only read footprints. Packed RGBA
 * output gets its own byte check instead of assuming the source has four bands. */
export function planPackedRasterBatch(
  candidates: readonly NativeRasterTile[],
  coreOnly: boolean,
): NativeRasterBatch | null {
  let input = candidates.map((t) => (coreOnly ? { ...t, window: t.core } : t));
  for (let attempt = 0; attempt < 4; attempt++) {
    const batch = planNativeRasterBatch(input);
    if (!batch) return null;
    const w = batch.request.window;
    if (((w[2] - w[0]) * (w[3] - w[1]) * 4 * batch.tiles[0].level.bits[0]) / 8 <= 8 * 1024 ** 2)
      return {
        request: batch.request,
        tiles: batch.tiles.map((t) => candidates.find((c) => c.key === t.key)!),
      };
    const last = batch.tiles.at(-1)!;
    input = input.filter((t) => t.key !== last.key);
  }
  return null;
}
