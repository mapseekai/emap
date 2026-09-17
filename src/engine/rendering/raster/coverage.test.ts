import { describe, expect, it } from 'vitest';
import { replaceCoverage, fillCoverage, clipCoverage, intersectCoverage } from './coverage';
import type { RasterWindow } from '../../../domain/raster/types';

const area = (b: RasterWindow) => (b[2] - b[0]) * (b[3] - b[1]);
describe('progressive raster coverage', () => {
  it('replaces only the ready rectangle and leaves nonoverlapping old coverage around it', () => {
    const result = replaceCoverage(
      [{ key: 'old', bounds: [0, 0, 100, 100] }],
      'new',
      [20, 30, 60, 70],
    );
    expect(result.filter((p) => p.key === 'new')).toEqual([
      { key: 'new', bounds: [20, 30, 60, 70] },
    ]);
    expect(result.reduce((n, p) => n + area(p.bounds), 0)).toBe(10000);
    for (let i = 0; i < result.length; i++)
      for (let j = i + 1; j < result.length; j++)
        expect(intersectCoverage(result[i].bounds, result[j].bounds)).toBeNull();
  });
  it('treats a completed transparent tile as coverage, not missing data', () => {
    const result = fillCoverage(
      [{ key: 'nodata', bounds: [0, 0, 50, 100] }],
      'parent',
      [0, 0, 100, 100],
    );
    expect(result).toEqual([
      { key: 'nodata', bounds: [0, 0, 50, 100] },
      { key: 'parent', bounds: [50, 0, 100, 100] },
    ]);
  });
  it('supports non-nested old/new resolutions and opposite zoom directions', () => {
    let patches = [{ key: 'old', bounds: [0, 0, 100, 100] as RasterWindow }];
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        patches = replaceCoverage(patches, `${x}/${y}`, [
          x * 25,
          y * 25,
          (x + 1) * 25,
          (y + 1) * 25,
        ]);
    expect(patches).toHaveLength(16);
    patches = replaceCoverage(patches, 'coarse', [0, 0, 100, 100]);
    expect(patches).toEqual([{ key: 'coarse', bounds: [0, 0, 100, 100] }]);
  });
  it('clips a frozen partial presentation without exposing old pixels under ready tiles', () => {
    const partial = replaceCoverage(
      [{ key: 'old', bounds: [0, 0, 100, 100] }],
      'ready',
      [0, 0, 60, 100],
    );
    const result = clipCoverage(partial, [40, 20, 80, 90]);
    expect(result.reduce((n, p) => n + area(p.bounds), 0)).toBe(2800);
    expect(result.find((p) => p.key === 'ready')?.bounds).toEqual([40, 20, 60, 90]);
  });
});
