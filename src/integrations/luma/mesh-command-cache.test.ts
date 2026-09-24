import { describe, expect, it, vi } from 'vitest';
import { MeshCommandCache } from './mesh-command-cache';
import type { GpuMesh } from './gpu-renderer';
const mesh = () => ({ kind: 'fill', count: 6, firstIndex: 0, buffer: {}, indices: {} }) as GpuMesh;
describe('bounded ordered mesh command plans', () => {
  it('reuses equal ordered draws, never mutable ranges or recycled mesh identity', () => {
    const cache = new MeshCommandCache(),
      m = mesh();
    const ranges = [{ firstIndex: 0, indexCount: 3 }];
    cache.begin();
    const first = cache.select('paint', [{ mesh: m, indexRanges: ranges }]);
    cache.end();
    cache.begin();
    expect(cache.select('paint', [{ mesh: m, indexRanges: ranges }])).toBe(first);
    cache.end();
    ranges[0].firstIndex = 3;
    cache.begin();
    const changed = cache.select('paint', [{ mesh: m, indexRanges: ranges }]);
    expect(changed).not.toBe(first);
    cache.end();
    cache.begin();
    expect(cache.select('paint', [{ mesh: mesh(), indexRanges: ranges }])).not.toBe(changed);
  });
  it('releases resources on replacement, source invalidation and unused scopes', () => {
    const cache = new MeshCommandCache(),
      m = mesh(),
      destroy = vi.fn();
    cache.begin();
    const p = cache.select('a', [{ mesh: m }]);
    p.dispose = destroy;
    cache.end();
    cache.begin();
    cache.select('b', [{ mesh: m }]);
    expect(destroy).toHaveBeenCalledOnce();
    cache.end();
    cache.begin();
    cache.end();
    expect(cache.stats.entries).toBe(0);
    cache.begin();
    cache.select('a', [{ mesh: m }]).dispose = destroy;
    cache.clear();
    expect(cache.stats.entries).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(2);
  });
  it('bounds total recorded commands without making current draws disappear', () => {
    const cache = new MeshCommandCache(2, 3);
    cache.begin();
    cache.select('a', [{ mesh: mesh() }, { mesh: mesh() }]);
    cache.select('b', [{ mesh: mesh() }, { mesh: mesh() }]);
    expect(cache.stats.commands).toBeLessThanOrEqual(3);
    expect(cache.stats.entries).toBeLessThanOrEqual(2);
  });
});

it('counts fragmented ranges in the command budget and distinguishes empty ranges from full draws', () => {
  const cache = new MeshCommandCache(8, 3),
    m = mesh();
  cache.begin();
  const over = cache.select('p', [
    { mesh: m, indexRanges: Array.from({ length: 4 }, () => ({ firstIndex: 0, indexCount: 3 })) },
  ]);
  expect(cache.stats.entries).toBe(0);
  expect(over.repeats).toBe(0);
  cache.end();
  cache.begin();
  const empty = cache.select('p', [{ mesh: m, indexRanges: [] }]);
  cache.end();
  cache.begin();
  expect(cache.select('p', [{ mesh: m }])).not.toBe(empty);
});
it('invalidates on count, buffer and order mutations even when mesh objects are reused', () => {
  const cache = new MeshCommandCache(),
    a = mesh(),
    b = mesh();
  cache.begin();
  const first = cache.select('p', [{ mesh: a }, { mesh: b }]);
  cache.end();
  a.count = 3;
  cache.begin();
  const second = cache.select('p', [{ mesh: a }, { mesh: b }]);
  expect(second).not.toBe(first);
  cache.end();
  cache.begin();
  expect(cache.select('p', [{ mesh: b }, { mesh: a }])).not.toBe(second);
  cache.clear();
  expect(cache.stats.commands).toBe(0);
});

it('retires only dependent scopes, including every member of a compiled page span', () => {
  const cache = new MeshCommandCache(),
    a = mesh(),
    b = mesh(),
    c = mesh();
  // Other slices can share a physical page without sharing lifetime.
  b.buffer = a.buffer;
  c.buffer = a.buffer;
  cache.begin();
  const left = cache.select('left', [{ mesh: a }, { mesh: b }]);
  const right = cache.select('right', [{ mesh: c }]);
  left.dispose = vi.fn();
  right.dispose = vi.fn();
  cache.end();
  cache.retire(b);
  expect(left.dispose).toBeUndefined();
  expect(right.dispose).not.toHaveBeenCalled();
  expect(cache.stats.entries).toBe(1);
  cache.begin();
  expect(cache.select('left', [{ mesh: a }])).not.toBe(left);
  expect(cache.select('right', [{ mesh: c }])).toBe(right);
  cache.end();
  cache.retire(mesh());
  expect(cache.stats.entries).toBe(2);
  cache.clear();
  expect(cache.stats.dependencies).toBe(0);
});

