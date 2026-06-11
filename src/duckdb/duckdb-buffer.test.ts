import { describe, expect, it } from 'vitest';
import { datasetFromGeoJSON } from '../formats/test-utils';
import { DuckDbOperationError } from './duckdb-errors';
import { normalizeDuckDbBufferOptions } from './duckdb-buffer';
import { buildBufferSql } from './duckdb-sql';

const POLYGON_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

async function polygonDataset(crs?: string) {
  const dataset = await datasetFromGeoJSON(POLYGON_FC);
  if (crs) dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}

describe('DuckDB buffer operation validation', () => {
  it('rejects non-positive buffer distance', async () => {
    const dataset = await polygonDataset('EPSG:3857');

    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: 0 })).toThrow(DuckDbOperationError);
    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: -1 })).toThrow(/greater than zero/);
  });

  it('rejects non-finite buffer distance', async () => {
    const dataset = await polygonDataset('EPSG:3857');

    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: Number.POSITIVE_INFINITY })).toThrow(
      DuckDbOperationError,
    );
    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: Number.NaN })).toThrow(/finite number/);
  });

  it('rejects geographic CRS by default', async () => {
    const dataset = await polygonDataset('EPSG:4326');

    expect(() => normalizeDuckDbBufferOptions(dataset, { distance: 25 })).toThrow(
      /reproject to a projected CRS/,
    );
  });

  it('allows geographic CRS when failOnGeographicCrs is false', async () => {
    const dataset = await polygonDataset('OGC:CRS84');

    expect(normalizeDuckDbBufferOptions(dataset, { distance: 25, failOnGeographicCrs: false })).toMatchObject({
      distance: 25,
      failOnGeographicCrs: false,
      geometryColumn: 'geometry',
    });
  });

  it('builds WKB buffer SQL using the geometry column and distance', () => {
    expect(buildBufferSql({ tableName: 'input', geometryColumn: 'geom"name', distance: 25 })).toBe(
      [
        'SELECT',
        '  * EXCLUDE ("geom""name"),',
        '  ST_AsWKB(ST_Buffer(ST_GeomFromWKB("geom""name"), 25)) AS "geom""name"',
        'FROM "input"',
        'WHERE "geom""name" IS NOT NULL',
      ].join('\n'),
    );
  });
});
