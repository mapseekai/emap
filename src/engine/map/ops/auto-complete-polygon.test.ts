import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { MapshaperDataset, PathShape } from '../../../shared/types/mapshaper-types';
import type { EmapHostInternal } from '../emap-host';
import { MapshaperOps } from '../mapshaper-ops';
import { Selection } from '../selection';
import type { EditCommand } from '../../../domain/edit/edit-command';
import { autoCompletePolygon } from './auto-complete-polygon';
import { shapeSegments, shoelaceArea, unsignedArcId } from './geometry-2d';

const adapter = getDefaultMapshaperAdapter();
const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const sketch: [number, number][] = [
  [8, 2],
  [14, 2],
  [14, 8],
  [8, 8],
];

async function fixture(polygons: number[][][][] = [[square]]) {
  let dataset = await adapter.runImport('-i input.geojson', {
    'input.geojson': JSON.stringify({
      type: 'FeatureCollection',
      features: polygons.map((coordinates, id) => ({
        type: 'Feature',
        properties: { name: `original-${id}` },
        geometry: { type: 'Polygon', coordinates },
      })),
    }),
  });
  const source = {
    getDataset: () => dataset,
    getArcs: () => dataset.arcs,
    getLayers: () => dataset.layers,
    setDataset: (next: MapshaperDataset) => {
      dataset = next;
    },
    fire: vi.fn(),
  };
  const selection = new Selection();
  selection.apply([{ source: 'source', layer: 'input', id: 0 }], 'replace');
  const entries: EditCommand[] = [];
  const host = {
    _sources: new Map([['source', source]]),
    _selection: selection,
    _activeTransaction: null,
    _removed: false,
    _history: { push: (entry: EditCommand) => entries.push(entry), isCapturing: () => false },
    _invalidateShapeCachesForSources: vi.fn(),
    _scheduleRender: vi.fn(),
    _fireHistoryChange: vi.fn(),
    _fireSelectionChange: vi.fn(),
    fire: vi.fn(),
  } as unknown as EmapHostInternal;
  return { ops: new MapshaperOps(host), source, selection, entries };
}

function area(dataset: MapshaperDataset, id: number): number {
  const shape = dataset.layers[0]!.shapes![id] as PathShape;
  return Math.abs(
    shape.reduce(
      (sum, ring) =>
        sum + shoelaceArea(shapeSegments([ring], dataset.arcs!).map(([start]) => start)),
      0,
    ),
  );
}

