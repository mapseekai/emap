import { describe, expect, it, vi } from 'vitest';
import {
  partitionGeometry,
  selectGeometryJobs,
  packGeometryJob,
  EMPTY_COMPONENT,
  type GeometryInput,
} from './geometry-jobs';
import type { ArcCollection } from '../../../shared/types/mapshaper-types';
const signal = () => new AbortController().signal;
function fixture(): GeometryInput {
  const paths = [
    [
      [1, 1],
      [2, 1],
    ],
    [
      [10, 1],
      [11, 1],
    ],
    [
      [1, 10],
      [2, 10],
    ],
  ];
  const arcs = {
    size: () => 3,
    getArcIter(id: number) {
      let i = 0;
      const points = id < 0 ? [...paths[~id]].reverse() : paths[id];
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (i >= points.length) return false;
          [this.x, this.y] = points[i++];
          return true;
        },
      };
    },
  } as ArcCollection;
  return { kind: 'path', arcs, interval: 0, bounds: [0, 0, 16, 16] };
}
describe('bounded stable geometry planning', () => {
  it('keeps spatial chunk IDs stable across selected subsets and preserves signed direction', async () => {
    const input = fixture(),
      partition = await partitionGeometry(input, signal());
    const full = await selectGeometryJobs(input, partition, signal());
    const subset = await selectGeometryJobs(
      { ...input, ids: new Int32Array([~2, 0]) },
      partition,
      signal(),
    );
    for (const job of subset) {
      const abs = job.members[0] < 0 ? ~job.members[0] : job.members[0];
      expect(job.chunk).toBe(full.find((j) => j.members.includes(abs))!.chunk);
    }
    const packet = await packGeometryJob(input, subset.find((j) => j.members[0] === ~2)!, signal());
    expect([...packet.coordinates]).toEqual([2, 10, 1, 10]);
  });
  it('filters business candidates, deduplicates shared arcs, and retains forward outline semantics', async () => {
    const input = { ...fixture(), shapes: [[[~1, 0]], [[1, 2]]] },
      partition = await partitionGeometry(input, signal());
    const jobs = await selectGeometryJobs(
      { ...input, ids: new Uint32Array([0, 1]), forward: true, filter: (id) => id !== 0 },
      partition,
      signal(),
    );
    expect(jobs.flatMap((j) => [...j.members]).sort()).toEqual([1, 2]);
  });
  it('keeps point feature/component identity without transferring source arrays', async () => {
    const input: GeometryInput = {
      kind: 'point',
      shapes: [
        [
          [1, 1],
          [1.5, 1],
        ],
        [[12, 12]],
      ],
      ids: new Uint32Array([0, 1]),
      components: new Uint32Array([1, EMPTY_COMPONENT]),
      interval: 0,
      bounds: [0, 0, 16, 16],
    };
    const partition = await partitionGeometry(input, signal()),
      jobs = await selectGeometryJobs(input, partition, signal());
    const packets = await Promise.all(jobs.map((j) => packGeometryJob(input, j, signal())));
    expect(packets.flatMap((p) => [...p.coordinates])).toEqual([1.5, 1, 12, 12]);
    expect(input.shapes![0]).toEqual([
      [1, 1],
      [1.5, 1],
    ]);
  });
  it('rejects an aborted plan instead of committing partial memberships', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(partitionGeometry(fixture(), controller.signal)).rejects.toThrow();
  });
});

