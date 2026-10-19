import { describe, expect, it } from 'vitest';
import { summarizeCapabilityResult } from './agent-tools';

describe('summarizeCapabilityResult', () => {
  it('counts shapes and invokes attribute table size with its owner', () => {
    const data = {
      count: 3,
      size() {
        return this.count;
      },
    };
    expect(
      summarizeCapabilityResult({
        layers: [
          { name: 'points', geometry_type: 'point', shapes: [[], []] },
          { name: 'rows', geometry_type: null, data },
        ],
      }),
    ).toEqual({
      kind: 'dataset',
      layerCount: 2,
      layers: [
        { name: 'points', geometry: 'point', features: 2 },
        { name: 'rows', geometry: null, features: 3 },
      ],
    });
  });

  it('does not trust malformed layer metadata or nonnumeric feature counts', () => {
    expect(
      summarizeCapabilityResult({ layers: [null, 'bad', { name: {}, data: { size: () => '3' } }] }),
    ).toEqual({
      kind: 'dataset',
      layerCount: 3,
      layers: [{}, {}, { name: undefined, geometry: undefined, features: 0 }],
    });
  });
});