it('groups by physical buffer only for an explicitly opaque order-independent scope', () => {
  const cache = new MeshCommandCache(),
    buffer = {},
    page = {};
  const draw = (firstInstance: number) => ({
    mesh: {
      kind: 'path',
      buffer,
      count: 1,
      firstInstance,
      compactStroke: true,
      compactStrokeXY: true,
      pageSlice: { page, storageCount: 1, released: false },
    } as unknown as GpuMesh,
  });
  const draws = [draw(2), draw(0), draw(1)];
  cache.begin();
  const ordered = cache.select('stroke', draws, false);
  cache.end();
  expect(ordered.compiled.length).toBe(2);
  cache.begin();
  const grouped = cache.select('stroke', draws, true);
  cache.end();
  expect(grouped).not.toBe(ordered);
  expect(grouped.compiled.length).toBe(1);
  expect(grouped.compiled[0].mesh.count).toBe(3);
  expect(grouped.compiled[0].original).toBe(draws[1].mesh);
  // Validation and retirement still track ALL original members, not just a span leader.
  expect(grouped.draws.map((d) => d.mesh)).toEqual(draws.map((d) => d.mesh));
  cache.retire(draws[2].mesh);
  expect(cache.stats.entries).toBe(0);
  expect(cache.stats.dependencies).toBe(0);
});

it('groups only explicitly uniform fills and never traverses excluded triangle ranges', () => {
  const cache = new MeshCommandCache(),
    page = {},
    buffer = {};
  const a = {
    ...mesh(),
    buffer,
    firstIndex: 0,
    pageSlice: { page, storageCount: 6, released: false },
  } as GpuMesh;
  const b = {
    ...mesh(),
    buffer,
    firstIndex: 6,
    pageSlice: { page, storageCount: 6, released: false },
  } as GpuMesh;
  const c = { ...mesh(), buffer: {}, firstIndex: 0 } as GpuMesh;
  const draws = [{ mesh: b }, { mesh: c }, { mesh: a }];
  cache.begin();
  expect(cache.select('paint', draws).compiled).toHaveLength(3);
  cache.end();
  cache.begin();
  const grouped = cache.select('paint', draws, false, true);
  expect(grouped.compiled).toHaveLength(2);
  expect(grouped.compiled[0].mesh.count).toBe(12);
  cache.end();
  cache.begin();
  const excluded = cache.select(
    'paint',
    [{ mesh: a }, { mesh: c }, { mesh: b, indexRanges: [] }],
    false,
    true,
  );
  expect(excluded.compiled).toHaveLength(3);
  expect(excluded.draws[2].indexRanges).toEqual([]);
  cache.retire(b);
  expect(cache.stats.entries).toBe(0);
  expect(cache.stats.dependencies).toBe(0);
});

it('coalesces adjacent selected stroke spans without traversing invisible instances', () => {
  const cache = new MeshCommandCache(),
    page = {},
    buffer = {};
  const at = (firstInstance: number) =>
    ({
      kind: 'path',
      buffer,
      count: 10,
      firstInstance,
      compactStroke: true,
      pageSlice: { page, storageCount: 10, released: false },
    }) as GpuMesh;
  const a = at(0),
    b = at(10),
    c = at(20);
  cache.begin();
  const plan = cache.select(
    'stroke',
    [
      { mesh: a, ranges: [{ firstInstance: 5, count: 5 }] },
      {
        mesh: b,
        ranges: [
          { firstInstance: 0, count: 4 },
          { firstInstance: 7, count: 3 },
        ],
      },
      { mesh: c, ranges: [{ firstInstance: 0, count: 2 }] },
    ],
    true,
  );
  expect(plan.compiled).toHaveLength(1);
  expect(plan.compiled[0].ranges).toEqual([
    { firstInstance: 5, count: 9 },
    { firstInstance: 17, count: 5 },
  ]);
  expect(plan.compiled[0].mesh.count).toBe(30);
  expect(plan.compiled[0].original).toBe(a);
  cache.retire(b);
  expect(cache.stats.entries).toBe(0);
});

