import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { ParsedCommand } from '../../../integrations/mapshaper/adapter';
import type { EmapHostInternal } from '../emap-host';
import { OK } from '../op-result';
import type { FeatureRef } from '../types';
import type { MapshaperDataset, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import type { OpContext, PrepareDatasetCommand } from './_context';
import { mergeSelected } from './merge-selected';

interface PreparedCall {
  sourceId: string;
  commands: ParsedCommand[];
  label: string;
  prepare: PrepareDatasetCommand;
}

function createFixture(
  selection: FeatureRef[],
  geometryType: 'polygon' | 'polyline' | 'point' = 'polygon',
) {
  const records: Record<string, unknown>[] = [
    { name: 'first', value: 10 },
    { name: 'unselected', value: 20 },
    { name: 'chosen', value: 30, 'has,comma': 'preserved' },
  ];
  const layer = {
    name: 'parcels',
    geometry_type: geometryType,
    shapes: [[[0]], [[1]], [[2]]],
    data: {
      getFields: () => ['name', 'value', 'has,comma'],
      getRecords: () => records,
    },
  } as unknown as MapshaperLayer;
  const dataset: MapshaperDataset = { layers: [layer], info: {} };
  const source = {
    getDataset: () => dataset,
    getLayers: () => dataset.layers,
  };
  let preparedCall: PreparedCall | null = null;
  const runDatasetCommandParsed = vi.fn(async () => OK);
  const host = {
    _selection: { getAll: () => selection },
    _sources: new Map([['source', source]]),
    layers: {
      resolve: (sourceId: string, layerId: string) =>
        sourceId === 'source' && layerId === 'parcels' ? layer : null,
    },
  } as unknown as EmapHostInternal;
  const ctx: OpContext = {
    host,
    runDatasetCommandParsed,
    runPreparedDatasetCommandParsed: async (sourceId, commands, label, prepare) => {
      preparedCall = { sourceId, commands, label, prepare };
      return OK;
    },
    runPreparedEditCommand: async () => {
      throw new Error('Direct edit is not used by this fixture');
    },
    runPreparedEditCommandMany: async () => {
      throw new Error('Multi-source edit is not used by this fixture');
    },
    runPreparedDatasetMutation: async () => {
      throw new Error('Dataset mutation is not used by this direct-edit fixture');
    },
  };

  return {
    ctx,
    dataset,
    records,
    runDatasetCommandParsed,
    getPreparedCall: () => preparedCall as PreparedCall | null,
  };
}

function selected(id: number): FeatureRef {
  return { source: 'source', layer: 'parcels', id };
}

function copyFixtureDataset(dataset: MapshaperDataset): MapshaperDataset {
  return {
    ...dataset,
    info: { ...dataset.info },
    layers: dataset.layers.map((layer) => {
      const records = layer.data?.getRecords?.().map((record) => ({ ...record }));
      const fields = layer.data?.getFields?.() ?? [];
      return {
        ...layer,
        shapes: structuredClone(layer.shapes),
        data:
          records === undefined
            ? undefined
            : ({
                getFields: () => [...fields],
                getRecords: () => records,
              } as unknown as MapshaperLayer['data']),
      };
    }),
  };
}

describe('mergeSelected contract', () => {
  it('requires at least two selected features', async () => {
    for (const refs of [[], [selected(0)]]) {
      const fixture = createFixture(refs);
      const result = await mergeSelected(fixture.ctx);
      expect(result.ok).toBe(false);
      expect(fixture.getPreparedCall()).toBeNull();
      expect(fixture.runDatasetCommandParsed).not.toHaveBeenCalled();
    }
  });

  it('rejects an attribute source outside the selection', async () => {
    const fixture = createFixture([selected(0), selected(1)]);
    const result = await mergeSelected(fixture.ctx, { attributeSource: selected(2) });

    expect(result.ok).toBe(false);
    expect(fixture.getPreparedCall()).toBeNull();
  });

  it('isolates selected polygon shapes and clones the chosen record', async () => {
    const fixture = createFixture([selected(0), selected(2)]);
    const originalSnapshot = copyFixtureDataset(fixture.dataset);

    const result = await mergeSelected(fixture.ctx, { attributeSource: selected(2) });
    expect(result.ok).toBe(true);
    const call = fixture.getPreparedCall();
    expect(call).not.toBeNull();
    expect(call?.sourceId).toBe('source');
    expect(call?.label).toBe('Merge 2 features');
    expect(call?.commands.map((command) => command.name)).toEqual([
      'target',
      'dissolve2',
      'target',
      'merge-layers',
    ]);

    call?.prepare(fixture.dataset, originalSnapshot);
    const [unselectedLayer, temporaryLayer] = fixture.dataset.layers;
    expect(unselectedLayer.shapes).toEqual([[[1]]]);
    expect(unselectedLayer.data?.getRecords?.()).toEqual([{ name: 'unselected', value: 20 }]);
    expect(temporaryLayer.shapes).toEqual([[[0]], [[2]]]);
    expect(temporaryLayer.data?.getRecords?.()).toEqual([
      { name: 'chosen', value: 30, 'has,comma': 'preserved' },
      { name: 'chosen', value: 30, 'has,comma': 'preserved' },
    ]);
    expect(originalSnapshot.layers).toHaveLength(1);
    expect(originalSnapshot.layers[0].shapes).toEqual([[[0]], [[1]], [[2]]]);
  });

  it('uses the first selected feature as the default attribute source', async () => {
    const fixture = createFixture([selected(2), selected(0)]);
    await mergeSelected(fixture.ctx);
    const call = fixture.getPreparedCall();
    expect(call).not.toBeNull();

    call?.prepare(fixture.dataset, copyFixtureDataset(fixture.dataset));
    expect(fixture.dataset.layers[1].data?.getRecords?.()).toEqual([
      { name: 'chosen', value: 30, 'has,comma': 'preserved' },
      { name: 'chosen', value: 30, 'has,comma': 'preserved' },
    ]);
  });

  it.each([
    'polyline',
    'point',
  ] as const)('keeps %s merging on ordinary dissolve', async (geometryType) => {
    const fixture = createFixture([selected(0), selected(2)], geometryType);
    await mergeSelected(fixture.ctx);

    expect(fixture.getPreparedCall()?.commands.map((command) => command.name)).toEqual([
      'target',
      'dissolve',
      'target',
      'merge-layers',
    ]);
  });
});

type Position = [number, number];
type Ring = Position[];
type PolygonCoordinates = Ring[];
type ExportedGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };
interface ExportedFeature {
  properties: Record<string, unknown>;
  geometry: ExportedGeometry;
}

