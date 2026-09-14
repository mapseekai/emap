import { describe, expect, it } from 'vitest';
import { TopologySource } from './topology-source';
import { getDefaultMapshaperAdapter } from '../../integrations/mapshaper/adapter';
import { FieldRemoveCommand } from '../edit/commands/field-remove';
import { FieldRenameCommand } from '../edit/commands/field-rename';
import { FieldAddCommand } from '../edit/commands/field-add';

describe('TopologySource.create', () => {
  it('synchronizes defaults between chained and mixed field commands', async () => {
    for (const populated of [false, true]) {
      const source = await TopologySource.create('x', {
        name: 'x',
        geometryType: 'point',
        crs: 'EPSG:4326',
        fields: [{ name: 'label', type: 'string', defaultValue: 'new' }],
      });
      const dataset = source.getDataset()!;
      if (populated) {
        dataset.layers[0].shapes!.push([[0, 0]]);
        dataset.layers[0].data!.getRecords!().push({ label: 'new' });
      }
      const result = await getDefaultMapshaperAdapter().runOnDataset(
        '-each count=1 -rename-fields title=label -filter-fields title',
        dataset,
      );
      expect(result.layers[0].fields).toEqual([
        { name: 'title', type: 'string', defaultValue: 'new' },
      ]);
      expect(result.layers[0].data?.getFields?.()).toEqual(['title']);
      expect(result.layers[0].shapes).toHaveLength(populated ? 1 : 0);
    }
  });
  it('preserves definitions through worker packing and field transformations on an empty layer', async () => {
    const source = await TopologySource.create('x', {
      name: 'x',
      geometryType: 'point',
      crs: '+proj=longlat +datum=WGS84',
      fields: [
        { name: 'label', type: 'string', defaultValue: 'new' },
        { name: 'count', type: 'number' },
      ],
    });
    const adapter = getDefaultMapshaperAdapter();
    const packed = await adapter.exportDatasetsToPack([source.getDataset()!], { compact: false });
    const restored = await adapter.restoreSessionData(packed);
    expect(restored.datasets[0].layers[0].fields).toEqual(source.getLayers()[0].fields);
    const renamed = await adapter.runOnDatasetParsed(
      [{ name: 'rename-fields', options: { fields: ['title=label'] } }],
      adapter.copyDataset(restored.datasets[0]),
    );
    expect(renamed.layers[0].fields?.map((field) => field.name)).toEqual(['title', 'count']);
    expect(renamed.layers[0].data?.getRecords?.()).toEqual([]);
    const filtered = await adapter.runOnDatasetParsed(
      [{ name: 'filter-fields', options: { fields: ['title'] } }],
      renamed,
    );
    expect(filtered.layers[0].fields).toEqual([
      { name: 'title', type: 'string', defaultValue: 'new' },
    ]);
  });
  it('keeps an empty schema consistent with undoable field edits', async () => {
    const source = await TopologySource.create('x', {
      name: 'x',
      geometryType: 'point',
      crs: 'EPSG:4326',
      fields: [{ name: 'label', type: 'string', defaultValue: 'new' }],
    });
    const dataset = source.getDataset()!;
    const layer = dataset.layers[0];
    const rename = new FieldRenameCommand({ layer, dataset, from: 'label', to: 'title' });
    rename.do();
    expect(layer.data?.getFields?.()).toEqual(['title']);
    rename.undo();
    expect(layer.data?.getFields?.()).toEqual(['label']);
    const remove = new FieldRemoveCommand({ layer, dataset, field: 'label' });
    remove.do();
    expect(layer.data?.getFields?.()).toEqual([]);
    remove.undo();
    expect(layer.data?.getFields?.()).toEqual(['label']);
    const add = new FieldAddCommand({ layer, dataset, field: 'active', defaultValue: false });
    add.do();
    expect(layer.data?.getFields?.()).toEqual(['label', 'active']);
    add.undo();
    expect(layer.data?.getFields?.()).toEqual(['label']);
  });
  it.each([
    'point',
    'polyline',
    'polygon',
  ] as const)('creates an empty editable %s layer', async (geometryType) => {
    const source = await TopologySource.create('draft', {
      name: '调查',
      geometryType,
      crs: 'EPSG:4326',
      fields: [
        { name: 'label', type: 'string', defaultValue: '' },
        { name: 'count', type: 'number' },
      ],
    });
    const layer = source.getLayers()[0];
    expect(layer.name).toBe('调查');
    expect(layer.geometry_type).toBe(geometryType);
    expect(layer.shapes).toEqual([]);
    expect(layer.data?.getRecords?.()).toEqual([]);
    expect(layer.data?.getFields?.()).toEqual(['label', 'count']);
    expect(source.getCRS()).toBe('EPSG:4326');
    if (geometryType !== 'point') expect(source.getArcs()?.size()).toBe(0);
    const copy = getDefaultMapshaperAdapter().copyDataset(source.getDataset()!);
    await source.replaceDataset(copy);
    expect(source.getLayers()[0].data?.getFields?.()).toEqual(['label', 'count']);
  });

  it('rejects duplicate fields and invalid defaults before creating a source', async () => {
    await expect(
      TopologySource.create('x', {
        name: 'x',
        geometryType: 'point',
        crs: 'EPSG:4326',
        fields: [
          { name: 'x', type: 'string' },
          { name: 'x', type: 'number' },
        ],
      }),
    ).rejects.toThrow(/field/i);
    await expect(
      TopologySource.create('x', {
        name: 'x',
        geometryType: 'point',
        crs: 'EPSG:4326',
        fields: [{ name: 'x', type: 'number', defaultValue: 'bad' }],
      }),
    ).rejects.toThrow(/default/i);
    await expect(
      TopologySource.create('x', { name: 'x', geometryType: 'point', crs: 'invalid-crs' }),
    ).rejects.toThrow();
  });
});
