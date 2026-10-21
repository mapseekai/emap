import { expect, it } from 'vitest';
import {
  partitionGeometry,
  selectGeometryJobs,
  packGeometryJob,
  type GeometryInput,
} from '../../../src/engine/rendering/luma/geometry-jobs';
import { buildGeometryPacket } from '../../../src/engine/rendering/luma/geometry-packet';
import { PathRangeIndex } from '../../../src/engine/rendering/luma/path-ranges';
import { selectPathMembers } from '../../../src/engine/rendering/luma/path-members';
import type { ArcCollection } from '../../../src/shared/types/mapshaper-types';

it('culls mixed-order opaque work within one whole-layer job while retaining exact signed member ownership', async () => {
  const count = 8192,
    data = {
      xx: new Float64Array(count * 2),
      yy: new Float64Array(count * 2),
      ii: Uint32Array.from({ length: count }, (_, i) => i * 2),
      nn: new Uint32Array(count).fill(2),
      bb: new Float64Array(count * 4),
    };
  for (let i = 0; i < count; i++) {
    const x = (i % 8 === 0 ? 0 : i % 2 ? 100 : -100) + 0.123456789;
    data.xx.set([x, x + 1], i * 2);
    data.yy.set([x, x], i * 2);
    data.bb.set([x, x, x + 1, x], i * 4);
  }
  const before = structuredClone(data),
    ids = Int32Array.from({ length: count }, (_, i) => (i % 3 ? i : ~i)),
    input: GeometryInput = {
      kind: 'path',
      arcs: { size: () => count, getVertexData: () => data } as unknown as ArcCollection,
      ids,
      wholeLayer: true,
      spatialOrder: true,
      interval: 0,
      bounds: [-110, -110, 110, 110],
    },
    signal = new AbortController().signal,
    partition = await partitionGeometry(input, signal),
    jobs = await selectGeometryJobs(input, partition, signal);
  expect(jobs).toHaveLength(1);
  expect(partition.bounds).toBeUndefined();
  const packet = await packGeometryJob(input, jobs[0], signal),
    result = buildGeometryPacket(packet);
  expect(result.geometries).toHaveLength(1);
  const geometry = result.geometries[0],
    selected = new PathRangeIndex(geometry.pathRanges!, geometry.count).selectBounds([
      -2, -2, 2, 2,
    ]),
    ranges = selected.ranges!;
  expect(ranges).not.toBeNull();
  expect(ranges.length).toBeLessThanOrEqual(8);
  expect(ranges.reduce((n, range) => n + range.count, 0)).toBeLessThan(geometry.count / 4);
  const members = geometry.memberRanges!;
  for (let i = 0; i < members.length; i += 3) {
    const signed = jobs[0].members[members[i]],
      id = signed < 0 ? ~signed : signed,
      first = members[i + 1];
    if (id % 8 === 0)
      expect(
        ranges.some((r) => r.firstInstance <= first && r.firstInstance + r.count > first),
      ).toBe(true);
    const coordinate = (first + 1) * 7,
      source = id * 2 + (signed < 0 ? 1 : 0);
    expect(geometry.vertices[coordinate] + geometry.vertices[coordinate + 2]).toBeCloseTo(
      data.xx[source],
      10,
    );
    expect(geometry.vertices[coordinate + 1] + geometry.vertices[coordinate + 3]).toBeCloseTo(
      data.yy[source],
      10,
    );
  }
  let ownedSegments = 0;
  for (const range of selectPathMembers(members, jobs[0].members, new Set([0, 8]), ranges))
    for (let i = range.firstInstance; i < range.firstInstance + range.count; i++)
      if (geometry.vertices[(i + 1) * 7 + 6] < 4) ownedSegments++;
  expect(ownedSegments).toBe(2);
  expect(data).toEqual(before);
  expect(ids).toEqual(Int32Array.from({ length: count }, (_, i) => (i % 3 ? i : ~i)));
});
