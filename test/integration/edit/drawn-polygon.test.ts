import { describe, expect, it } from 'vitest';
import { createPolygonDrawing } from '../../utils/drawn-polygon';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { toArrowTable } from '../../../src/integrations/arrow/dataset-to-table';
import { fromArrowTable } from '../../../src/integrations/arrow/table-to-dataset';
import type { PathShape } from '../../../src/shared/types/mapshaper-types';
import { datasetFromGeoJSON } from '../../utils/arrow';

const adapter = getDefaultMapshaperAdapter();
const square: [number, number][] = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
];

describe('drawn polygon winding (#35)', () => {
  for (const reverse of [false, true]) {
    for (const completion of ['click', 'dblclick'] as const) {
      it(`normalizes ${reverse ? 'CW' : 'CCW'} input via ${completion}, including redo and ring edits`, async () => {
        const { source, host, ops, draw, errors } = await createPolygonDrawing();
        draw(reverse ? square.slice().reverse() : square, completion);
        const dataset = source.getDataset()!;
        const layer = dataset.layers[0]!;
        const assertPolygon = () => {
          expect(layer.shapes).toHaveLength(1);
          expect(layer.data?.getRecords?.()).toEqual([{ label: 'drawn' }]);
          expect(
            adapter
              .exportPathData(layer.shapes![0] as PathShape, dataset.arcs!, 'polygon')
              .pathData.reduce((sum, path) => sum + path.area!, 0),
          ).toBe(100);
          for (const encoding of ['native', 'wkb'] as const) {
            expect(toArrowTable(dataset, { encoding }).getChild('geometry')!.isValid(0)).toBe(true);
          }
        };
        assertPolygon();
        for (let cycle = 0; cycle < 3; cycle++) {
          host._history.undo();
          expect(layer.shapes).toHaveLength(0);
          host._history.redo();
          assertPolygon();
        }
        const hole: [number, number][] = [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ];
        expect(await ops.addRing({ ring: reverse ? hole.reverse() : hole })).toMatchObject({
          ok: true,
        });
        expect(layer.shapes![0] as PathShape).toHaveLength(2);
        expect(await ops.fillRing({ point: [0, 0] })).toMatchObject({ ok: true });
        expect(layer.shapes).toHaveLength(2);
        host._history.undo();
        expect(await ops.deleteRing({ point: [0, 0] })).toMatchObject({ ok: true });
        assertPolygon();
        expect(errors).toEqual([]);
      });
    }
  }

  it.each<{ points: [number, number][] }>([
    {
      points: [
        [0, 0],
        [1, Number.NaN],
        [1, 1],
      ],
    },
    {
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    },
    {
      points: [
        [0, 0],
        [4, 4],
        [0, 4],
        [3, 0],
      ],
    },
  ])('rejects a degenerate or self-intersecting draft without changing source or history: $points', async ({
    points,
  }) => {
    const { source, host, draw, errors } = await createPolygonDrawing();
    draw(points);
    expect(source.getLayers()[0]!.shapes).toHaveLength(0);
    expect(source.getArcs()!.size()).toBe(0);
    expect(host._history.size()).toBe(0);
    expect(errors).toHaveLength(1);
    draw(square);
    expect(source.getLayers()[0]!.shapes).toHaveLength(1);
    expect(host._history.size()).toBe(1);
  });

  it('repairs legacy shell/hole directions with explicit cleanLayer, preserving shared arcs and its history barrier', async () => {
    const { source, host, ops } = await createPolygonDrawing();
    const ring = (left: number, bottom: number, right: number, top: number) => [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
      [left, bottom],
    ];
    const dataset = await datasetFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 1 },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [ring(0, 0, 10, 10), ring(2, 2, 8, 8)],
              [ring(4, 4, 6, 6)],
              [ring(20, 0, 30, 10), ring(22, 2, 28, 8)],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { id: 2 },
          geometry: { type: 'Polygon', coordinates: [ring(10, 0, 12, 10)] },
        },
        { type: 'Feature', properties: { id: 3 }, geometry: null },
      ],
    });
    const layer = dataset.layers[0]!;
    layer.name = 'draft';
    const ringRefs = (shape: unknown) => (shape as PathShape).map((part) => part.join(',')).sort();
    const normalizedShape = ringRefs(layer.shapes![0]);
    layer.shapes![0] = (layer.shapes![0] as PathShape).map((part) =>
      part
        .slice()
        .reverse()
        .map((id) => ~id),
    );
    const brokenShape = structuredClone(layer.shapes![0]);
    const neighbor = structuredClone(layer.shapes![1]);
    dataset.layers.push({
      name: 'other',
      geometry_type: 'polygon',
      shapes: [structuredClone(neighbor)],
      data: adapter.createDataTable([{ label: 'untouched' }]),
    });
    const vertices = dataset.arcs!.getVertexData!();
    const xx = Array.from(vertices.xx),
      yy = Array.from(vertices.yy);
    const nn = Array.from(vertices.nn);
    const targetIds = new Set(
      (layer.shapes![0] as PathShape).flat().map((id) => (id < 0 ? ~id : id)),
    );
    expect((neighbor as PathShape).flat().some((id) => targetIds.has(id < 0 ? ~id : id))).toBe(
      true,
    );
    source.setDataset(dataset, false);
    host._selection.apply([{ source: 's1', layer: 'draft', id: 0 }], 'replace');
    host._history.push({ label: 'prior edit', do() {}, undo() {} });
    expect(() => toArrowTable(dataset, { layer: 'draft' })).toThrow(/ring/);
    expect(
      await ops.cleanLayer({
        source: 's1',
        target: 'draft',
        rewind: true,
        onlyArcs: true,
        noArcDissolve: true,
        allowEmpty: true,
        noSnap: true,
        allowOverlaps: false,
      }),
    ).toEqual({ ok: true, value: undefined });
    const repaired = source.getDataset()!;
    expect(ringRefs(repaired.layers[0]!.shapes![0])).toEqual(normalizedShape);
    expect(repaired.layers[0]!.shapes![1]).toEqual(neighbor);
    expect(repaired.layers[0]!.shapes![2]).toBeNull();
    expect(repaired.layers[0]!.data?.getRecords?.()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(Array.from(repaired.arcs!.getVertexData!().xx)).toEqual(xx);
    expect(Array.from(repaired.arcs!.getVertexData!().yy)).toEqual(yy);
    expect(Array.from(repaired.arcs!.getVertexData!().nn)).toEqual(nn);
    expect(repaired.layers[1]!.shapes).toEqual([neighbor]);
    expect(repaired.layers[1]!.data?.getRecords?.()).toEqual([{ label: 'untouched' }]);
    expect(host._selection.getAll()).toEqual([{ source: 's1', layer: 'draft', id: 0 }]);
    expect(host._history.snapshot().staleCount).toBe(1);
    for (const encoding of ['native', 'wkb'] as const) {
      const table = toArrowTable(repaired, { encoding, layer: 'draft' });
      const geometry = table.getChild('geometry')!;
      expect(geometry.isValid(0)).toBe(true);
      expect(geometry.isValid(1)).toBe(true);
      expect(geometry.isValid(2)).toBe(false);
      const roundTrip = fromArrowTable(table);
      const paths = adapter.exportPathData(
        roundTrip.layers[0]!.shapes![0] as PathShape,
        roundTrip.arcs!,
        'polygon',
      ).pathData;
      expect(paths).toHaveLength(5);
      expect(paths.filter((path) => path.area! > 0)).toHaveLength(3);
      expect(paths.reduce((sum, path) => sum + path.area!, 0)).toBe(132);
    }
    host._history.undo();
    expect(source.getDataset()).toBe(dataset);
    expect(source.getDataset()!.layers[0]!.shapes![0]).toEqual(brokenShape);
    host._history.redo();
    expect(ringRefs(source.getDataset()!.layers[0]!.shapes![0])).toEqual(normalizedShape);
  });

  it.each<{ points: [number, number][] }>([
    {
      points: [
        [0, 0],
        [4, 4],
        [0, 4],
        [3, 0],
        [0, 0],
      ],
    },
    {
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 0],
      ],
    },
  ])('rejects ambiguous legacy geometry without committing a repair: $points', async ({
    points,
  }) => {
    const { source, host, ops, draw } = await createPolygonDrawing();
    draw(square);
    const dataset = source.getDataset()!;
    const layer = dataset.layers[0]!;
    const id = adapter.appendArc(dataset.arcs!, points);
    layer.shapes![0] = [[id]];
    const before = structuredClone(layer.shapes);
    const historySize = host._history.size();
    host._selection.apply([{ source: 's1', layer: 'draft', id: 0 }], 'replace');
    expect(
      await ops.cleanLayer({
        source: 's1',
        target: 'draft',
        rewind: true,
        onlyArcs: true,
        noArcDissolve: true,
        allowEmpty: true,
        noSnap: true,
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation', field: 'geometry' } });
    expect(source.getDataset()).toBe(dataset);
    expect(layer.shapes).toEqual(before);
    expect(host._history.size()).toBe(historySize);
    expect(host._selection.getAll()).toEqual([{ source: 's1', layer: 'draft', id: 0 }]);
  });
});