it('rejects offscreen chunk bounds but keeps a polygon enclosing the viewport', async () => {
  const input: GeometryInput = {
    kind: 'point',
    shapes: [[[1, 1]], [[12, 12]]],
    interval: 0,
    bounds: [0, 0, 16, 16],
  };
  const partition = await partitionGeometry(input, signal());
  const selected = await selectGeometryJobs(
    { ...input, viewBounds: [0, 0, 3, 3] },
    partition,
    signal(),
  );
  expect(selected.flatMap((j) => [...j.members])).toEqual([0]);
  const path = fixture();
  const crossing = await partitionGeometry(path, signal());
  const inside = await selectGeometryJobs(
    { ...path, viewBounds: [1.1, 0.9, 1.9, 1.1] },
    crossing,
    signal(),
  );
  expect(inside.flatMap((j) => [...j.members])).toContain(0);
});
it('packs typed retained arcs identically in both directions without altering their interval', async () => {
  const input = fixture();
  const data = {
    xx: Float64Array.from([0, 1, 1, 2, 3]),
    yy: Float64Array.from([0, 1, 1, 2, 3]),
    nn: Uint32Array.from([5]),
    ii: Uint32Array.from([0]),
    zz: Float64Array.from([0, 0.5, Infinity, NaN, 0]),
  };
  const arcs = {
    size: () => 1,
    getVertexData: () => data,
    getRetainedInterval: () => 123,
    setRetainedInterval: () => {
      throw new Error('Typed path must not change source state');
    },
  } as unknown as ArcCollection;
  const first = await packGeometryJob(
    { ...input, arcs, interval: 1 },
    { chunk: 0, members: Int32Array.from([0]) },
    signal(),
  );
  const reverse = await packGeometryJob(
    { ...input, arcs, interval: 1 },
    { chunk: 0, members: Int32Array.from([~0]) },
    signal(),
  );
  expect([...first.coordinates]).toEqual([0, 0, 1, 1, 2, 2]);
  expect([...reverse.coordinates]).toEqual([3, 3, 2, 2, 1, 1]);
});
it('keeps non-monotonic icon input order rather than sorting spatial or source pages', async () => {
  const shapes = Array.from({ length: 9000 }, (_, i) => [[i, i]] as [number, number][]);
  const input: GeometryInput = {
    kind: 'point',
    shapes,
    ordered: true,
    interval: 0,
    bounds: [0, 0, 9000, 9000],
    ids: Uint32Array.from([8500, 0, 4200, 8501]),
  };
  const partition = await partitionGeometry(input, signal()),
    jobs = await selectGeometryJobs(input, partition, signal());
  expect(jobs.flatMap((j) => [...j.members])).toEqual([8500, 0, 4200, 8501]);
});

it('bounds each child chunk tightly instead of copying the whole spatial-bin bounds', async () => {
  const shapes = Array.from({ length: 17000 }, (_, i) => [[i < 8192 ? 1 : 2, 1]]);
  const input: GeometryInput = { kind: 'point', shapes, interval: 0, bounds: [0, 0, 160, 160] };
  const partition = await partitionGeometry(input, new AbortController().signal);
  expect(partition.chunks).toBe(3);
  expect([...partition.bounds!.subarray(0, 4)]).toEqual([1, 1, 1, 1]);
  expect([...partition.bounds!.subarray(4, 8)]).toEqual([2, 1, 2, 1]);
});

it('deduplicates signed arc IDs at bit 31 and across word boundaries', async () => {
  const arcs = {
    size: () => 64,
    getArcIter(id: number) {
      let i = 0;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (i === 2) return false;
          this.x = (id < 0 ? ~id : id) + i++;
          this.y = 1;
          return true;
        },
      };
    },
  } as ArcCollection;
  const input: GeometryInput = {
    kind: 'path',
    arcs,
    shapes: [[[31, 31, 32, ~32, 63, ~63]]],
    interval: 0,
    bounds: [0, 0, 128, 128],
  };
  const plan = await partitionGeometry(input, signal()),
    jobs = await selectGeometryJobs(input, plan, signal());
  expect(jobs.flatMap((j) => [...j.members]).sort((a, b) => a - b)).toEqual([31, 32, 63]);
});

it('merges only selected consecutive path chunks in the original signed member order', async () => {
  const input = fixture();
  const partition = await partitionGeometry(input, signal());
  partition.batchIds = Uint32Array.from({ length: partition.chunks }, () => 0);
  const originalPartition = { ...partition, batchIds: undefined };
  const original = await selectGeometryJobs(input, originalPartition, signal());
  const batched = await selectGeometryJobs(input, partition, signal());
  expect(batched).toHaveLength(1);
  expect([...batched[0].members]).toEqual(original.flatMap((j) => [...j.members]));
  const selected = { ...input, ids: Int32Array.from([~2, 0]) };
  const reference = await selectGeometryJobs(selected, originalPartition, signal());
  const subset = await selectGeometryJobs(selected, partition, signal());
  expect([...subset[0].members]).toEqual(reference.flatMap((j) => [...j.members]));
  expect(subset[0].chunk).toBe(batched[0].chunk);
});

