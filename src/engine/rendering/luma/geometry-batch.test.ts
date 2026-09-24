import { describe, expect, it } from 'vitest';
import { geometryBatchBytes, geometryJobByteBound, validateGeometryBatch } from './geometry-batch';
import { packGeometryJob, type GeometryInput, type GeometryPacket } from './geometry-jobs';
import type { ArcCollection } from '../../../shared/types/mapshaper-types';
const signal = () => new AbortController().signal;
describe('bounded geometry microbatch admission', () => {
  it('counts backing storage once, including unused bytes in transferable views', () => {
    const buffer = new ArrayBuffer(128);
    const packet: GeometryPacket = {
      kind: 'point',
      coordinates: new Float64Array(buffer, 0, 2),
      offsets: new Uint32Array(buffer, 16, 2),
      features: new Uint32Array(buffer, 24, 2),
    };
    expect(geometryBatchBytes([packet, packet])).toBe(128);
    expect(() => validateGeometryBatch([])).toThrow('batch');
    expect(() => validateGeometryBatch(Array.from({ length: 9 }, () => packet))).toThrow('batch');
  });
  it('conservatively bounds signed arc, multipart ring and point packets before allocation', async () => {
    const data = {
      nn: new Uint32Array([3, 3]),
      ii: new Uint32Array([0, 3]),
      xx: new Float64Array([0, 1, 2, 2, 1, 0]),
      yy: new Float64Array([0, 0, 0, 0, 1, 0]),
    };
    const arcs = { getVertexData: () => data } as unknown as ArcCollection;
    const job = { chunk: 0, members: new Int32Array([0, 1]) };
    const base = { arcs, interval: 0, bounds: [0, 0, 2, 2] as const };
    for (const input of [
      { ...base, kind: 'path' },
      { ...base, kind: 'fill', shapes: [[[0, -2]], [[1]]] },
      {
        ...base,
        kind: 'point',
        shapes: [
          [
            [0, 0],
            [1, 1],
          ],
          [[2, 2]],
        ],
      },
    ] as GeometryInput[]) {
      const packet = await packGeometryJob(input, job, signal());
      if (input.kind === 'fill') packet.featureIds = job.members.slice();
      expect(geometryBatchBytes([packet])).toBeLessThanOrEqual(
        geometryJobByteBound(input, job, 10000),
      );
      expect(geometryJobByteBound(input, job, 1)).toBe(Infinity);
    }
  });
});
