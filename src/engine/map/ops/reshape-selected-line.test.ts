import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import {
  clipLineBetween,
  collectLineContacts,
  reshapeSelectedPolylines,
} from './reshape-selected-line';

const FIXTURE_NAME = 'selected-polyline-reshape.geojson';

async function importLines(coordinates: unknown[]): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: coordinates.map((line, id) => ({
        type: 'Feature',
        properties: { id },
        geometry: Array.isArray(line)
          ? { type: 'LineString', coordinates: line }
          : (line as GeoJSON.Geometry),
      })),
    }),
  });
}

function exportLineCoordinates(dataset: MapshaperDataset): unknown[] {
  const file = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' })[0]!;
  const collection = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return collection.features
    .filter((feature) => feature.properties?.id !== undefined)
    .map((feature) => {
      if (feature.geometry.type === 'GeometryCollection')
        throw new Error('Unexpected geometry collection in line fixture');
      return feature.geometry.coordinates;
    });
}

function reshape(
  dataset: MapshaperDataset,
  line: Array<[number, number]>,
): Array<{ featureId: number }> {
  const results = reshapeSelectedPolylines(
    dataset,
    0,
    new Set([0]),
    line,
    getDefaultMapshaperAdapter(),
  );
  const shapes = dataset.layers[0]!.shapes!;
  for (const { featureId, shape } of results) shapes.splice(featureId, 1, shape);
  return results;
}

it('clips a line at cumulative distances', () => {
  expect(
    clipLineBetween(
      [
        [3, 0],
        [5, 2],
        [7, 0],
      ],
      0,
      Math.sqrt(8) * 2,
    ),
  ).toEqual([
    [3, 0],
    [5, 2],
    [7, 0],
  ]);
});

it('counts only transverse target-vertex contacts', async () => {
  const dataset = await importLines([
    [
      [0, 1],
      [5, 0],
      [10, 1],
    ],
  ]);
  const part = (dataset.layers[0]!.shapes![0] as number[][])[0]!;
  const adapter = getDefaultMapshaperAdapter();

  expect(
    collectLineContacts(
      part,
      dataset.arcs!,
      [
        [5, -1],
        [5, 2],
      ],
      adapter,
    ),
  ).toMatchObject([{ point: [5, 0] }]);
  expect(
    collectLineContacts(
      part,
      dataset.arcs!,
      [
        [4, -1],
        [5, 0],
        [4, 1],
      ],
      adapter,
    ),
  ).toEqual([]);
});

describe('reshapeSelectedPolylines', () => {
  it('leaves an open line unchanged after one transverse crossing', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [5, 1],
        [5, -1],
      ]),
    ).toEqual([]);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
  });

  it('replaces the segment between two endpoint contacts', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [5, 2],
        [7, 0],
      ]),
    ).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [0, 0],
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
      ],
    ]);
  });

  it('clips a reshape line between two transverse crossings', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, -1],
        [3, 1],
        [7, 1],
        [7, -1],
      ]),
    ).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [0, 0],
        [3, 0],
        [3, 1],
        [7, 1],
        [7, 0],
        [10, 0],
      ],
    ]);
  });

  it('prefers the linear-span candidate when both closed-ring replacements are valid', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [5, 2],
        [7, 0],
      ]),
    ).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
        [3, 0],
      ],
    ]);
  });

  it('reshapes only the contacted part of a multipart line', async () => {
    const dataset = await importLines([
      {
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [10, 0],
          ],
          [
            [0, 10],
            [10, 10],
          ],
        ],
      },
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [5, 2],
        [7, 0],
      ]),
    ).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [
          [0, 0],
          [3, 0],
          [5, 2],
          [7, 0],
          [10, 0],
        ],
        [
          [0, 10],
          [10, 10],
        ],
      ],
    ]);
  });

  it('is independent of reshape-line direction', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [7, 0],
        [5, 2],
        [3, 0],
      ]),
    ).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [0, 0],
        [3, 0],
        [5, 2],
        [7, 0],
        [10, 0],
      ],
    ]);
  });

  it('is independent of selected feature direction', async () => {
    const dataset = await importLines([
      [
        [10, 0],
        [0, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [5, 2],
        [7, 0],
      ]),
    ).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [10, 0],
        [7, 0],
        [5, 2],
        [3, 0],
        [0, 0],
      ],
    ]);
  });

  it('rejects a reshape candidate that self-intersects', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [7, 5],
        [3, 5],
        [7, 0],
      ]),
    ).toEqual([]);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
  });

  it('rolls back a feature when a contacted multipart candidate is invalid', async () => {
    const dataset = await importLines([
      {
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [10, 0],
          ],
          [
            [0, 10],
            [10, 10],
          ],
        ],
      },
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [5, 2],
        [7, 0],
        [7, 10],
        [3, 15],
        [7, 15],
        [3, 10],
      ]),
    ).toEqual([]);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [
          [0, 0],
          [10, 0],
        ],
        [
          [0, 10],
          [10, 10],
        ],
      ],
    ]);
  });

  it('preserves intermediate contacts as reshape arc vertices', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [4, 1],
        [5, -1],
        [6, 1],
        [7, 0],
      ]),
    ).toHaveLength(1);
    const coordinates = exportLineCoordinates(dataset) as [number, number][][];
    expect(coordinates[0]!.map((point) => point[0])).toEqual([0, 3, 4, 4.5, 5, 5.5, 6, 7, 10]);
    expect(coordinates[0]![3]![1]).toBeCloseTo(0);
    expect(coordinates[0]![5]![1]).toBeCloseTo(0);
  });

  it('leaves a feature unchanged when the clipped reshape segment is degenerate', async () => {
    const dataset = await importLines([
      [
        [0, 0],
        [10, 0],
      ],
    ]);

    expect(
      reshape(dataset, [
        [3, 0],
        [3, 0],
        [3, 0],
      ]),
    ).toEqual([]);
    expect(exportLineCoordinates(dataset)).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
  });
});
