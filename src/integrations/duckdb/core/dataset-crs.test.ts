import { describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../../arrow/test-utils';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { alignSecondaryDatasetCrs, inheritPrimaryDatasetCrs } from './dataset-crs';

const POLYGON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

const WEB_MERCATOR_WKT = 'PROJCS["Web Mercator",AUTHORITY["EPSG","3857"]]';

describe('alignSecondaryDatasetCrs', () => {
  it('returns the secondary dataset unchanged when both CRS values match', async () => {
    const primary = await datasetFromGeoJSON(POLYGON);
    const secondary = await datasetFromGeoJSON(POLYGON);
    primary.info = { ...primary.info, crs_string: 'EPSG:3857' };
    secondary.info = { ...secondary.info, crs_string: 'EPSG:3857' };

    await expect(alignSecondaryDatasetCrs(primary, secondary)).resolves.toBe(secondary);
  });

  it('projects a working copy to the first input CRS without mutating the secondary input', async () => {
    const primary = await datasetFromGeoJSON(POLYGON);
    const secondary = await datasetFromGeoJSON(POLYGON);
    primary.info = { ...primary.info, crs_string: 'EPSG:3857' };
    secondary.info = { ...secondary.info, crs_string: 'EPSG:4326' };
    const originalX = secondary.arcs?.getVertexData?.().xx[1];

    const aligned = await alignSecondaryDatasetCrs(primary, secondary);

    expect(aligned).not.toBe(secondary);
    expect(aligned.info?.crs_string).toBe('EPSG:3857');
    expect(Math.max(...(aligned.arcs?.getVertexData?.().xx ?? []))).toBeGreaterThan(100_000);
    expect(secondary.info?.crs_string).toBe('EPSG:4326');
    expect(secondary.arcs?.getVertexData?.().xx[1]).toBe(originalX);
  });
});

describe('inheritPrimaryDatasetCrs', () => {
  it.each([
    ['crs_string', { crs_string: 'epsg:3857' }],
    ['prj', { prj: WEB_MERCATOR_WKT }],
    ['wkt1', { wkt1: WEB_MERCATOR_WKT }],
    ['legacy crs', { crs: { projName: 'merc', a: 6378137 } }],
  ] satisfies Array<
    [string, NonNullable<MapshaperDataset['info']>]
  >)('normalizes primary %s metadata without mutating the primary dataset', async (_label, primaryInfo) => {
    const primary = await datasetFromGeoJSON(POLYGON);
    const result = await datasetFromGeoJSON(POLYGON);
    primary.info = primaryInfo;
    result.info = { prj: 'stale', wkt1: 'stale' };

    expect(inheritPrimaryDatasetCrs(result, primary)).toBe(result);
    expect(result.info).toEqual({ crs_string: 'EPSG:3857' });
    expect(primary.info).toEqual(primaryInfo);
  });
});
