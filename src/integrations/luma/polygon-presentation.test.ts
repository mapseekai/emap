import { describe, expect, it, vi } from 'vitest';
import { PolygonPresentation, type PolygonChannel } from './polygon-presentation';
import type { GeometryEntry, GeometryRequest } from './geometry-cache';
import type { GeometryPartition } from '../../engine/rendering/luma/geometry-jobs';

function fixture() {
  const shapes = [[[0]], [[1]]];
  const fill: GeometryPartition = { membership: Uint32Array.from([0, 1]), chunks: 2 };
  const stroke: GeometryPartition = { membership: Uint32Array.from([7, 3]), chunks: 8 };
  const calls: string[] = [];
  const resident = new Set<GeometryEntry>();
  const invalidate = vi.fn(),
    report = vi.fn();
  const ready = (entry: GeometryEntry) => resident.has(entry) && entry.state === 'ready';
  const group = new PolygonPresentation(shapes, {
    ready,
    complete: (request) => !!request.entries && request.entries.every(ready),
    invalidate,
    report,
  });
  const entry = (
    id: string,
    chunk: number,
    members: number[],
    state: GeometryEntry['state'] = 'ready',
  ): GeometryEntry => {
    const e: GeometryEntry = {
      id,
      family: id,
      partition: 'p',
      owner: { id: 'layer', sourceId: 'source', revision: 0 },
      job: { chunk, members: Int32Array.from(members) },
      state,
      meshes: [],
      ranges: [],
      fillRanges: [],
      screenSpace: false,
      bytes: 4,
      used: 0,
    };
    resident.add(e);
    return e;
  };
  const channel = (
    kind: 'fill' | 'path',
    entries: GeometryEntry[],
    key: string = kind,
    order = kind === 'fill' ? 0 : 100,
  ): PolygonChannel => {
    const request = {
      input: { kind, shapes, interval: 0, bounds: [0, 0, 2, 2] },
      owner: { id: 'layer', sourceId: 'source', revision: 0 },
      plan: { promise: Promise.resolve(kind === 'fill' ? fill : stroke) },
      entries,
      controller: new AbortController(),
    } as unknown as GeometryRequest;
    return { key, order, request, draw: (entries) => calls.push(...entries.map((e) => e.id)) };
  };
  return { group, entry, channel, calls, resident, invalidate, report };
}
const planned = async (f: ReturnType<typeof fixture>) => {
  await vi.waitFor(() => expect(f.invalidate).toHaveBeenCalled());
  f.calls.length = 0;
  f.group.draw();
};

