import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { EmapHostInternal } from '../emap-host';
import { MapshaperOps } from '../mapshaper-ops';
import { Selection } from '../selection';
import type { MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';

async function importDataset(features: GeoJSON.Feature[]): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport('-i split-selected.geojson', {
    'split-selected.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  });
}

function line(coordinates: number[][], properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates } };
}

function polygon(coordinates: number[][][], properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates } };
}

function harness(dataset: MapshaperDataset, selected: number[]): {
  ops: MapshaperOps;
  source: { getDataset(): MapshaperDataset; getLayers(): MapshaperLayer[]; setDataset(value: MapshaperDataset): void; fire: ReturnType<typeof vi.fn> };
  selection: Selection;
  history: { entries: unknown[]; push(entry: unknown): void; isCapturing(): boolean };
  events: { selection: ReturnType<typeof vi.fn>; history: ReturnType<typeof vi.fn> };
} {
  let current = dataset;
  const source = {
    getDataset: () => current,
    getLayers: () => current.layers,
    setDataset: (value: MapshaperDataset) => { current = value; },
    fire: vi.fn(),
  };
  const selection = new Selection();
  selection.apply(selected.map((id) => ({ source: 'source', layer: 'split-selected', id })), 'replace');
  const history = { entries: [] as unknown[], push(entry: unknown) { this.entries.push(entry); }, isCapturing: () => false };
  const events = { selection: vi.fn(), history: vi.fn() };
  const host = {
    _activeTransaction: null,
    _removed: false,
    _sources: new Map([['source', source]]),
    _history: history,
    _selection: selection,
    layers: {
      resolve: (sourceId: string, layerId: string) => sourceId === 'source'
        ? current.layers.find((candidate) => candidate.name === layerId || candidate.id === layerId) ?? null
        : null,
      resolveInLayers: (layers: readonly MapshaperLayer[], layerId: string) =>
        layers.find((candidate) => candidate.name === layerId || candidate.id === layerId) ?? null,
    },
    _invalidateShapeCachesForSources: vi.fn(),
    _scheduleRender: vi.fn(),
    _fireHistoryChange: events.history,
    _fireSelectionChange: events.selection,
    fire: vi.fn(),
  };
  const typedHost = host as unknown as EmapHostInternal; // complete runner host surface is intentionally limited to exercised paths
  return { ops: new MapshaperOps(typedHost), source, selection, history, events };
}

describe('MapshaperOps.splitSelected integration', () => {
  it('splits a real selected line, retains its id, clones records, and restores dataset and selection through history', async () => {
    const dataset = await importDataset([line([[0, 0], [10, 0]], { name: 'road' })]);
    dataset.layers[0]!.name = 'split-selected';
    const { ops, source, selection, history, events } = harness(dataset, [0]);

    const result = await ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } });

    expect(result).toMatchObject({ ok: true, value: { splitTargetCount: 1, resultFeatures: [
      { source: 'source', layer: 'split-selected', id: 0 },
      { source: 'source', layer: 'split-selected', id: 1 },
    ] } });
    const split = source.getDataset();
    const records = split.layers[0]!.data!.getRecords!();
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(records[1]);
    expect(records[0]).not.toBe(records[1]);
    expect(split.layers).toHaveLength(1);
    expect(selection.getAll()).toEqual(result.ok ? result.value.resultFeatures : []);
    expect(history.entries).toHaveLength(1);
    expect(events.selection).toHaveBeenCalledTimes(1);
    expect(events.history).toHaveBeenCalledTimes(1);
    const entry = history.entries[0] as { label: string; undo(): void; do(): void };
    expect(entry.label).toBe('Split 1 feature');
    entry.undo();
    expect(source.getDataset()).toBe(dataset);
    expect(selection.getAll()).toEqual([{ source: 'source', layer: 'split-selected', id: 0 }]);
    entry.do();
    expect(selection.getAll()).toHaveLength(2);
  });

  it('keeps unhit selected and unselected original ids while appending split results after every original feature', async () => {
    const dataset = await importDataset([
      line([[0, 0], [10, 0]], { id: 'first' }),
      line([[0, 10], [10, 10]], { id: 'unhit' }),
      line([[0, 20], [10, 20]], { id: 'last' }),
    ]);
    dataset.layers[0]!.name = 'split-selected';
    const { ops, source } = harness(dataset, [0, 1]);

    const result = await ops.splitSelected({ cutter: { type: 'point', coordinates: [5, 0] } });

    expect(result).toMatchObject({ ok: true, value: { splitTargetCount: 1, resultFeatures: [
      { id: 0 }, { id: 1 }, { id: 3 },
    ] } });
    expect(source.getDataset().layers[0]!.shapes).toHaveLength(4);
    expect(source.getDataset().layers[0]!.data!.getRecords!().map((record) => record.id)).toEqual(['first', 'unhit', 'last', 'first']);
  });

  it('splits a real polygon through the facade and rejects no-effective cuts atomically', async () => {
    const dataset = await importDataset([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], { name: 'parcel' })]);
    dataset.layers[0]!.name = 'split-selected';
    const { ops, source, history } = harness(dataset, [0]);
    const result = await ops.splitSelected({ cutter: { type: 'polyline', coordinates: [[-1, 5], [11, 5]] } });
    expect(result).toMatchObject({ ok: true, value: { splitTargetCount: 1 } });
    expect(source.getDataset().layers).toHaveLength(1);

    const untouched = source.getDataset();
    const noCut = await ops.splitSelected({ cutter: { type: 'polyline', coordinates: [[-1, 20], [11, 20]] } });
    expect(noCut).toMatchObject({ ok: false, error: { kind: 'validation', field: 'cutter' } });
    expect(source.getDataset()).toBe(untouched);
    expect(history.entries).toHaveLength(1);
  });
});