it('coalesces fill ranges while keeping padding and unselected triangles out', () => {
  const cache = new MeshCommandCache(),
    page = {},
    buffer = {};
  const at = (firstIndex: number, count: number) =>
    ({
      ...mesh(),
      buffer,
      firstIndex,
      count,
      pageSlice: { page, storageCount: Math.ceil(count / 6) * 6, released: false },
    }) as GpuMesh;
  const a = at(0, 9),
    b = at(12, 12),
    c = at(24, 6);
  cache.begin();
  const plan = cache.select(
    'fill',
    [{ mesh: a }, { mesh: b, indexRanges: [{ firstIndex: 6, indexCount: 6 }] }, { mesh: c }],
    false,
    true,
  );
  expect(plan.compiled).toHaveLength(1);
  expect(plan.compiled[0].indexRanges).toEqual([
    { firstIndex: 0, indexCount: 9 },
    { firstIndex: 18, indexCount: 12 },
  ]);
  expect(plan.compiled[0].mesh.logicalCount).toBe(27);
  expect(plan.compiled[0].mesh.count).toBe(30);
  cache.end();
  cache.begin();
  const gap = cache.select('fill', [{ mesh: a }, { mesh: c }], false, true);
  expect(gap.compiled).toHaveLength(2);
});
it('does not validate a bad local range against the larger compiled page span', () => {
  const cache = new MeshCommandCache(),
    page = {},
    buffer = {};
  const a = { ...mesh(), buffer, count: 6, pageSlice: { page, storageCount: 6 } } as GpuMesh;
  const b = { ...a, firstIndex: 6 };
  cache.begin();
  expect(() =>
    cache.select('fill', [
      { mesh: a, indexRanges: [{ firstIndex: 3, indexCount: 6 }] },
      { mesh: b },
    ]),
  ).toThrow('Invalid fill index range');
});

it('retains selected instance multiplicity over varied page gaps and fragmented ranges', () => {
  let seed = 1729;
  const random = (n: number) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
  for (let trial = 0; trial < 100; trial++) {
    const cache = new MeshCommandCache(),
      page = {},
      buffer = {};
    const draws = Array.from({ length: 12 }, (_, i) => ({
      mesh: {
        kind: 'path',
        buffer,
        count: 8,
        firstInstance: i * 8,
        compactStroke: true,
        pageSlice: { page, storageCount: 8, released: false },
      } as GpuMesh,
      ranges: random(3)
        ? Array.from({ length: random(4) }, () => {
            const firstInstance = random(8);
            return { firstInstance, count: 1 + random(8 - firstInstance) };
          })
        : undefined,
    })).filter(() => random(4) !== 0);
    const expand = (
      items: readonly {
        mesh: GpuMesh;
        ranges?: readonly { firstInstance: number; count: number }[] | null;
      }[],
    ) =>
      items
        .flatMap((d) =>
          (d.ranges ?? [{ firstInstance: 0, count: d.mesh.count }]).flatMap((r) =>
            Array.from(
              { length: r.count },
              (_, i) => (d.mesh.firstInstance ?? 0) + r.firstInstance + i,
            ),
          ),
        )
        .sort((a, b) => a - b);
    cache.begin();
    const plan = cache.select('stroke', draws, true);
    expect(expand(plan.compiled)).toEqual(expand(draws));
    cache.clear();
    expect(cache.stats.dependencies).toBe(0);
  }
});

it('keeps a cheaper padded full-span plan when partial coalescing would add draws', () => {
  const cache = new MeshCommandCache(),
    page = {},
    buffer = {};
  const at = (firstIndex: number) =>
    ({
      ...mesh(),
      buffer,
      firstIndex,
      count: 9,
      pageSlice: { page, storageCount: 12, released: false },
    }) as GpuMesh;
  cache.begin();
  const plan = cache.select(
    'fill',
    [
      { mesh: at(0) },
      { mesh: at(12) },
      { mesh: at(24), indexRanges: [{ firstIndex: 0, indexCount: 3 }] },
    ],
    false,
    true,
  );
  expect(plan.compiled).toHaveLength(2);
  expect(plan.compiled[0].indexRanges).toBeUndefined();
  expect(plan.compiled[0].mesh.count).toBe(21);
  expect(plan.compiled[0].mesh.logicalCount).toBe(18);
  expect(plan.compiled[1].indexRanges).toEqual([{ firstIndex: 0, indexCount: 3 }]);
});
