import { validateRasterWindow } from '../../../domain/raster/policy';
import type { RasterReadRequest, RasterWindow } from '../../../domain/raster/types';
import type { NativeRasterTile } from './native-tiles';

export interface NativeRasterBatch {
  readonly tiles: readonly NativeRasterTile[];
  readonly request: RasterReadRequest;
}
const area = (r: RasterWindow) => (r[2] - r[0]) * (r[3] - r[1]);
const union = (a: RasterWindow, b: RasterWindow): RasterWindow => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

/** Select a small complete rectangle with the largest avoided physical-block
 * footprint. COGs usually favor 2x2 tiles; strips favor a single row. Never read
 * across absent/cached tiles, mix levels, or change individual texture identities.
 * At most four tiles / 8 MiB output, with bounded candidate lookahead. */
export function planNativeRasterBatch(
  candidates: readonly NativeRasterTile[],
): NativeRasterBatch | null {
  const first = candidates[0];
  if (!first) return null;
  const level = first.level,
    samples = Array.from({ length: level.samples }, (_, i) => i);
  const sameLevel = candidates.filter((t) => t.level.id === level.id);
  const extent = sameLevel.reduce((r, t) => union(r, t.core), first.core);
  const blocks = (r: RasterWindow) =>
    (Math.ceil(r[2] / level.tileWidth) - Math.floor(r[0] / level.tileWidth)) *
    (Math.ceil(r[3] / level.tileHeight) - Math.floor(r[1] / level.tileHeight));
  let tiles = [first],
    core = first.core,
    window: RasterWindow = first.window;
  let changed = true;
  while (changed && tiles.length < 4) {
    changed = false;
    let best: {
      tiles: NativeRasterTile[];
      core: RasterWindow;
      window: RasterWindow;
      score: number;
    } | null = null;
    for (const next of sameLevel.slice(0, 24)) {
      if (tiles.includes(next)) continue;
      if (level.tileWidth >= level.width && (next.core[1] !== core[1] || next.core[3] !== core[3]))
        continue;
      const envelope = union(core, next.core);
      if (envelope[2] - envelope[0] > 2048 || envelope[3] - envelope[1] > 2048) continue;
      const members = sameLevel.filter(
        (t) =>
          t.core[0] >= envelope[0] &&
          t.core[1] >= envelope[1] &&
          t.core[2] <= envelope[2] &&
          t.core[3] <= envelope[3],
      );
      if (
        members.length <= tiles.length ||
        members.length > 4 ||
        members.reduce((n, t) => n + area(t.core), 0) !== area(envelope)
      )
        continue;
      const read = members.reduce((r, t) => union(r, t.window), first.window);
      const bytes = area(read) * level.bits.reduce((n, b) => n + b / 8, 0);
      if (bytes > 8 * 1024 ** 2) continue;
      try {
        validateRasterWindow(level, read, samples);
      } catch {
        continue;
      }
      // Equal savings: take an edge-aligned rectangle so a center-first batch
      // does not split the remaining work into two separately decoded fringes.
      const edge =
        Number(envelope[0] === extent[0] || envelope[2] === extent[2]) +
        Number(envelope[1] === extent[1] || envelope[3] === extent[3]);
      const score =
        members.reduce((n, t) => n + blocks(t.window), 0) -
        blocks(read) +
        members.length / 10 +
        edge / 100;
      if (!best || score > best.score)
        best = { tiles: members, core: envelope, window: read, score };
    }
    if (best) {
      tiles = best.tiles;
      core = best.core;
      window = best.window;
      changed = true;
    }
  }
  return { tiles, request: { level: level.id, window, samples } };
}
