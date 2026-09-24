import { describe, it, expect } from 'vitest';
import {
  streamGeoPackageDataset,
  GeoPackageStreamReceiver,
  GEOPACKAGE_TRANSFER_ROWS,
  type GeoPackageStreamMessage,
} from './stream';
import { DEFAULT_GEOPACKAGE_LIMITS, type GeoPackageDataset } from './types';
import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';

function fixture(count = GEOPACKAGE_TRANSFER_ROWS + 2): GeoPackageDataset {
  const adapter = getDefaultMapshaperAdapter();
  const blob = new Uint8Array([1, 255]);
  return {
    layers: [
      {
        name: 'p',
        geometry_type: 'polygon',
        shapes: Array.from({ length: count }, (_, i) => (i % 3 ? [[0, ~1], [], [2]] : null)),
        data: adapter.createDataTable(
          Array.from({ length: count }, (_, i) => ({
            i,
            blob,
            ...JSON.parse('{"__proto__":"safe"}'),
          })),
        ),
      },
      { name: 'empty', geometry_type: 'polyline', shapes: [], data: adapter.createDataTable([]) },
    ],
    arcs: adapter.createArcCollection([
      { xx: Float64Array.of(0, 1), yy: Float64Array.of(0, 1) },
      { xx: Float64Array.of(1, 2), yy: Float64Array.of(1, 1) },
      { xx: Float64Array.of(2, 0), yy: Float64Array.of(1, 0) },
    ]),
    info: {
      geopackage: {
        tables: [],
        dimensions: 'xy',
        integerEncoding: 'safe-number-or-decimal-string',
      },
    },
  };
}
describe('bounded GeoPackage transfer', () => {
  it('preserves all native paths, signed arc IDs, nulls, records and blobs across acknowledged chunks', async () => {
    const data = fixture(),
      expected = structuredClone(data.layers[0].shapes);
    const receiver = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    let result: GeoPackageDataset | undefined,
      batches = 0;
    await streamGeoPackageDataset(data, async (message, transfer) => {
      const copy = structuredClone(message, { transfer });
      if (copy.type === 'batch') {
        batches++;
        expect(copy.value.records.length).toBeLessThanOrEqual(GEOPACKAGE_TRANSFER_ROWS);
        expect(copy.value.shapes).toBeNull();
        expect(copy.value.arcIds).toBeInstanceOf(Int32Array);
      }
      result = receiver.accept(copy);
      if (copy.type !== 'result') expect(result).toBeUndefined();
    });
    expect(batches).toBe(2);
    expect(result!.layers[0].shapes).toEqual(expected);
    expect(result!.layers[0].data!.getRecords!().at(-1)).toMatchObject({
      i: GEOPACKAGE_TRANSFER_ROWS + 1,
      blob: new Uint8Array([1, 255]),
      ['__proto__']: 'safe',
    });
    expect(result!.layers[1].shapes).toEqual([]);
    expect(result!.arcs!.size()).toBe(3);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it('does not enqueue a second payload before the first acknowledgement', async () => {
    let release!: () => void;
    const messages: GeoPackageStreamMessage[] = [];
    const promise = streamGeoPackageDataset(fixture(1), async (message) => {
      messages.push(message);
      if (message.type === 'header')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    await Promise.resolve();
    expect(messages.map((m) => m.type)).toEqual(['header']);
    release();
    await promise;
    expect(messages.map((m) => m.type)).toEqual(['header', 'batch', 'result']);
  });
  it('rejects missing or duplicated chunks without publishing a partial dataset', async () => {
    const messages: GeoPackageStreamMessage[] = [];
    await streamGeoPackageDataset(fixture(2), async (message) => {
      messages.push(structuredClone(message));
    });
    const receiver = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    expect(receiver.accept(messages[0])).toBeUndefined();
    expect(() => receiver.accept(messages[0])).toThrow('Out-of-order');
    const incomplete = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    incomplete.accept(messages[0]);
    expect(() => incomplete.accept({ ...messages.at(-1)!, sequence: 1 })).toThrow('Incomplete');
  });
});