describe('polygon presentation', () => {
  for (const held of ['fill', 'path'] as const)
    it(`never publishes one half while ${held} is pending`, async () => {
      const f = fixture(),
        fill = f.entry('fill', 0, [0], held === 'fill' ? 'building' : 'ready'),
        stroke = f.entry('stroke', 7, [0], held === 'path' ? 'building' : 'ready');
      f.group.update([f.channel('fill', [fill]), f.channel('path', [stroke])]);
      f.group.draw();
      await planned(f);
      expect(f.calls).toEqual([]);
      expect(f.group.complete).toBe(false);
      fill.state = stroke.state = 'ready';
      f.group.draw();
      expect(f.calls).toEqual(['fill', 'stroke']);
      expect(f.group.complete).toBe(true);
      f.group.dispose();
    });
  it('publishes independent complete regions without waiting for another polygon', async () => {
    const f = fixture(),
      a = f.entry('fill-a', 0, [0]),
      b = f.entry('fill-b', 1, [1], 'building'),
      sa = f.entry('stroke-a', 7, [0]),
      sb = f.entry('stroke-b', 3, [1]);
    f.group.update([f.channel('fill', [a, b]), f.channel('path', [sa, sb])]);
    f.group.draw();
    await planned(f);
    expect(f.calls).toEqual(['fill-a', 'stroke-a']);
    expect(f.group.complete).toBe(false);
    f.calls.length = 0;
    b.state = 'ready';
    f.group.draw();
    expect(f.calls).toEqual(['fill-a', 'fill-b', 'stroke-a', 'stroke-b']);
    f.group.dispose();
  });
  it('retains the old complete pair until both replacement geometries can take over', async () => {
    const f = fixture(),
      oldFill = f.entry('old-fill', 0, [0]),
      oldStroke = f.entry('old-stroke', 7, [0]);
    f.group.update([f.channel('fill', [oldFill]), f.channel('path', [oldStroke])]);
    f.group.draw();
    const fill = f.entry('new-fill', 0, [0]),
      stroke = f.entry('new-stroke', 7, [0], 'building');
    f.calls.length = 0;
    f.group.update([f.channel('fill', [fill]), f.channel('path', [stroke])]);
    f.group.draw();
    expect(f.calls).toEqual(['old-fill', 'old-stroke']);
    await planned(f);
    expect(f.calls).toEqual(['old-fill', 'old-stroke']);
    f.calls.length = 0;
    stroke.state = 'ready';
    f.group.draw();
    expect(f.calls).toEqual(['new-fill', 'new-stroke']);
    expect((f.group as any).previous).toEqual([]);
    f.group.dispose();
  });
  it('does not present half an old pair after residency loss', async () => {
    const f = fixture(),
      a = f.entry('old-fill', 0, [0]),
      s = f.entry('old-stroke', 7, [0]);
    f.group.update([f.channel('fill', [a]), f.channel('path', [s])]);
    f.group.draw();
    f.group.update([
      f.channel('fill', [f.entry('new-fill', 0, [0], 'building')]),
      f.channel('path', [f.entry('new-stroke', 7, [0], 'building')]),
    ]);
    f.resident.delete(s);
    f.calls.length = 0;
    f.group.draw();
    await planned(f);
    expect(f.calls).toEqual([]);
    f.group.dispose();
  });
  it('keeps all fill paint buckets below outlines, even across progressive components', async () => {
    const f = fixture(),
      a = f.entry('red', 0, [0]),
      b = f.entry('blue', 1, [1]),
      sa = f.entry('sa', 7, [0]),
      sb = f.entry('sb', 3, [1]);
    f.group.update([
      f.channel('fill', [a], 'red', 0),
      f.channel('fill', [b], 'blue', 1),
      f.channel('path', [sa, sb]),
    ]);
    f.group.draw();
    expect(f.calls).toEqual(['red', 'blue', 'sa', 'sb']);
    f.group.dispose();
  });
  it('waits for selection planning and accepts an empty offscreen outline as ready', () => {
    const f = fixture(),
      c = f.channel('fill', [f.entry('fill', 0, [0])]),
      s = f.channel('path', []);
    s.request.entries = null;
    f.group.update([c, s]);
    f.group.draw();
    expect(f.calls).toEqual([]);
    expect(f.group.complete).toBe(false);
    s.request.entries = [];
    f.group.draw();
    expect(f.calls).toEqual(['fill']);
    expect(f.group.complete).toBe(true);
    f.group.dispose();
  });
  it('does not publish a late dependency plan after disposal', async () => {
    const f = fixture(),
      c = f.channel('fill', [f.entry('fill', 0, [0])]),
      s = f.channel('path', [f.entry('stroke', 7, [0], 'building')]);
    let release!: (p: GeometryPartition) => void;
    s.request.plan.promise = new Promise((resolve) => {
      release = resolve;
    });
    f.group.update([c, s]);
    f.group.draw();
    f.group.dispose();
    release({ membership: Uint32Array.from([7]), chunks: 8 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });
  it('shares a resident stroke mesh but selects only edges of the ready face', async () => {
    const f = fixture(),
      a = f.entry('fill-a', 0, [0]),
      b = f.entry('fill-b', 1, [1], 'building');
    const stroke = f.entry('shared', 0, [0, 1]);
    const paths = f.channel('path', [stroke]);
    paths.request.plan.promise = Promise.resolve({
      membership: Uint32Array.from([0, 0]),
      chunks: 1,
    });
    const draws = vi.fn();
    paths.draw = draws;
    f.group.update([f.channel('fill', [a, b]), paths]);
    f.group.draw();
    await planned(f);
    expect(f.calls).toEqual(['fill-a']);
    expect(draws).toHaveBeenCalledOnce();
    expect([...draws.mock.calls[0][1].get(stroke)]).toEqual([0]);
    draws.mockClear();
    f.calls.length = 0;
    b.state = 'ready';
    f.group.draw();
    expect(draws).toHaveBeenCalledOnce();
    expect(draws.mock.calls[0][0]).toEqual([stroke]);
    expect(draws.mock.calls[0][1].get(stroke)).toBeUndefined();
    expect(f.calls).toEqual(['fill-a', 'fill-b']);
    f.group.dispose();
  });

  it('reports dependency failure once and does not retry on every replay', async () => {
    const f = fixture(),
      c = f.channel('fill', [f.entry('fill', 0, [0])]),
      s = f.channel('path', [f.entry('stroke', 7, [0], 'building')]);
    s.request.plan.promise = Promise.reject(new Error('partition unavailable'));
    f.group.update([c, s]);
    f.group.draw();
    await vi.waitFor(() => expect(f.report).toHaveBeenCalledOnce());
    f.group.draw();
    f.group.draw();
    expect(f.report).toHaveBeenCalledOnce();
    expect(f.calls).toEqual([]);
    f.group.dispose();
  });
});
