import { describe, expect, it } from 'vitest';
import { FieldRenameCommand } from './field-rename';

function makeLayer(records: Record<string, unknown>[]) {
  return { shapes: [], data: { getRecords: () => records } } as any;
}

describe('FieldRenameCommand', () => {
  it('moves the value to the new key on every record', () => {
    const records = [{ a: 1 }, { a: 2 }];
    const layer = makeLayer(records);
    new FieldRenameCommand({ layer, from: 'a', to: 'b' }).do();
    expect(records).toEqual([{ b: 1 }, { b: 2 }]);
  });

  it('leaves records without the from-key untouched', () => {
    const records = [{ a: 1 }, { name: 'no-a' }];
    const layer = makeLayer(records);
    new FieldRenameCommand({ layer, from: 'a', to: 'b' }).do();
    expect(records[1]).toEqual({ name: 'no-a' });
  });

  it('undo reverses on every record', () => {
    const records = [{ a: 1, name: 'x' }, { a: 2 }];
    const original = JSON.parse(JSON.stringify(records));
    const layer = makeLayer(records);
    const cmd = new FieldRenameCommand({ layer, from: 'a', to: 'b' });
    cmd.do();
    cmd.undo();
    expect(records).toEqual(original);
  });
});