it('uses native unsimplified arc lengths to avoid a second coordinate read and trims duplicate joins', async () => {
  let reads = 0;
  const xx = new Proxy(new Float64Array([1, 1, 2, 2, 3]), {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, target);
    },
  });
  const data = {
    xx,
    yy: new Float64Array([4, 4, 5, 5, 6]),
    nn: new Uint32Array([3, 2]),
    ii: new Uint32Array([0, 3]),
  };
  const arcs = { getVertexData: () => data } as unknown as ArcCollection;
  const input: GeometryInput = {
    kind: 'fill',
    arcs,
    shapes: [[[0, 1]]],
    interval: 0,
    bounds: [0, 0, 10, 10],
  };
  const p = await packGeometryJob(input, { chunk: 0, members: new Int32Array([0]) }, signal());
  expect([...p.coordinates]).toEqual([1, 4, 2, 5, 3, 6]);
  expect([...p.offsets]).toEqual([0, 3]);
  expect(p.coordinates.buffer.byteLength).toBe(p.coordinates.byteLength);
  expect(reads).toBe(5);
});

it('keeps exact counting for large raw bounds instead of speculatively allocating their coordinate capacity', async () => {
  const count = 131073;
  let reads = 0;
  const xx = new Proxy(new Float64Array(count).fill(1), {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, target);
    },
  });
  const data = {
    xx,
    yy: new Float64Array(count),
    nn: new Uint32Array([count]),
    ii: new Uint32Array([0]),
  };
  const input: GeometryInput = {
    kind: 'path',
    arcs: { getVertexData: () => data } as unknown as ArcCollection,
    interval: 0,
    bounds: [0, 0, 2, 2],
  };
  const packet = await packGeometryJob(input, { chunk: 0, members: new Int32Array([0]) }, signal());
  expect(reads).toBe(count * 2);
  expect(packet.coordinates.buffer.byteLength).toBe(16);
});

it('reads one native vertex-data view per partition, not one per arc per pass', async () => {
  const getVertexData = vi.fn(() => ({
    zz: null,
    xx: new Float64Array([1, 2, 10, 11, 1, 2]),
    yy: new Float64Array([1, 1, 1, 1, 10, 10]),
    nn: new Uint32Array([2, 2, 2]),
    ii: new Uint32Array([0, 2, 4]),
    bb: new Float64Array([1, 1, 2, 1, 10, 1, 11, 1, 1, 10, 2, 10]),
  }));
  const input = fixture();
  input.arcs!.getVertexData = getVertexData;
  const partition = await partitionGeometry(input, signal());
  expect(getVertexData).toHaveBeenCalledTimes(1);
  expect(partition.membership.length).toBe(3);
});

it('does not send structurally degenerate fills to the worker and preserves nonclosed triangles', async () => {
  const input = fixture();
  const data = {
    xx: Float64Array.from([0, 0, 10, 11, 10]),
    yy: Float64Array.from([0, 0, 0, 0, 1]),
    nn: new Uint32Array([2, 3]),
    ii: new Uint32Array([0, 2]),
    bb: Float64Array.from([0, 0, 0, 0, 10, 0, 11, 1]),
  };
  const filled: GeometryInput = {
    ...input,
    kind: 'fill',
    shapes: [[[0]], [[1]]],
    arcs: { size: () => 2, getVertexData: () => data } as unknown as ArcCollection,
  };
  const plan = await partitionGeometry(filled, signal()),
    jobs = await selectGeometryJobs(filled, plan, signal());
  expect(plan.membership[0]).toBe(EMPTY_COMPONENT);
  expect(jobs.flatMap((j) => [...j.members])).toEqual([1]);
  expect(filled.shapes).toEqual([[[0]], [[1]]]);
});
