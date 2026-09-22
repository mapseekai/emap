import { describe, it, expect } from 'vitest';
import { AffineTransform } from '../../../domain/geo/transform';
import type { RasterMetadata } from '../../../domain/raster/types';
import { planNativeRasterTiles } from './native-tiles';
import { planNativeHalo, planPackedRasterBatch } from './native-halo';
const m: RasterMetadata = {
  filename: 'contract',
  fileSize: 1,
  lastModified: 0,
  crs: 'EPSG:4326',
  origin: [0, 2048],
  resolution: [1, -1],
  bounds: [0, 0, 2048, 2048],
  noData: null,
  alphaBand: null,
  bigTiff: false,
  levels: [
    {
      id: 0,
      width: 2048,
      height: 2048,
      tileWidth: 512,
      tileHeight: 512,
      samples: 3,
      bits: [16, 16, 16],
      formats: [1, 1, 1],
      photometric: 2,
      subfileType: 0,
      decodedBlockConcurrency: 4,
    },
  ],
};
describe('source core and halo dependency planning', () => {
  it('does not fetch a full neighbor ring when the view lies inside one core', () => {
    const v = new AffineTransform(1, -1, -100, 1948),
      tiles = planNativeRasterTiles(m, v, 100, 100, 1).tiles;
    const plan = planNativeHalo(m, tiles, v, 100, 100);
    expect(plan.reads).toHaveLength(1);
    expect(plan.dependencies.get(tiles[0].key)).toEqual([]);
  });
  it('shares each visible core and does not recursively require neighbor halos', () => {
    const v = new AffineTransform(1, -1, -300, 1748),
      tiles = planNativeRasterTiles(m, v, 1000, 1000, 1).tiles;
    const plan = planNativeHalo(m, tiles, v, 1000, 1000);
    expect(plan.reads).toHaveLength(9);
    expect(new Set(plan.reads.map((t) => t.key)).size).toBe(9);
    expect(plan.dependencies.get('0:1:1')).toHaveLength(8);
  });
  it('adds only a bounded sampling fringe at an exact view boundary', () => {
    const v = new AffineTransform(1, -1, -512, 1536),
      tiles = planNativeRasterTiles(m, v, 100, 100, 1).tiles;
    const plan = planNativeHalo(m, tiles, v, 100, 100);
    expect(plan.reads).toHaveLength(4);
    expect(plan.dependencies.get('0:1:1')).toHaveLength(3);
  });
  it('clamps image edges and batches cores without overlapping halo reads', () => {
    const v = new AffineTransform(1, -1, 0, 2048),
      tiles = planNativeRasterTiles(m, v, 2048, 2048, 1).tiles;
    const plan = planNativeHalo(m, tiles, v, 2048, 2048);
    expect(plan.reads).toHaveLength(16);
    const batch = planPackedRasterBatch(plan.reads, true)!;
    const w = batch.request.window;
    expect(w[0] % 512).toBe(0);
    expect(w[1] % 512).toBe(0);
    expect((w[2] - w[0]) * (w[3] - w[1]) * 8).toBeLessThanOrEqual(8 * 1024 ** 2);
    expect(batch.tiles.every((t) => t.window[0] <= t.core[0])).toBe(true);
  });
});