function rectangleFeature(
  name: string,
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
  properties: Record<string, unknown> = {},
) {
  return {
    type: 'Feature',
    properties: { name, ...properties },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [xmin, ymin],
          [xmax, ymin],
          [xmax, ymax],
          [xmin, ymax],
          [xmin, ymin],
        ],
      ],
    },
  };
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function geometryArea(geometry: ExportedGeometry): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce(
    (total, polygon) =>
      total +
      ringArea(polygon[0]) -
      polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0),
    0,
  );
}

function exportFeatures(dataset: MapshaperDataset): ExportedFeature[] {
  const output = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' })[0];
  const content = output.content;
  const text =
    typeof content === 'string'
      ? content
      : new TextDecoder().decode(
          content instanceof ArrayBuffer ? new Uint8Array(content) : content,
        );
  const parsed = JSON.parse(text) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('features' in parsed) ||
    !Array.isArray(parsed.features)
  ) {
    throw new Error('Expected a GeoJSON FeatureCollection');
  }
  return parsed.features as ExportedFeature[];
}

async function runRealMerge(
  features: object[],
  selectedIds: number[],
  attributeSourceId = selectedIds[0],
) {
  const adapter = getDefaultMapshaperAdapter();
  let current = await adapter.runImport('-i fixture.geojson', {
    'fixture.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  });
  const before = exportFeatures(current);
  const layerId = current.layers[0].name ?? 'fixture';
  const refs = selectedIds.map((id) => ({ source: 'source', layer: layerId, id }));
  const source = {
    getDataset: () => current,
    getLayers: () => current.layers,
  };
  const host = {
    _selection: { getAll: () => refs },
    _sources: new Map([['source', source]]),
    layers: {
      resolve: (sourceId: string, targetLayerId: string) =>
        sourceId === 'source' && targetLayerId === layerId ? current.layers[0] : null,
    },
  } as unknown as EmapHostInternal;
  const ctx: OpContext = {
    host,
    runDatasetCommandParsed: async (_sourceId, commands) => {
      current = await adapter.runOnDatasetParsed(commands, adapter.copyDataset(current));
      return OK;
    },
    runPreparedDatasetCommandParsed: async (_sourceId, commands, _label, prepare) => {
      const working = adapter.copyDataset(current);
      prepare(working, current);
      current = await adapter.runOnDatasetParsed(commands, working);
      return OK;
    },
    runPreparedEditCommand: async () => {
      throw new Error('Direct edit is not used by this fixture');
    },
    runPreparedEditCommandMany: async () => {
      throw new Error('Multi-source edit is not used by this fixture');
    },
    runPreparedDatasetMutation: async () => {
      throw new Error('Dataset mutation is not used by this fixture');
    },
  };

  const result = await mergeSelected(ctx, {
    attributeSource: { source: 'source', layer: layerId, id: attributeSourceId },
  });
  return { result, before, after: exportFeatures(current) };
}

describe('mergeSelected real polygon geometry', () => {
  it('removes the shared boundary between adjacent polygons', async () => {
    const { result, after } = await runRealMerge(
      [rectangleFeature('A', 0, 0, 1, 1), rectangleFeature('B', 1, 0, 2, 1)],
      [0, 1],
    );

    expect(result.ok).toBe(true);
    expect(after).toHaveLength(1);
    expect(after[0].geometry.type).toBe('Polygon');
    expect(geometryArea(after[0].geometry)).toBe(2);
  });

  it('unions overlaps, preserves contained unselected geometry, and uses chosen attributes', async () => {
    const { result, before, after } = await runRealMerge(
      [
        rectangleFeature('A', 0, 0, 2, 2),
        rectangleFeature('B', 1, 0, 3, 2, { 'has,comma': 'kept' }),
        rectangleFeature('unselected', 1.25, 0.5, 1.75, 1.5),
      ],
      [0, 1],
      1,
    );

    expect(result.ok).toBe(true);
    const merged = after.find((feature) => feature.properties.name === 'B');
    const unselectedBefore = before.find((feature) => feature.properties.name === 'unselected');
    const unselectedAfter = after.find((feature) => feature.properties.name === 'unselected');
    expect(merged).toBeDefined();
    expect(merged?.properties['has,comma']).toBe('kept');
    expect(merged && geometryArea(merged.geometry)).toBe(6);
    expect(unselectedAfter?.geometry).toEqual(unselectedBefore?.geometry);
  });

  it('returns one multipart feature for disconnected polygons', async () => {
    const { result, after } = await runRealMerge(
      [rectangleFeature('A', 0, 0, 1, 1), rectangleFeature('B', 3, 0, 4, 1)],
      [0, 1],
    );

    expect(result.ok).toBe(true);
    expect(after).toHaveLength(1);
    expect(after[0].geometry.type).toBe('MultiPolygon');
    expect(geometryArea(after[0].geometry)).toBe(2);
  });
});
