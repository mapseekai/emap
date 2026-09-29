import { expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from './adapter';
import { prepareDisplayLod } from './display-lod';

it('matches radial filtering for empty, collapsed, repeated and closed arcs', async () => {
  const adapter = getDefaultMapshaperAdapter();
  const arcs = adapter.createArcCollection([
    { xx: [], yy: [] },
    { xx: [1], yy: [2] },
    { xx: [1, 1, 1], yy: [2, 2, 2] },
    { xx: [0, 1, 2, 10, 0], yy: [0, 0, 2, 10, 0] },
    { xx: [0, 100, 101], yy: [0, 100, 101] },
  ]);
  const distance = adapter.getAvgSegment(arcs) * 4;
  const expected = adapter.simplifyArcsFast(arcs, distance);
  const result = await prepareDisplayLod(arcs, new AbortController().signal);
  expect(result.segmentLength).toBe(distance);
  expect(result.arcs.getVertexData!()).toEqual(expected.getVertexData!());
  expect(arcs.getPointCount!()).toBe(12);
});

it('rejects a cancelled preparation before touching the source', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(prepareDisplayLod({} as any, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
