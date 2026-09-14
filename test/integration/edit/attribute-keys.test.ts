import { describe, expect, it, vi } from 'vitest';
import { FeaturePropertyChangeCommand } from '../../../src/domain/edit/commands/feature-property-change';
import { FieldAddCommand } from '../../../src/domain/edit/commands/field-add';
import { FieldRemoveCommand } from '../../../src/domain/edit/commands/field-remove';
import { FieldRenameCommand } from '../../../src/domain/edit/commands/field-rename';
import { AttributeOps } from '../../../src/engine/map/attribute-ops';
import { EditHistory } from '../../../src/domain/edit/edit-history';
import type { EmapHostInternal } from '../../../src/engine/map/emap-host';
import type { MapshaperDataset, MapshaperLayer } from '../../../src/shared/types/mapshaper-types';

function setup(records: Record<string, unknown>[] = [{}]) {
  const layer: MapshaperLayer = {
    name: 'points',
    geometry_type: 'point',
    shapes: records.map(() => [[0, 0]]),
    data: { getRecords: () => records } as MapshaperLayer['data'],
  };
  const dataset: MapshaperDataset = { layers: [layer] };
  const history = new EditHistory();
  const host = {
    _history: history,
    _sources: new Map([['s', { getDataset: () => dataset }]]),
    layers: { resolve: () => layer },
    _fireHistoryChange: vi.fn(),
    _scheduleRender: vi.fn(),
  } as unknown as EmapHostInternal;
  return { layer, dataset, history, attributes: new AttributeOps(host) };
}

const keys = ['name', 'constructor', 'toString', 'hasOwnProperty', '__proto__'];
describe('attribute commands preserve own-key semantics', () => {
  it.each(keys)('sparse %s patch round-trips without changing prototypes', (key) => {
    const record: Record<string, unknown> = {};
    const { layer, dataset } = setup([record]);
    const value = { tag: 'attribute value' };
    const cmd = new FeaturePropertyChangeCommand({
      layer,
      dataset,
      featureId: 0,
      prev: {},
      next: { [key]: value },
    });
    cmd.do();
    expect(Object.hasOwn(record, key)).toBe(true);
    expect(record[key]).toBe(value);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    cmd.undo();
    expect(Object.hasOwn(record, key)).toBe(false);
    cmd.do();
    expect(record[key]).toBe(value);
  });

  it.each(keys)('public property editing does not capture inherited %s', (key) => {
    const record: Record<string, unknown> = {};
    const { attributes, history } = setup([record]);
    expect(attributes.setFeatureProperty({ source: 's', layer: 'points', id: 0 }, key, 7).ok).toBe(
      true,
    );
    expect(Object.hasOwn(record, key)).toBe(true);
    history.undo();
    expect(Object.hasOwn(record, key)).toBe(false);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });

  it.each(keys)('add/remove/rename %s round-trip', (key) => {
    const record: Record<string, unknown> = {};
    const { layer, dataset } = setup([record]);
    const add = new FieldAddCommand({ layer, dataset, field: key, defaultValue: { data: 1 } });
    add.do();
    expect(Object.hasOwn(record, key)).toBe(true);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    const remove = new FieldRemoveCommand({ layer, dataset, field: key });
    remove.do();
    expect(Object.hasOwn(record, key)).toBe(false);
    remove.undo();
    expect(record[key]).toEqual({ data: 1 });
    const rename = new FieldRenameCommand({ layer, dataset, from: key, to: 'renamed' });
    rename.do();
    expect(Object.hasOwn(record, key)).toBe(false);
    rename.undo();
    expect(record[key]).toEqual({ data: 1 });
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    add.undo();
    expect(Object.hasOwn(record, key)).toBe(false);
  });

  it('removing an absent inherited field does not materialize it on undo', () => {
    const record = {};
    const { layer, dataset } = setup([record]);
    const command = new FieldRemoveCommand({ layer, dataset, field: 'constructor' });
    command.do();
    command.undo();
    expect(Object.keys(record)).toEqual([]);
  });

  it('rename undo leaves records that only had the destination untouched', () => {
    const records = [{ from: 1 }, { to: 2 }];
    const { attributes, history } = setup(records);
    expect(
      attributes.renameField({ source: 's', target: 'points', from: 'from', to: 'to' }).ok,
    ).toBe(true);
    history.undo();
    expect(records).toEqual([{ from: 1 }, { to: 2 }]);
    history.redo();
    expect(records).toEqual([{ to: 1 }, { to: 2 }]);
  });

  it('restores an own undefined value and accepts null-prototype records', () => {
    const record = Object.assign(Object.create(null), { value: undefined });
    const { attributes, history } = setup([record]);
    expect(
      attributes.setFeatureProperty({ source: 's', layer: 'points', id: 0 }, 'value', undefined).ok,
    ).toBe(true);
    expect(Object.hasOwn(record, 'value')).toBe(false);
    history.undo();
    expect(Object.hasOwn(record, 'value')).toBe(true);
    expect(record.value).toBeUndefined();
    expect(Object.getPrototypeOf(record)).toBeNull();
  });
});
