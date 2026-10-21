import { polygonColdGroups } from './polygon-groups';
import { describe, expect, it } from 'vitest';
import { polygonPresentationGroups, type PolygonGeometryPart } from './polygon-groups';
import type { GeometryPartition } from './geometry-jobs';

const partition = (ids: number[]): GeometryPartition => ({
  membership: Uint32Array.from(ids),
  chunks: Math.max(...ids) + 1,
});
const part = (
  kind: PolygonGeometryPart['kind'],
  p: GeometryPartition,
  chunk: number,
  members: number[],
): PolygonGeometryPart => ({
  kind,
  partition: p,
  job: { chunk, members: Int32Array.from(members) },
});
const signal = () => new AbortController().signal;

describe('polygon presentation dependencies', () => {
  it('keeps replacement strokes independent when their identical resident fill is retained', async () => {
    const fill = partition([0, 0]),
      lines = partition([0, 1]),
      stable = { ...part('fill', fill, 0, [0, 1]), stableFill: true };
    expect(
      await polygonPresentationGroups(
        [stable, part('path', lines, 0, [0]), part('path', lines, 1, [~1])],
        [stable, part('path', lines, 0, [0]), part('path', lines, 1, [~1])],
        [[[0]], [[~1]]],
        signal(),
      ),
    ).toEqual([
      { targets: [0], previous: [0] },
      { targets: [1], previous: [1] },
      { targets: [2], previous: [2] },
    ]);
  });
  it('does not bridge changing fill chunks through a stable fill covering the same features', async () => {
    const fill = partition([0, 0]),
      changed = partition([0, 1]),
      lines = partition([0, 1]),
      stable = { ...part('fill', fill, 0, [0, 1]), stableFill: true };
    const frame = () => [
      stable,
      part('fill', changed, 0, [0]),
      part('fill', changed, 1, [1]),
      part('path', lines, 0, [0]),
      part('path', lines, 1, [~1]),
    ];
    expect(await polygonPresentationGroups(frame(), frame(), [[[0]], [[~1]]], signal())).toEqual([
      { targets: [0], previous: [0] },
      { targets: [1, 3], previous: [1, 3] },
      { targets: [2, 4], previous: [2, 4] },
    ]);
  });
  it('pairs feature chunks with their actual arc chunks and keeps independent areas progressive', async () => {
    const f = partition([0, 1]),
      s = partition([7, 3]);
    const groups = await polygonPresentationGroups(
      [
        part('fill', f, 0, [0]),
        part('fill', f, 1, [1]),
        part('path', s, 7, [0]),
        part('path', s, 3, [1]),
      ],
      [],
      [[[0]], [[1]]],
      signal(),
    );
    expect(groups.map((g) => g.targets)).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });
  it('includes hole rings, reversed arcs and shared boundary dependencies', async () => {
    const f = partition([0, 1]),
      s = partition([0, 1, 2]);
    const groups = await polygonPresentationGroups(
      [
        part('fill', f, 0, [0]),
        part('fill', f, 1, [1]),
        part('path', s, 0, [0]),
        part('path', s, 1, [1]),
        part('path', s, 2, [2]),
      ],
      [],
      [[[0], [~1]], [[1, 2]]],
      signal(),
    );
    expect(groups).toEqual([{ targets: [0, 1, 2, 3, 4], previous: [] }]);
  });
  it('joins old complete polygons across a changed LOD partition without duplicate alpha', async () => {
    const old = partition([0, 0]),
      next = partition([0, 1]),
      lines = partition([0, 1]);
    const current = [
      part('fill', next, 0, [0]),
      part('fill', next, 1, [1]),
      part('path', lines, 0, [0]),
      part('path', lines, 1, [1]),
    ];
    const previous = [
      part('fill', old, 0, [0, 1]),
      part('path', lines, 0, [0]),
      part('path', lines, 1, [1]),
    ];
    expect(await polygonPresentationGroups(current, previous, [[[0]], [[1]]], signal())).toEqual([
      { targets: [0, 1, 2, 3], previous: [0, 1, 2] },
    ]);
  });
  it('supports batched path IDs and feature-based arrow outlines', async () => {
    const f = partition([0, 1]),
      s = { ...partition([3, 4]), batchIds: Uint32Array.from([0, 0, 0, 2, 2]) };
    expect(
      await polygonPresentationGroups(
        [part('fill', f, 0, [0]), part('fill', f, 1, [1]), part('path', s, 2, [0, 1])],
        [],
        [[[0]], [[1]]],
        signal(),
      ),
    ).toEqual([{ targets: [0, 1, 2], previous: [] }]);
    expect(
      await polygonPresentationGroups(
        [part('fill', f, 1, [1]), part('arrow', f, 1, [1])],
        [],
        [[[0]], [[1]]],
        signal(),
      ),
    ).toEqual([{ targets: [0, 1], previous: [] }]);
  });
  it('does not wait for an offscreen boundary and drops departed old content', async () => {
    const f = partition([0, 1]),
      s = partition([0, 1]);
    expect(
      await polygonPresentationGroups(
        [part('fill', f, 0, [0])],
        [part('fill', f, 1, [1]), part('path', s, 1, [1])],
        [[[0]], [[1]]],
        signal(),
      ),
    ).toEqual([{ targets: [0], previous: [] }]);
  });
  it('honors cancellation before planning', async () => {
    const c = new AbortController();
    c.abort();
    await expect(polygonPresentationGroups([], [], [], c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

it('cold shared edges are directed dependencies, not a layer-wide readiness cycle', async () => {
  const f = partition([0, 1]),
    p = partition([0, 0, 0]);
  const current = [part('fill', f, 0, [0]), part('fill', f, 1, [1]), part('path', p, 0, [0, 1, 2])];
  const groups = await polygonColdGroups(current, [[[0, 1]], [[~1, 2]]], signal());
  expect(groups?.map((g) => ({ fill: g.fill, strokes: g.strokes, arcs: [...g.arcs] }))).toEqual([
    { fill: 0, strokes: [2], arcs: [0, 1] },
    { fill: 1, strokes: [2], arcs: [1, 2] },
  ]);
});
