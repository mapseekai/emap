import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';
import { groupPolygonRings } from './group-polygon-rings';
import { datasetFromGeoJSON } from '../../../test/utils/arrow';

function square(cx: number, cy: number, r: number): number[][] {
  // counterclockwise (GeoJSON shell convention; mapshaper normalizes on import)
  return [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
    [cx - r, cy - r],
  ];
}

describe('groupPolygonRings', () => {
  it('keeps holes with their containing shell', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [square(0, 0, 10), square(0, 0, 2).reverse()],
      },
    });
    const adapter = getDefaultMapshaperAdapter();
    const layer = dataset.layers[0];
    const exported = adapter.exportPathData(
      layer.shapes![0] as number[][],
      dataset.arcs!,
      'polygon',
    );
    const groups = groupPolygonRings(exported.pathData, dataset.arcs!, adapter);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0].area).toBeGreaterThan(0);
    expect(groups[0][1].area).toBeLessThan(0);
  });

  it('assigns each hole to the smallest enclosing shell (island-in-hole)', async () => {
    // big shell with hole; island inside the hole; hole inside the island
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [square(0, 0, 10), square(0, 0, 6).reverse()],
          [square(0, 0, 4), square(0, 0, 1).reverse()],
        ],
      },
    });
    const adapter = getDefaultMapshaperAdapter();
    const layer = dataset.layers[0];
    const exported = adapter.exportPathData(
      layer.shapes![0] as number[][],
      dataset.arcs!,
      'polygon',
    );
    expect(exported.pathData).toHaveLength(4);
    const groups = groupPolygonRings(exported.pathData, dataset.arcs!, adapter);
    expect(groups).toHaveLength(2);
    // each shell got exactly its own hole, not the other's
    for (const group of groups) {
      expect(group).toHaveLength(2);
      const shellArea = group[0].area!;
      const holeArea = -group[1].area!;
      expect(holeArea).toBeLessThan(shellArea);
    }
  });

  it('handles disjoint shells without holes', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[square(0, 0, 1)], [square(10, 10, 1)]],
      },
    });
    const adapter = getDefaultMapshaperAdapter();
    const exported = adapter.exportPathData(
      dataset.layers[0].shapes![0] as number[][],
      dataset.arcs!,
      'polygon',
    );
    const groups = groupPolygonRings(exported.pathData, dataset.arcs!, adapter);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });
});
