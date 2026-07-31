import { describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../arrow/test-utils';
import { alignSecondaryDatasetCrs } from './dataset-crs';

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
