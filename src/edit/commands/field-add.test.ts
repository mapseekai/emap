import { describe, expect, it } from 'vitest';
import { FieldAddCommand } from './field-add';

function makeLayer(records: Record<string, unknown>[]) {
  return { shapes: [], data: { getRecords: () => records } } as any;
}

describe('FieldAddCommand', () => {
  it('adds the key to records that did not have it', () => {
    const records = [{ name: 'A' }, { name: 'B' }];
    const layer = makeLayer(records);
    const cmd = new FieldAddCommand({ layer, field: 'pop', defaultValue: 0 });
    cmd.do();
    expect(records).toEqual([
      { name: 'A', pop: 0 },
      { name: 'B', pop: 0 },
    ]);
  });

  it('skips records that already had the key', () => {
    const records = [
      { name: 'A', pop: 100 },
      { name: 'B' },
    ];
    const layer = makeLayer(records);
    const cmd = new FieldAddCommand({ layer, field: 'pop', defaultValue: 0 });
    cmd.do();
    expect(records[0]).toEqual({ name: 'A', pop: 100 });
    expect(records[1]).toEqual({ name: 'B', pop: 0 });
  });

  it('undo only removes the keys this command added', () => {
    const records = [
      { name: 'A', pop: 100 }, // pre-existing
      { name: 'B' },           // newly added
    ];
    const layer = makeLayer(records);
    const cmd = new FieldAddCommand({ layer, field: 'pop' });
    cmd.do();
    cmd.undo();
    expect(records[0]).toEqual({ name: 'A', pop: 100 });
    expect(records[1]).toEqual({ name: 'B' });
  });

  it('defaults to null when no defaultValue is given', () => {
    const records: Record<string, unknown>[] = [{ name: 'A' }];
    const layer = makeLayer(records);
    const cmd = new FieldAddCommand({ layer, field: 'tmp' });
    cmd.do();
    expect(records[0].tmp).toBeNull();
  });
});
