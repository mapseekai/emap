import { describe, expect, it } from 'vitest';
import { FieldRemoveCommand } from './field-remove';

function makeLayer(records: Record<string, unknown>[]) {
  return { shapes: [], data: { getRecords: () => records } } as any;
}

describe('FieldRemoveCommand', () => {
  it('removes the key from every record that had it', () => {
    const records = [
      { name: 'A', pop: 100 },
      { name: 'B', pop: 200 },
    ];
    const layer = makeLayer(records);
    const dataset = { layers: [] };
    const cmd = new FieldRemoveCommand({ layer, field: 'pop', dataset });
    cmd.do();
    expect(records).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it('leaves records that never had the field untouched', () => {
    const records = [{ name: 'A', pop: 100 }, { name: 'B' }];
    const layer = makeLayer(records);
    const dataset = { layers: [] };
    const cmd = new FieldRemoveCommand({ layer, field: 'pop', dataset });
    cmd.do();
    cmd.undo();
    // Record 1 never had `pop`; undo must not add it back.
    expect('pop' in records[1]).toBe(false);
  });

  it('undo restores exact prior values', () => {
    const records = [{ name: 'A', pop: 100, density: 5.5 }, { name: 'B', pop: 200 }, { name: 'C' }];
    const original = JSON.parse(JSON.stringify(records));
    const layer = makeLayer(records);
    const dataset = { layers: [] };
    const cmd = new FieldRemoveCommand({ layer, field: 'pop', dataset });
    cmd.do();
    cmd.undo();
    expect(records).toEqual(original);
  });
});