describe('autoCompletePolygon', () => {
  it('cuts only nearby geometry and keeps distant features and live dataset identity', async () => {
    const far = Array.from({ length: 500 }, (_, i) => [
      square.map(([x, y]) => [x + 1000 + i * 20, y + 1000]),
    ]);
    const f = await fixture([[square], ...far]);
    const original = f.source.getDataset();
    const distantShape = original.layers[0]!.shapes![500];
    const copy = vi.spyOn(adapter, 'copyDataset');
    const cut = adapter.addIntersectionCuts.bind(adapter);
    const vertexCounts: number[] = [];
    const cuts = vi.spyOn(adapter, 'addIntersectionCuts').mockImplementation((dataset, options) => {
      vertexCounts.push(dataset.arcs!.getPointCount!());
      cut(dataset, options);
    });
    try {
      const result = await f.ops.autoCompletePolygon({ line: sketch });
      expect(result).toMatchObject({ ok: true, value: { createdCount: 1 } });
      expect(vertexCounts.length).toBeGreaterThan(0);
      expect(Math.max(...vertexCounts)).toBeLessThan(30);
      expect(copy).not.toHaveBeenCalled();
      expect(f.source.getDataset()).toBe(original);
      expect(original.layers[0]!.shapes![500]).toBe(distantShape);
      expect(area(original, 501)).toBeCloseTo(24);
      f.entries[0]!.undo();
      expect(original.layers[0]!.shapes).toHaveLength(501);
      expect(original.layers[0]!.shapes![500]).toBe(distantShape);
      f.entries[0]!.do();
      expect(area(original, 501)).toBeCloseTo(24);
    } finally {
      copy.mockRestore();
      cuts.mockRestore();
    }
  });

  it('creates an adjoining feature sharing arcs, preserves originals, and supports undo/redo', async () => {
    expect(autoCompletePolygon).toBeTypeOf('function');
    const f = await fixture();
    const original = f.source.getDataset();
    const beforeArea = area(original, 0);
    const refs = f.selection.getAll();
    const result = await f.ops.autoCompletePolygon({ line: sketch });
    expect(result).toMatchObject({ ok: true, value: { createdCount: 1 } });
    const after = f.source.getDataset();
    const layer = after.layers[0]!;
    expect(layer.shapes).toHaveLength(2);
    expect(area(after, 0)).toBeCloseTo(beforeArea);
    expect(area(after, 1)).toBeCloseTo(24);
    expect(adapter.testPointInPolygon(12, 5, layer.shapes![1] as PathShape, after.arcs!)).toBe(
      true,
    );
    expect(adapter.testPointInPolygon(9, 5, layer.shapes![1] as PathShape, after.arcs!)).toBe(
      false,
    );
    const boundary = new Set((layer.shapes![0] as PathShape).flat());
    expect((layer.shapes![1] as PathShape).flat().some((id) => boundary.has(~id))).toBe(true);
    expect(layer.data!.getRecords?.()).toEqual([{ name: 'original-0' }, {}]);
    expect(f.selection.getAll()).toEqual(refs);
    expect(f.entries).toHaveLength(1);
    f.entries[0]!.undo();
    expect(f.source.getDataset()).toBe(original);
    expect(f.selection.getAll()).toEqual(refs);
    f.entries[0]!.do();
    expect(f.source.getDataset()).toBe(after);
    expect(after.layers[0]!.shapes).toHaveLength(2);
  });

  it('retains islands outside the sketch bounds when closing a concave boundary', async () => {
    const u = [
      [0, 0],
      [10, 0],
      [10, 10],
      [8, 10],
      [8, 2],
      [2, 2],
      [2, 10],
      [0, 10],
      [0, 0],
    ];
    const island = [
      [4, 4],
      [5, 4],
      [5, 5],
      [4, 5],
      [4, 4],
    ];
    const f = await fixture([[u], [island]]);
    await expect(
      f.ops.autoCompletePolygon({
        line: [
          [1, 9],
          [9, 9],
        ],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { createdCount: 1 },
    });
    expect(area(f.source.getDataset(), 2)).toBeCloseTo(41);
  });

  it('can close a boundary connected beyond the immediately contacted features', async () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ];
    const f = await fixture([
      rect(0, 0, 10, 2),
      rect(0, 2, 2, 8),
      rect(0, 8, 2, 10),
      rect(8, 2, 10, 8),
      rect(8, 8, 10, 10),
    ]);
    await expect(
      f.ops.autoCompletePolygon({
        line: [
          [1, 9],
          [9, 9],
        ],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { createdCount: 1 },
    });
    expect(area(f.source.getDataset(), 5)).toBeCloseTo(42);
  });

  it('does not return a partial result when another face uses more distant boundaries', async () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ];
    const f = await fixture([
      rect(-4, 8, -2, 10),
      rect(0, 0, 10, 2),
      rect(0, 2, 2, 8),
      rect(0, 8, 2, 10),
      rect(8, 2, 10, 8),
      rect(8, 8, 10, 10),
    ]);
    await expect(
      f.ops.autoCompletePolygon({
        line: [
          [-3, 8.5],
          [-1, 8.5],
          [-1, 9.5],
          [-3, 9.5],
          [-3, 11],
          [1, 11],
          [1, 9],
          [9, 9],
        ],
      }),
    ).resolves.toMatchObject({ ok: true, value: { createdCount: 2 } });
  });

  it('completes against curved boundaries and more than one existing feature', async () => {
    const left = [
      [0, 0],
      [10, 0],
      [11, 2],
      [10, 5],
      [0, 5],
      [0, 0],
    ];
    const top = [
      [0, 5],
      [10, 5],
      [12, 7],
      [10, 10],
      [0, 10],
      [0, 5],
    ];
    const f = await fixture([[left], [top]]);
    const beforeAreas = [area(f.source.getDataset(), 0), area(f.source.getDataset(), 1)];
    await expect(
      f.ops.autoCompletePolygon({
        line: [
          [8, 1],
          [15, 1],
          [15, 9],
          [8, 9],
        ],
      }),
    ).resolves.toMatchObject({ ok: true, value: { createdCount: 1 } });
    const dataset = f.source.getDataset();
    expect(area(dataset, 0)).toBeCloseTo(beforeAreas[0]!);
    expect(area(dataset, 1)).toBeCloseTo(beforeAreas[1]!);
    const appended = new Set(
      (dataset.layers[0]!.shapes![2] as PathShape).flat().map(unsignedArcId),
    );
    for (const id of [0, 1])
      expect(
        (dataset.layers[0]!.shapes![id] as PathShape)
          .flat()
          .some((arc) => appended.has(unsignedArcId(arc))),
      ).toBe(true);
  });

  it('allows endpoints on the boundary without extending into the existing polygon', async () => {
    const f = await fixture();
    await expect(
      f.ops.autoCompletePolygon({
        line: [
          [10, 2],
          [14, 2],
          [14, 8],
          [10, 8],
        ],
      }),
    ).resolves.toMatchObject({ ok: true, value: { createdCount: 1 } });
  });

  it('preserves existing holes and islands inside a newly enclosed region', async () => {
    const hole = [
      [2, 2],
      [2, 8],
      [8, 8],
      [8, 2],
      [2, 2],
    ];
    const island = [
      [11, 4],
      [12, 4],
      [12, 6],
      [11, 6],
      [11, 4],
    ];
    const f = await fixture([[square, hole], [island]]);
    await expect(f.ops.autoCompletePolygon({ line: sketch })).resolves.toMatchObject({
      ok: true,
      value: { createdCount: 1 },
    });
    const dataset = f.source.getDataset();
    expect(area(dataset, 0)).toBeCloseTo(64);
    expect(area(dataset, 1)).toBeCloseTo(2);
    expect(area(dataset, 2)).toBeCloseTo(22);
    const added = dataset.layers[0]!.shapes![2] as PathShape;
    expect(adapter.testPointInPolygon(11.5, 5, added, dataset.arcs!)).toBe(false);
    expect(adapter.testPointInPolygon(5, 5, added, dataset.arcs!)).toBe(false);
  });

  it('creates each new enclosed face when one sketch leaves and re-enters the layer', async () => {
    const f = await fixture();
    await expect(
      f.ops.autoCompletePolygon({
        line: [
          [8, 1],
          [14, 1],
          [14, 3],
          [8, 3],
          [8, 6],
          [14, 6],
          [14, 9],
          [8, 9],
        ],
      }),
    ).resolves.toMatchObject({ ok: true, value: { createdCount: 2 } });
    expect(f.source.getDataset().layers[0]!.shapes).toHaveLength(3);
    expect(f.entries).toHaveLength(1);
    f.entries[0]!.undo();
    expect(f.source.getDataset().layers[0]!.shapes).toHaveLength(1);
  });

  it.each([
    {
      name: 'unconnected line',
      line: [
        [20, 0],
        [25, 5],
      ],
    },
    {
      name: 'line inside an existing face',
      line: [
        [2, 2],
        [8, 8],
      ],
    },
    {
      name: 'single boundary crossing',
      line: [
        [8, 5],
        [15, 5],
      ],
    },
    {
      name: 'detached closed polygon',
      line: [
        [20, 0],
        [25, 0],
        [25, 5],
        [20, 0],
      ],
    },
    {
      name: 'invalid coordinates',
      line: [
        [NaN, 0],
        [10, 0],
      ],
    },
    {
      name: 'self-intersecting line',
      line: [
        [8, 2],
        [14, 8],
        [14, 2],
        [8, 8],
      ],
    },
  ])('rejects $name without mutation or history', async ({ line }) => {
    const f = await fixture();
    const before = f.source.getDataset();
    await expect(
      f.ops.autoCompletePolygon({ line: line as [number, number][] }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(f.source.getDataset()).toBe(before);
    expect(f.entries).toHaveLength(0);
  });
});
