import { describe, expect, it } from 'vitest';
import {
  type MapshaperDataset,
  type MapshaperLayer,
  bumpAttributeVersion,
} from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import { BulkFeatureDeleteCommand, FeatureDeleteCommand } from './feature-delete';
import { FieldAddCommand } from './field-add';
import { FeaturePropertyChangeCommand } from './feature-property-change';

function makeDataset(overrides: Partial<MapshaperDataset> = {}): MapshaperDataset {
  return { layers: [], ...overrides };
}

function makeSource(dataset: MapshaperDataset): TopologySource {
  const source = {
    getDataset: () => dataset,
    getArcs: () => null,
    markDisplayArcsDirty: () => {},
    fire: () => {},
  };
  // The command only consumes this tested TopologySource surface.
  return source as unknown as TopologySource;
}

function makeLayer(records: Record<string, unknown>[]): MapshaperLayer {
  const layer = {
    shapes: [[[0]], [[1]]],
    data: { getRecords: () => records },
  };
  // The command only reads shapes and data.getRecords from this test double.
  return layer as unknown as MapshaperLayer;
}

describe('bumpAttributeVersion', () => {
  it('initialises undefined to 0 then increments', () => {
    const dataset = makeDataset();
    bumpAttributeVersion(dataset);
    expect(dataset.attributeVersion).toBe(1);
    bumpAttributeVersion(dataset);
    expect(dataset.attributeVersion).toBe(2);
    expect(() => bumpAttributeVersion(null)).not.toThrow();
  });
});

describe('shape-count commands bump attributeVersion (same-reference)', () => {
  it('FeatureDeleteCommand do/undo bump both counters', () => {
    const dataset = makeDataset({ editVersion: 0, attributeVersion: 0 });
    const records = [{ a: 0 }, { a: 1 }];
    const layer = makeLayer(records);
    const cmd = new FeatureDeleteCommand({
      layer,
      featureId: 1,
      shape: layer.shapes![1]!,
      record: records[1]!,
      source: makeSource(dataset),
    });
    cmd.do();
    expect(dataset.editVersion).toBe(1);
    expect(dataset.attributeVersion).toBe(1);
    cmd.undo();
    expect(dataset.attributeVersion).toBe(2);
  });

  it('BulkFeatureDeleteCommand do/undo bump attributeVersion', () => {
    const dataset = makeDataset({ attributeVersion: 0 });
    const records = [{ a: 0 }, { a: 1 }];
    const layer = makeLayer(records);
    const cmd = new BulkFeatureDeleteCommand({
      layer,
      snapshots: [{ id: 0, shape: [[0]], record: { a: 0 } }],
      source: makeSource(dataset),
    });
    cmd.do();
    expect(dataset.attributeVersion).toBe(1);
    cmd.undo();
    expect(dataset.attributeVersion).toBe(2);
  });
});

describe('attribute commands bump attributeVersion only', () => {
  it('FieldAddCommand do/undo bump attributeVersion, not editVersion', () => {
    const dataset = makeDataset({ editVersion: 0, attributeVersion: 0 });
    const records = [{ name: 'A' }];
    const layer = makeLayer(records);
    const cmd = new FieldAddCommand({ layer, field: 'pop', defaultValue: 0, dataset });
    cmd.do();
    expect(dataset.attributeVersion).toBe(1);
    expect(dataset.editVersion).toBe(0);
    cmd.undo();
    expect(dataset.attributeVersion).toBe(2);
  });

  it('FeaturePropertyChangeCommand do/undo bump attributeVersion', () => {
    const dataset = makeDataset({ attributeVersion: 0 });
    const records = [{ name: 'A' }];
    const layer = makeLayer(records);
    const cmd = new FeaturePropertyChangeCommand({
      layer,
      featureId: 0,
      prev: {},
      next: { pop: 1 },
      dataset,
    });
    cmd.do();
    expect(dataset.attributeVersion).toBe(1);
  });
});
