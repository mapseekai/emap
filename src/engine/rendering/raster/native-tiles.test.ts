import { describe, it, expect } from 'vitest';
import { planNativeRasterTiles } from './native-tiles';
import { AffineTransform } from '../../../domain/geo/transform';
import type { RasterMetadata } from '../../../domain/raster/types';
const metadata: RasterMetadata = {
  filename: 'contract',
  fileSize: 1,
  lastModified: 0,
  crs: 'EPSG:32651',
  origin: [240000, 4400000],
  resolution: [0.5, -0.5],
  bounds: [240000, 4398976, 241024, 4400000],
  noData: 0,
  alphaBand: null,
  bigTiff: false,
  levels: [2048, 1024, 512].map((size, id) => ({
    id,
    width: size,
    height: size,
    tileWidth: 512,
    tileHeight: 512,
    samples: 3,
    bits: [16, 16, 16],
    formats: [1, 1, 1],
    photometric: 1,
    subfileType: id ? 1 : 0,
  })),
};
describe('native raster tile planning', () => {
  it('increases source resolution on zoom and retains stable keys at the same level', () => {
    const v = new AffineTransform(0.5, -0.5, -120000, 2200000),
      far = planNativeRasterTiles(metadata, v, 512, 512, 1);
    v.scale(16, 256, 256);
    const near = planNativeRasterTiles(metadata, v, 512, 512, 1);
    expect(far.level).toBe(2);
    expect(near.level).toBe(0);
    v.translate(1, 0);
    expect(
      planNativeRasterTiles(metadata, v, 512, 512, 1)
        .tiles.map((t) => t.key)
        .sort(),
    ).toEqual(near.tiles.map((t) => t.key).sort());
  });
  it('includes an exact bilinear halo while core tiles stay nonoverlapping and inside the image', () => {
    const p = planNativeRasterTiles(
      metadata,
      new AffineTransform(1, -1, -240000, 4400000),
      1024,
      1024,
      2,
    );
    expect(p.level).toBe(0);
    for (const t of p.tiles) {
      expect(t.window[0]).toBe(Math.max(0, t.core[0] - 1));
      expect(t.window[2]).toBe(Math.min(t.level.width, t.core[2] + 1));
      expect(t.bounds[0]).toBe(240000 + t.core[0] * 0.5);
    }
    for (let i = 0; i < p.tiles.length; i++)
      for (let j = 0; j < i; j++) {
        const a = p.tiles[i].core,
          b = p.tiles[j].core;
        expect(a[0] >= b[2] || a[2] <= b[0] || a[1] >= b[3] || a[3] <= b[1]).toBe(true);
      }
  });
  it('does not fetch off-image content or select a coarser level for higher DPR', () => {
    const v = new AffineTransform(0.8, -0.8, -192000, 3520000);
    const a = planNativeRasterTiles(metadata, v, 512, 512, 1),
      b = planNativeRasterTiles(metadata, v, 512, 512, 2);
    expect(b.level).toBeLessThanOrEqual(a.level);
    v.translate(1e7, 1e7);
    expect(planNativeRasterTiles(metadata, v, 512, 512, 1).tiles).toHaveLength(0);
  });
  it('rejects invalid view dimensions and does not treat geographic envelopes as reprojected pixels', () => {
    expect(() => planNativeRasterTiles(metadata, new AffineTransform(0, 0), 512, 512, 1)).toThrow();
    expect(() =>
      planNativeRasterTiles(metadata, new AffineTransform(1, -1), Infinity, 512, 1),
    ).toThrow();
  });
});
