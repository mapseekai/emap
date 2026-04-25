import { describe, expect, it } from 'vitest';
import { FeaturePropertyChangeCommand } from './feature-property-change';

function makeLayer(records: Record<string, unknown>[]) {
  return { shapes: [], data: { getRecords: () => records } } as any;
}

describe('FeaturePropertyChangeCommand', () => {
  it('sets a new key on do() and removes it on undo()', () => {
    const records = [{ name: 'A' }];
    const layer = makeLayer(records);
    const cmd = new FeaturePropertyChangeCommand({
      layer, featureId: 0,
      prev: {}, next: { pop: 100 },
    });
    cmd.do();
    expect(records[0]).toEqual({ name: 'A', pop: 100 });
    cmd.undo();
    expect(records[0]).toEqual({ name: 'A' });
  });

  it('overwrites an existing key and restores it on undo()', () => {
    const records = [{ name: 'A' }];
    const layer = makeLayer(records);
    const cmd = new FeaturePropertyChangeCommand({
      layer, featureId: 0,
      prev: { name: 'A' }, next: { name: 'B' },
    });
    cmd.do();
    expect(records[0]).toEqual({ name: 'B' });
    cmd.undo();
    expect(records[0]).toEqual({ name: 'A' });
  });

  it('deletes a key when next omits one that prev had', () => {
    const records = [{ name: 'A', tmp: true }];
    const layer = makeLayer(records);
    const cmd = new FeaturePropertyChangeCommand({
      layer, featureId: 0,
      prev: { tmp: true }, next: {},
    });
    cmd.do();
    expect('tmp' in records[0]).toBe(false);
    expect(records[0]).toEqual({ name: 'A' });
    cmd.undo();
    expect(records[0]).toEqual({ name: 'A', tmp: true });
  });

  it('handles multi-key patches in one round-trip', () => {
    const records = [{ name: 'A', pop: 1, tmp: true }];
    const layer = makeLayer(records);
    const cmd = new FeaturePropertyChangeCommand({
      layer, featureId: 0,
      prev: { name: 'A', pop: 1, tmp: true },
      next: { name: 'B', pop: 2 },
    });
    cmd.do();
    expect(records[0]).toEqual({ name: 'B', pop: 2 });
    cmd.undo();
    expect(records[0]).toEqual({ name: 'A', pop: 1, tmp: true });
  });

  it('is a no-op when both patches are empty', () => {
    const records = [{ name: 'A' }];
    const layer = makeLayer(records);
    const cmd = new FeaturePropertyChangeCommand({
      layer, featureId: 0,
      prev: {}, next: {},
    });
    cmd.do();
    cmd.undo();
    expect(records[0]).toEqual({ name: 'A' });
  });

  it('exposes a default label and accepts a custom one', () => {
    const cmd = new FeaturePropertyChangeCommand({
      layer: makeLayer([]), featureId: 0,
      prev: {}, next: {},
    });
    expect(cmd.label).toBe('Edit properties');
    const cmd2 = new FeaturePropertyChangeCommand({
      layer: makeLayer([]), featureId: 0,
      prev: {}, next: {}, label: 'Set name',
    });
    expect(cmd2.label).toBe('Set name');
  });
});
