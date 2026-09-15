import { describe, expect, it } from 'vitest';
import { collectTransferables } from './transferables';

describe('typed worker transfer buffers', () => {
  it('transfers every typed coordinate buffer and deduplicates backing storage', () => {
    const coordinates = new Float64Array(1000);
    const counts = new Int32Array(10);
    const bytes = new Uint8Array(20);
    const payload = {
      coordinates,
      view: new DataView(coordinates.buffer),
      nested: [counts, bytes, bytes.buffer],
      label: 'geometry',
    };
    expect(collectTransferables(payload)).toEqual([
      coordinates.buffer,
      counts.buffer,
      bytes.buffer,
    ]);
  });
  it('does not enumerate per-vertex properties of typed arrays', () => {
    const coordinates = new Float64Array(100_000);
    Object.defineProperty(coordinates, 'unexpected', {
      enumerable: true,
      get() {
        throw new Error('typed-array properties were enumerated');
      },
    });
    expect(collectTransferables({ coordinates })).toEqual([coordinates.buffer]);
  });
});
