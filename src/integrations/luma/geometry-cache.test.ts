import { arcVisibilityFilter } from '../../domain/geo/arc-visibility';
import { describe, expect, it, vi } from 'vitest';
import { GeometryChunkCache } from './geometry-cache';
import { buildGeometryPacket } from '../../engine/rendering/luma/geometry-packet';
import type { GeometryInput } from '../../engine/rendering/luma/geometry-jobs';
import type { GpuRenderer } from './gpu-renderer';
function fixture(cacheBytes = 1024 ** 2, partitionCacheBytes?: number) {
  const gpu = {
    createMesh: vi.fn((g) => ({
      kind: g.kind,
      count: g.count,
      bytes: g.vertices.byteLength + (g.indices?.byteLength ?? 0),
    })),
    destroyMesh: vi.fn(),
  };
  const transport = {
    build: vi.fn(async (packet) => buildGeometryPacket(packet)),
    dispose: vi.fn(),
    stats: { workers: 0, jobs: 0, workerMs: 0, inputBytes: 0, peakInputBytes: 0 },
  };
  const report = vi.fn(),
    invalidate = vi.fn();
  const cache = new GeometryChunkCache(gpu as unknown as GpuRenderer, {
    workerUrl: new URL('http://example.test/worker.js'),
    transport,
    report,
    invalidate,
    cacheBytes,
    partitionCacheBytes,
  });
  const input: GeometryInput = {
    kind: 'point',
    shapes: [[[1, 1]], [[6, 6]], [[12, 12]]],
    interval: 0,
    bounds: [0, 0, 16, 16],
  };
  const frame = (value: GeometryInput = input, revision = 0) => {
    cache.begin();
    const r = cache.request(value, { id: 'p', sourceId: 's', revision });
    cache.finish();
    return r;
  };
  return { cache, gpu, transport, report, invalidate, input, frame };
}
describe('formal asynchronous chunk ownership', () => {
  it('reuses overlapping spatial chunks across navigation and releases all resources on disposal', async () => {
    const f = fixture(),
      first = f.frame();
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true), { timeout: 4000 });
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
    const second = f.frame({ ...f.input, ids: new Uint32Array([0, 1]) });
    await vi.waitFor(() => expect(f.cache.complete(second)).toBe(true));
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
    expect(f.cache.stats.cacheHits).toBe(2);
    f.cache.dispose();
    expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(3);
    expect(f.cache.stats.bytes).toBe(0);
    expect(f.cache.stats.partitionBytes).toBe(0);
    expect(f.transport.dispose).toHaveBeenCalledOnce();
  });
  it('detects in-place selection edits and does not let old requests restore a removed source', async () => {
    const f = fixture(),
      ids = new Uint32Array([0]);
    const first = f.frame({ ...f.input, ids });
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    ids[0] = 1;
    const next = f.frame({ ...f.input, ids });
    expect(next).not.toBe(first);
    f.cache.clear({ sourceId: 's' });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.cache.stats.entries).toBe(0);
    expect(f.cache.stats.pending).toBe(0);
    expect(f.report).not.toHaveBeenCalled();
    f.cache.dispose();
  });
  it('continues bounded preparation during navigation and coalesces progress notifications', async () => {
    const f = fixture();
    f.cache.setInteracting(true);
    const r = f.frame();
    await vi.waitFor(() => expect(f.cache.complete(r)).toBe(true), { timeout: 4000 });
    expect(f.transport.build).toHaveBeenCalledTimes(3);
    expect(f.cache.stats.interacting).toBe(true);
    await vi.waitFor(() => expect(f.invalidate).toHaveBeenCalled());
    expect(f.invalidate.mock.calls.length).toBeLessThanOrEqual(2);
    f.cache.setInteracting(false);
    f.cache.dispose();
  });
  it('enforces a hard working-set bound without dropping source members or entering an eviction loop', async () => {
    const f = fixture(1),
      r = f.frame();
    await vi.waitFor(() => expect(f.cache.failed(r)).toBe(true), { timeout: 4000 });
    const builds = f.transport.build.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(f.transport.build).toHaveBeenCalledTimes(builds);
    expect(f.gpu.createMesh).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledOnce();
    f.cache.dispose();
  });
  it('keeps source and layer invalidation scoped', async () => {
    const f = fixture();
    f.cache.begin();
    const a = f.cache.request(f.input, { id: 'a', sourceId: 'a', revision: 0 }),
      b = f.cache.request(f.input, { id: 'b', sourceId: 'b', revision: 0 });
    f.cache.finish();
    await vi.waitFor(() => expect(f.cache.complete(a) && f.cache.complete(b)).toBe(true), {
      timeout: 4000,
    });
    f.cache.clear({ sourceId: 'a' });
    expect(f.cache.complete(b)).toBe(true);
    expect(f.cache.stats.entries).toBe(3);
    f.cache.dispose();
  });
});

it('recovers a budget-rejected chunk after another owner releases memory, without repeated retries', async () => {
  const f = fixture(30);
  const a = { ...f.input, ids: Uint32Array.from([0]) },
    b = { ...f.input, ids: Uint32Array.from([1]) };
  f.cache.begin();
  const first = f.cache.request(a, { id: 'a', sourceId: 'a', revision: 0 }),
    second = f.cache.request(b, { id: 'b', sourceId: 'b', revision: 0 });
  f.cache.finish();
  await vi.waitFor(() => expect(f.cache.complete(first) && f.cache.complete(second)).toBe(true));
  const c = { ...f.input, ids: Uint32Array.from([2]) };
  f.cache.begin();
  f.cache.request(a, { id: 'a', sourceId: 'a', revision: 0 });
  f.cache.request(b, { id: 'b', sourceId: 'b', revision: 0 });
  const third = f.cache.request(c, { id: 'c', sourceId: 'c', revision: 0 });
  f.cache.finish();
  await vi.waitFor(() => expect(f.cache.failed(third)).toBe(true));
  f.cache.clear({ sourceId: 'a' });
  f.cache.clear({ sourceId: 'b' });
  f.cache.begin();
  const retry = f.cache.request(c, { id: 'c', sourceId: 'c', revision: 0 });
  f.cache.finish();
  await vi.waitFor(() => expect(f.cache.complete(retry)).toBe(true));
  f.cache.dispose();
});

it('notifies a drawable partial result before a deliberately slow later chunk finishes', async () => {
  const f = fixture();
  let release!: () => void;
  let count = 0;
  f.transport.build.mockImplementation(async (packet) => {
    if (++count === 2)
      await new Promise<void>((r) => {
        release = r;
      });
    return buildGeometryPacket(packet);
  });
  const request = f.frame();
  await vi.waitFor(() => expect(f.cache.drawable(request).length).toBe(1));
  await vi.waitFor(() => expect(f.invalidate).toHaveBeenCalled());
  expect(f.cache.complete(request)).toBe(false);
  release();
  await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
  f.cache.dispose();
});

it('uses a previous detail level only as provisional geometry, not as the completed new mesh', async () => {
  const f = fixture();
  const old = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(old)).toBe(true));
  const resident = f.cache.drawable(old);
  f.cache.pin(resident);
  let release!: () => void;
  f.transport.build.mockImplementationOnce(async (packet) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return buildGeometryPacket(packet);
  });
  const next = f.frame({ ...f.input, interval: 0.5 });
  await vi.waitFor(() => expect(typeof release).toBe('function'));
  expect(f.cache.complete(next)).toBe(false);
  expect(f.cache.drawable(next)).toEqual(resident);
  release();
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  expect(f.cache.drawable(next)[0]).not.toBe(resident[0]);
  f.cache.dispose();
});

it('lets a bounded compatible camera job finish rather than starving every refinement during navigation', async () => {
  const f = fixture(),
    releases: (() => void)[] = [];
  const arcs = {
    size: () => 1,
    getArcIter() {
      let i = 0;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (i === 2) return false;
          this.x = 1 + i++;
          this.y = 1;
          return true;
        },
      };
    },
  } as GeometryInput['arcs'];
  const path: GeometryInput = { kind: 'path', interval: 0, bounds: [0, 0, 16, 16], arcs };
  const screen = {
    view: [1, 1, 0, 0] as [number, number, number, number],
    width: 100,
    height: 100,
    pixelRatio: 1,
    initialScale: 0,
    smallArcs: false,
    halfPixel: true,
    cull: false,
    padding: 8,
    revision: 0,
  };
  f.transport.build.mockImplementation(async (packet, signal?: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      releases.push(resolve);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return buildGeometryPacket(packet);
  });
  f.frame({ ...path, screen });
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  const next = f.frame({ ...path, screen: { ...screen, view: [1, 1, 10, 0] } });
  await vi.waitFor(() => expect(next.entries).not.toBeNull());
  expect(f.cache.stats.cancellations).toBe(0);
  releases[0]();
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  expect(f.cache.complete(next)).toBe(false);
  expect(f.cache.drawable(next)).toHaveLength(1);
  expect(f.cache.drawable(next)[0].screenView).toEqual([1, 1, 0, 0]);
  releases[1]();
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  f.cache.dispose();
});

it('protects preceding-frame requests until every layer has registered its next draw slot', async () => {
  const f = fixture(70);
  const first = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  expect(f.cache.drawable(first)).toHaveLength(3);
  // A newly ready chunk need not have appeared in the preceding progressive
  // picture yet. The following point/overlay allocation happens before all
  // vector owners have called request() for this frame.
  f.cache.begin();
  f.cache.admitExternal(16);
  const next = f.cache.request(f.input, { id: 'p', sourceId: 's', revision: 0 });
  f.cache.finish();
  expect(f.cache.complete(next)).toBe(true);
  expect(f.cache.drawable(next)).toHaveLength(3);
  expect(f.gpu.destroyMesh).not.toHaveBeenCalled();
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
  f.cache.dispose();
});

it('does not report evicted request entries as complete and repairs their draw slots', async () => {
  const f = fixture();
  const first = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const stale = first.entries![0];
  // Model a lost resident resource independently of its request state.
  Reflect.get(f.cache, 'drop').call(f.cache, stale);
  expect(f.cache.complete(first)).toBe(false);
  const next = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  expect(f.cache.drawable(next)).toHaveLength(3);
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(4);
  f.cache.dispose();
});

it('reuses a resident full fill mesh when a smaller upload coverage is requested', async () => {
  const f = fixture();
  const path = [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
    [-10, -10],
  ];
  const input: GeometryInput = {
    kind: 'fill',
    interval: 0,
    bounds: [-10, -10, 10, 10],
    shapes: [[[0]]],
    arcs: {
      size: () => 1,
      getArcIter() {
        let i = 0;
        return {
          x: 0,
          y: 0,
          hasNext() {
            if (i === path.length) return false;
            [this.x, this.y] = path[i++];
            return true;
          },
        };
      },
    } as unknown as NonNullable<GeometryInput['arcs']>,
  };
  const first = f.frame(input);
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const near = f.frame({ ...input, viewBounds: [-1, -1, 1, 1], storageBounds: [-2, -2, 2, 2] });
  await vi.waitFor(() => expect(f.cache.complete(near)).toBe(true));
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(1);
  expect(f.cache.stats.cacheHits).toBeGreaterThan(0);
  f.cache.dispose();
});

it('does not scan eviction candidates below budget or notify forever for ready requests', async () => {
  const f = fixture(),
    request = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
  await new Promise((r) => setTimeout(r, 50));
  const notifications = f.invalidate.mock.calls.length;
  const entries = Reflect.get(f.cache, 'entries') as Map<string, unknown>,
    scan = vi.spyOn(entries, 'values');
  f.cache.admitExternal(0);
  expect(scan).not.toHaveBeenCalled();
  scan.mockRestore();
  f.frame();
  await new Promise((r) => setTimeout(r, 50));
  expect(f.transport.build).toHaveBeenCalledTimes(3);
  expect(f.invalidate.mock.calls.length).toBe(notifications);
  f.cache.dispose();
});
it('keeps the final completion notification even after an expensive partial frame', async () => {
  const f = fixture();
  f.cache.didPresent(500);
  const request = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
  await vi.waitFor(() => expect(f.invalidate).toHaveBeenCalled(), { timeout: 150 });
  f.cache.dispose();
});

it('reuses completed partition plans across LOD identities and releases them on source removal', async () => {
  const f = fixture();
  const first = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const alternate = f.frame({ ...f.input, shapes: [[[2, 2]], [[7, 7]], [[11, 11]]] });
  await vi.waitFor(() => expect(f.cache.complete(alternate)).toBe(true));
  expect(f.cache.stats.partitions).toBe(2);
  const restored = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(restored)).toBe(true));
  expect(f.cache.stats.partitions).toBe(2);
  expect(f.cache.stats.partitionHits).toBeGreaterThan(0);
  f.cache.clear({ sourceId: 's' });
  expect(f.cache.stats.partitionBytes).toBe(0);
  f.cache.dispose();
});

it('evicts inactive LOD plans when the metadata retention budget is exhausted', async () => {
  const f = fixture(1024 ** 2, 16);
  const a = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(a)).toBe(true));
  const b = f.frame({ ...f.input, shapes: [[[2, 2]], [[7, 7]], [[11, 11]]] });
  await vi.waitFor(() => expect(f.cache.complete(b)).toBe(true));
  // Once the new plan is ready, finish a frame so budget maintenance can run.
  f.frame(b.input);
  const again = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(again)).toBe(true));
  expect(f.cache.stats.partitions).toBe(3);
  f.cache.dispose();
  expect(f.cache.stats.partitionBytes).toBe(0);
});

it('skips housekeeping only for unchanged settled resident frames and rechecks pressure or membership', async () => {
  const f = fixture();
  const r = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(r)).toBe(true));
  f.frame();
  const before = f.cache.stats.maintenanceSkips;
  f.frame();
  f.frame();
  expect(f.cache.stats.maintenanceSkips).toBeGreaterThan(before);
  const skipped = f.cache.stats.maintenanceSkips;
  f.cache.begin(123);
  f.cache.request(f.input, { id: 'p', sourceId: 's', revision: 0 });
  f.cache.finish();
  expect(f.cache.stats.maintenanceSkips).toBe(skipped);
  const next = f.frame({ ...f.input, ids: new Uint32Array([1]) });
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  expect(f.cache.stats.maintenanceSkips).toBe(skipped);
  f.cache.begin();
  f.cache.finish();
  expect(f.cache.stats.entries).toBe(0);
  f.cache.clear();
  f.cache.dispose();
  expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(3);
});

it('batches small jobs after first feedback without changing logical meshes', async () => {
  const f = fixture();
  const buildBatch = vi.fn(async (packets: Parameters<typeof buildGeometryPacket>[0][]) =>
    packets.map((p) => ({ result: buildGeometryPacket(p) })),
  );
  Object.assign(f.transport, { buildBatch });
  const r = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(r)).toBe(true));
  expect(f.transport.build).toHaveBeenCalledTimes(1);
  expect(buildBatch).toHaveBeenCalledOnce();
  expect(buildBatch.mock.calls[0][0]).toHaveLength(2);
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
  expect(f.cache.stats.builds).toBe(3);
  f.cache.dispose();
  expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(3);
});
it('isolates one failed batch member while retaining the other completed member', async () => {
  const f = fixture();
  Object.assign(f.transport, {
    buildBatch: vi.fn(async (packets: Parameters<typeof buildGeometryPacket>[0][]) => [
      { error: 'bad geometry' },
      { result: buildGeometryPacket(packets[1]) },
    ]),
  });
  const r = f.frame();
  await vi.waitFor(() => expect(f.cache.failed(r)).toBe(true));
  expect(f.report).toHaveBeenCalledTimes(1);
  expect(f.cache.stats.builds).toBe(2);
  expect(f.cache.drawable(r)).toHaveLength(2);
  f.cache.dispose();
});

it('aborts a retired batch and rebuilds reselected members without stuck reserved cursors', async () => {
  const f = fixture();
  let wait = true;
  const buildBatch = vi.fn(
    (packets: Parameters<typeof buildGeometryPacket>[0][], signal: AbortSignal) => {
      if (!wait) return Promise.resolve(packets.map((p) => ({ result: buildGeometryPacket(p) })));
      wait = false;
      return new Promise<never>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      );
    },
  );
  Object.assign(f.transport, { buildBatch });
  f.frame();
  await vi.waitFor(() => expect(buildBatch).toHaveBeenCalledTimes(1));
  f.cache.clear({ sourceId: 's' });
  const next = f.frame(f.input, 1);
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  expect(f.cache.stats.pending).toBe(0);
  expect(f.report).not.toHaveBeenCalled();
  f.cache.dispose();
  expect(f.cache.stats.entries).toBe(0);
});

it("keeps parent requests out of each other's batch and dispatches their first jobs separately", async () => {
  const f = fixture();
  const buildBatch = vi.fn(async (packets: Parameters<typeof buildGeometryPacket>[0][]) =>
    packets.map((p) => ({ result: buildGeometryPacket(p) })),
  );
  Object.assign(f.transport, { buildBatch });
  const second: GeometryInput = {
    ...f.input,
    bounds: [100, 0, 116, 16],
    shapes: [[[101, 1]], [[106, 6]], [[112, 12]]],
  };
  f.cache.begin();
  const a = f.cache.request(f.input, { id: 'p', sourceId: 'a', revision: 0 });
  const b = f.cache.request(second, { id: 'p', sourceId: 'b', revision: 0 });
  f.cache.finish();
  await vi.waitFor(() => expect(f.cache.complete(a) && f.cache.complete(b)).toBe(true));
  expect(f.transport.build).toHaveBeenCalledTimes(2);
  expect(buildBatch).toHaveBeenCalledTimes(2);
  for (const [packets] of buildBatch.mock.calls) {
    const source = packets[0].coordinates[0] < 50;
    expect(packets.every((p) => p.coordinates[0] < 50 === source)).toBe(true);
  }
  f.cache.dispose();
  expect(f.cache.stats.bytes).toBe(0);
});

function threeUploadMeshes() {
  return {
    screenSpace: false,
    geometries: Array.from({ length: 3 }, () => ({
      kind: 'point' as const,
      vertices: new Float32Array(65536 * 4),
      count: 65536,
    })),
  };
}
it('yields within one multi-mesh result without publishing a partial entry', async () => {
  const f = fixture(16 * 1024 ** 2);
  f.transport.build.mockResolvedValueOnce(threeUploadMeshes());
  let observed: boolean | undefined;
  const create = f.gpu.createMesh.getMockImplementation()!;
  f.gpu.createMesh.mockImplementation((g) => {
    if (f.gpu.createMesh.mock.calls.length === 1)
      setTimeout(() => {
        observed = f.cache.complete(request);
      }, 0);
    return create(g);
  });
  const request = f.frame({ ...f.input, ids: new Uint32Array([0]) });
  await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
  expect(observed).toBe(false);
  expect(f.cache.stats.uploadYields).toBeGreaterThan(0);
  expect(f.cache.stats.peakResultBytes).toBe(3 * 1024 ** 2);
  expect(f.cache.stats.pendingUploadBytes).toBe(0);
  expect(f.cache.drawable(request)[0].meshes).toHaveLength(3);
  f.cache.dispose();
  expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(3);
});
it('source retirement during a result upload cancels the remaining meshes and rolls back its reservation', async () => {
  const f = fixture(16 * 1024 ** 2);
  f.transport.build.mockResolvedValueOnce(threeUploadMeshes());
  const create = f.gpu.createMesh.getMockImplementation()!;
  f.gpu.createMesh.mockImplementation((g) => {
    if (f.gpu.createMesh.mock.calls.length === 1)
      setTimeout(() => f.cache.clear({ sourceId: 's' }), 0);
    return create(g);
  });
  f.frame({ ...f.input, ids: new Uint32Array([0]) });
  await vi.waitFor(() => expect(f.gpu.destroyMesh).toHaveBeenCalled());
  expect(f.gpu.createMesh.mock.calls.length).toBeLessThan(3);
  expect(f.gpu.destroyMesh.mock.calls.length).toBe(f.gpu.createMesh.mock.calls.length);
  expect(f.cache.stats.bytes).toBe(0);
  expect(f.cache.stats.pendingUploadBytes).toBe(0);
  expect(f.report).not.toHaveBeenCalled();
  f.cache.dispose();
});
it('failed partial uploads release their buffers and never leave a ready entry or charged payload', async () => {
  const f = fixture(16 * 1024 ** 2);
  f.transport.build.mockResolvedValueOnce(threeUploadMeshes());
  const create = f.gpu.createMesh.getMockImplementation()!;
  f.gpu.createMesh.mockImplementation((g) => {
    if (f.gpu.createMesh.mock.calls.length === 3) throw new Error('upload failed');
    return create(g);
  });
  const request = f.frame({ ...f.input, ids: new Uint32Array([0]) });
  await vi.waitFor(() => expect(f.cache.failed(request)).toBe(true));
  expect(f.cache.drawable(request)).toHaveLength(0);
  expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(2);
  expect(f.cache.stats.pendingUploadBytes).toBe(0);
  expect(f.cache.stats.bytes).toBe(8); // source member and point component metadata only
  f.cache.dispose();
  expect(f.cache.stats.bytes).toBe(0);
});

it('reuses containing fill coverage only at identical membership and detail', async () => {
  const f = fixture();
  const vertices = [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
    [-10, -10],
  ];
  const input: GeometryInput = {
    kind: 'fill',
    interval: 0,
    bounds: [-10, -10, 10, 10],
    shapes: [[[0]]],
    storageBounds: [-8, -8, 8, 8],
    arcs: {
      size: () => 1,
      getArcIter() {
        let i = 0;
        return {
          x: 0,
          y: 0,
          hasNext() {
            if (i === vertices.length) return false;
            [this.x, this.y] = vertices[i++];
            return true;
          },
        };
      },
    } as unknown as GeometryInput['arcs'],
  };
  const a = f.frame(input);
  await vi.waitFor(() => expect(f.cache.complete(a)).toBe(true));
  const b = f.frame({ ...input, storageBounds: [-3, -3, 3, 3] });
  await vi.waitFor(() => expect(f.cache.complete(b)).toBe(true));
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(1);
  expect(f.cache.stats.coverageHits).toBeGreaterThan(0);
  const c = f.frame({ ...input, storageBounds: [-9, -9, 9, 9] });
  await vi.waitFor(() => expect(f.cache.complete(c)).toBe(true));
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
  const d = f.frame({ ...input, interval: 0.5, storageBounds: [-2, -2, 2, 2] });
  await vi.waitFor(() => expect(f.cache.complete(d)).toBe(true));
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
  f.cache.dispose();
});

/** Three overlapping selections in one stable spatial chunk, plus a new chunk. */
function handoffInput(kind: 'point' | 'path' | 'fill'): GeometryInput {
  const points = [
    [1.1, 1.1],
    [1.2, 1.1],
    [1.3, 1.1],
    [0.1, 0.1],
  ];
  const rings = points.map(([x, y]) => [
    [x, y],
    [x + 0.02, y],
    [x + 0.02, y + 0.02],
    [x, y + 0.02],
    [x, y],
  ]);
  const arcs = {
    size: () => rings.length,
    getArcIter(id: number) {
      const ring = rings[id < 0 ? ~id : id];
      let at = 0;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (at === ring.length) return false;
          [this.x, this.y] = ring[at++];
          return true;
        },
      };
    },
  } as GeometryInput['arcs'];
  return {
    kind,
    bounds: [0, 0, 16, 16],
    interval: 0,
    ...(kind === 'point' ? { shapes: points.map((p) => [p]) } : { arcs }),
    ...(kind === 'fill' ? { shapes: rings.map((_, i) => [[i]]) } : {}),
  };
}

it.each([
  'point',
  'path',
  'fill',
] as const)('retains the displayed %s chunk across changed camera membership until its replacement is ready', async (kind) => {
  const f = fixture(),
    input = handoffInput(kind);
  const old = f.frame({ ...input, ids: Uint32Array.of(0, 1) });
  await vi.waitFor(() => expect(f.cache.complete(old)).toBe(true));
  const displayed = f.cache.drawable(old);
  expect(displayed).toHaveLength(1);
  f.cache.pin(displayed);
  let release!: () => void;
  f.transport.build.mockImplementationOnce(async (packet) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return buildGeometryPacket(packet);
  });
  const next = f.frame({ ...input, ids: Uint32Array.of(1, 2), viewBounds: [0, 0, 2, 2] });
  try {
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(next.entries?.[0].job.members).toEqual(Int32Array.of(1, 2));
    expect(f.cache.complete(next)).toBe(false);
    expect(f.cache.drawable(next)).toEqual(displayed);
    expect(f.gpu.destroyMesh).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)).toEqual(next.entries);
    expect(f.cache.drawable(next)).toHaveLength(1);
    expect(f.cache.drawable(next)).not.toContain(displayed[0]);
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('presents an independent new chunk while retaining a pending overlapping chunk without double drawing', async () => {
  const f = fixture(),
    input = handoffInput('fill');
  const old = f.frame({ ...input, ids: Uint32Array.of(0, 1) });
  await vi.waitFor(() => expect(f.cache.complete(old)).toBe(true));
  const displayed = f.cache.drawable(old);
  f.cache.pin(displayed);
  let release!: () => void,
    calls = 0;
  f.transport.build.mockImplementation(async (packet) => {
    if (++calls === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return buildGeometryPacket(packet);
  });
  const next = f.frame({ ...input, ids: Uint32Array.of(1, 2, 3) });
  try {
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    const shown = f.cache.drawable(next);
    expect(shown).toHaveLength(2);
    expect(shown[0].job.members).toEqual(Int32Array.of(3));
    expect(shown[1]).toBe(displayed[0]);
    release();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    const members = f.cache.drawable(next).flatMap((e) => [...e.job.members]);
    expect(members).toEqual([3, 1, 2]);
    expect(new Set(members).size).toBe(members.length);
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('does not inherit camera fallback across changed content even when the preceding selection key was unchanged', async () => {
  const f = fixture(),
    input = handoffInput('fill');
  const frame = (content: string, ids: number[]) => {
    f.cache.begin();
    const r = f.cache.request(
      { ...input, ids: Uint32Array.from(ids) },
      { id: 'p', sourceId: 's', revision: 0, content },
    );
    f.cache.finish();
    return r;
  };
  try {
    const first = frame('red', [0, 1]);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const changed = frame('blue', [0, 1]);
    expect(changed).not.toBe(first);
    await vi.waitFor(() => expect(f.cache.complete(changed)).toBe(true));
    // A second content change must not accidentally match the obsolete owner.
    const next = frame('red', [1, 2]);
    expect(next.fallback?.length ?? 0).toBe(0);
    expect(f.cache.drawable(next)).toHaveLength(0);
  } finally {
    f.cache.dispose();
  }
});

it('keeps the same paint slot when an earlier visible expression bucket disappears', async () => {
  const f = fixture(),
    input = handoffInput('fill');
  const owner = { id: 'p', sourceId: 's', revision: 0 };
  const frame = (red: boolean) => {
    f.cache.begin();
    if (red) f.cache.request({ ...input, ids: Uint32Array.of(0) }, { ...owner, content: 'red' });
    const blue = f.cache.request(
      { ...input, ids: Uint32Array.of(1, 2) },
      { ...owner, content: 'blue' },
    );
    f.cache.finish();
    return blue;
  };
  try {
    const first = frame(true);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const next = frame(false);
    expect(next).toBe(first);
    expect(f.cache.complete(next)).toBe(true);
    expect(f.cache.drawable(next).flatMap((e) => [...e.job.members])).toEqual([1, 2]);
  } finally {
    f.cache.dispose();
  }
});

it('carries the displayed chunk through repeated superseded camera requests, then releases it after handoff', async () => {
  const f = fixture(160),
    input = handoffInput('point');
  const first = f.frame({ ...input, ids: Uint32Array.of(0, 1) });
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const displayed = f.cache.drawable(first);
  // Do not pin: a replacement upload must also protect unpresented fallback.
  const releases: (() => void)[] = [];
  f.transport.build.mockImplementation(async (packet, signal?: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      releases.push(resolve);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return buildGeometryPacket(packet);
  });
  try {
    const second = f.frame({ ...input, ids: Uint32Array.of(1, 2) });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(f.cache.drawable(second)).toEqual(displayed);
    const third = f.frame({ ...input, ids: Uint32Array.of(0, 2) });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    // This would evict the old chunk without protecting the presentation set.
    f.cache.admitExternal(145);
    expect(f.cache.drawable(third)).toEqual(displayed);
    expect(f.gpu.destroyMesh).not.toHaveBeenCalled();
    releases[1]();
    await vi.waitFor(() => expect(f.cache.complete(third)).toBe(true));
    f.frame({ ...input, ids: Uint32Array.of(0, 2) });
    expect(third.fallback).toBeUndefined();
    f.cache.admitExternal(145);
    expect(f.cache.drawable(third)).toEqual(third.entries);
    expect(f.gpu.destroyMesh).toHaveBeenCalled();
    expect(f.cache.stats.budgetBytes).toBe(160);
  } finally {
    for (const release of releases) release();
    f.cache.dispose();
  }
});

it('keeps ordered repeated-chunk runs atomic while their replacement is incomplete', async () => {
  const f = fixture(),
    input = {
      ...handoffInput('point'),
      ordered: true,
      shapes: Array.from({ length: 4097 }, () => [[1, 1]]),
    };
  const first = f.frame({ ...input, ids: Uint32Array.of(0, 4096, 1) });
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const displayed = f.cache.drawable(first);
  let release!: () => void;
  f.transport.build.mockImplementationOnce(async (packet) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return buildGeometryPacket(packet);
  });
  try {
    const next = f.frame({
      ...input,
      ids: Uint32Array.of(1, 4096, 2),
      components: Uint32Array.of(0, 0, 0),
    });
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(f.cache.drawable(next)).toEqual(displayed);
    release();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)).toEqual(next.entries);
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it.each([
  'fill',
  'path',
] as const)('retains %s coverage through an LOD partition split without alpha overlap', async (kind) => {
  const f = fixture();
  const arcs = (coarse: boolean) =>
    ({
      size: () => 2,
      getArcIter(id: number) {
        const x = id === 0 ? 1.99 : 2.02,
          width = id === 0 && coarse ? 0.008 : 0.02;
        const ring = [
          [x, 1.1],
          [x + width, 1.1],
          [x + width, 1.12],
          [x, 1.12],
          [x, 1.1],
        ];
        let i = 0;
        return {
          x: 0,
          y: 0,
          hasNext() {
            if (i === ring.length) return false;
            [this.x, this.y] = ring[i++];
            return true;
          },
        };
      },
    }) as GeometryInput['arcs'];
  const input: GeometryInput = {
    kind,
    interval: 0,
    bounds: [0, 0, 16, 16],
    arcs: arcs(false),
    ...(kind === 'fill' ? { shapes: [[[0]], [[1]]] } : {}),
  };
  const first = f.frame(input);
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const displayed = f.cache.drawable(first);
  expect(displayed).toHaveLength(1);
  let calls = 0,
    release!: () => void;
  f.transport.build.mockImplementation(async (packet) => {
    if (++calls === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return buildGeometryPacket(packet);
  });
  try {
    const next = f.frame({ ...input, arcs: arcs(true) });
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(next.entries).toHaveLength(2);
    expect(next.entries![0].state).toBe('ready');
    expect(f.cache.drawable(next)).toEqual(displayed);
    expect(f.cache.complete(next)).toBe(false);
    release();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)).toEqual(next.entries);
    expect(f.cache.drawable(next).flatMap((e) => [...e.job.members])).toEqual([0, 1]);
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('does not treat equal-valued source bounds from another dataset as LOD continuity', async () => {
  const f = fixture(),
    input = handoffInput('fill');
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const next = f.frame({ ...input, arcs: { ...input.arcs! }, bounds: [...input.bounds] });
    expect(next.fallback).toBeUndefined();
    expect(f.cache.drawable(next)).toHaveLength(0);
  } finally {
    f.cache.dispose();
  }
});

it('reuses source membership and full interior fill chunks across camera storage windows', async () => {
  const f = fixture(4096),
    input = { ...handoffInput('fill'), sourceSelection: true };
  try {
    const first = f.frame({ ...input, viewBounds: [1, 1, 2, 2], storageBounds: [1, 1, 2, 2] });
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const shown = f.cache.drawable(first),
      builds = f.cache.stats.builds;
    expect(shown).toHaveLength(1);
    expect(shown[0].coverage).toBeUndefined();
    for (const x of [0.9, 1, 0.8]) {
      const next = f.frame({
        ...input,
        viewBounds: [x, 1, x + 1, 2],
        storageBounds: [x, 1, x + 1, 2],
      });
      await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
      expect(f.cache.drawable(next)).toEqual(shown);
    }
    expect(f.cache.stats.builds).toBe(builds);
    expect(f.cache.stats.selectionBuilds).toBe(1);
    expect(f.cache.stats.selectionHits).toBe(3);
    expect(f.cache.stats.budgetBytes).toBe(4096);
    f.cache.clear({ sourceId: 's' });
    expect(f.cache.stats.selectionCacheBytes).toBe(0);
  } finally {
    f.cache.dispose();
  }
});

it('does not reuse stable source membership after in-place ID edits or source revision changes', async () => {
  const f = fixture(),
    ids = Uint32Array.of(0, 1),
    input = { ...handoffInput('fill'), sourceSelection: true, ids };
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    ids[0] = 2;
    const second = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(second)).toBe(true));
    expect(f.cache.drawable(second).flatMap((e) => [...e.job.members])).toEqual([2, 1]);
    expect(f.cache.stats.selectionBuilds).toBe(2);
    const third = f.frame(input, 1);
    await vi.waitFor(() => expect(f.cache.complete(third)).toBe(true));
    expect(f.cache.stats.selectionBuilds).toBe(3);
  } finally {
    f.cache.dispose();
  }
});

it('reports queued work behind a failure and still completes independent members', async () => {
  const f = fixture();
  let release!: () => void;
  f.transport.build.mockRejectedValueOnce(new Error('isolated decode failure'));
  f.transport.build.mockImplementationOnce(async (packet) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return buildGeometryPacket(packet);
  });
  try {
    const r = f.frame();
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(f.cache.stats.failedEntries).toBe(1);
    expect(f.cache.stats.pending).toBeGreaterThan(0);
    expect(f.cache.stats.building).toBe(1);
    release();
    await vi.waitFor(() => expect(f.cache.stats.builds).toBe(2));
    expect(f.cache.complete(r)).toBe(false);
    expect(f.cache.stats.failedRequests).toBe(1);
    expect(f.cache.stats.queued).toBe(0);
    expect(f.report).toHaveBeenCalledOnce();
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('caches the interior arc selection and only tests boundary chunks during navigation', async () => {
  const f = fixture(),
    input = { ...handoffInput('path'), sourceSelection: true };
  const small = vi.fn(() => false),
    intersects = vi.fn((id: number, b: number[]) => (id === 3 ? b[0] <= 0.12 : b[0] <= 1.32));
  Object.assign(input.arcs!, { arcIsSmaller: small, arcIntersectsBBox: intersects });
  try {
    const first = f.frame({
      ...input,
      viewBounds: [0, 0, 3, 3],
      filter: arcVisibilityFilter(input.arcs!, 0.1, [0, 0, 3, 3]),
    });
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    small.mockClear();
    intersects.mockClear();
    const second = f.frame({
      ...input,
      viewBounds: [-0.1, -0.1, 3, 3],
      filter: arcVisibilityFilter(input.arcs!, 0.1, [-0.1, -0.1, 3, 3]),
    });
    await vi.waitFor(() => expect(f.cache.complete(second)).toBe(true));
    expect(small).not.toHaveBeenCalled();
    expect(intersects).not.toHaveBeenCalled();
    expect(f.cache.stats.selectionHits).toBe(1);
    const third = f.frame({
      ...input,
      viewBounds: [1, 1, 3, 3],
      filter: arcVisibilityFilter(input.arcs!, 0.1, [1, 1, 3, 3]),
    });
    await vi.waitFor(() => expect(f.cache.complete(third)).toBe(true));
    expect(f.cache.drawable(third).flatMap((e) => [...e.job.members])).toEqual([0, 1, 2]);
    expect(f.cache.stats.selectionBuilds).toBe(1);
  } finally {
    f.cache.dispose();
  }
});

it('isolates concurrent stable selections with the same paint but different draw slots', async () => {
  const f = fixture(),
    input = { ...handoffInput('fill'), sourceSelection: true };
  try {
    f.cache.begin();
    const a = f.cache.request(
      { ...input, ids: Uint32Array.of(0) },
      { id: 'p', sourceId: 's', revision: 0 },
    );
    const b = f.cache.request(
      { ...input, ids: Uint32Array.of(1) },
      { id: 'p', sourceId: 's', revision: 0 },
    );
    f.cache.finish();
    await vi.waitFor(() => expect(f.cache.complete(a) && f.cache.complete(b)).toBe(true));
    expect(f.cache.drawable(a).flatMap((e) => [...e.job.members])).toEqual([0]);
    expect(f.cache.drawable(b).flatMap((e) => [...e.job.members])).toEqual([1]);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('finishes a bounded compatible boundary refinement instead of restarting the geometry Worker', async () => {
  const f = fixture(),
    input = { ...handoffInput('path'), sourceSelection: true };
  const xs = [1.1, 1.2, 1.3, 0.1];
  Object.assign(input.arcs!, {
    arcIntersectsBBox: (id: number, b: number[]) => xs[id] >= b[0] && xs[id] <= b[2],
  });
  const releases: (() => void)[] = [];
  f.transport.build.mockImplementation(async (packet, signal?: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      releases.push(resolve);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return buildGeometryPacket(packet);
  });
  try {
    f.frame({
      ...input,
      viewBounds: [1, 1, 1.25, 1.3],
      filter: arcVisibilityFilter(input.arcs!, 0, [1, 1, 1.25, 1.3]),
    });
    await vi.waitFor(() => expect(releases.length).toBe(1));
    const next = f.frame({
      ...input,
      viewBounds: [1.15, 1, 1.4, 1.3],
      filter: arcVisibilityFilter(input.arcs!, 0, [1.15, 1, 1.4, 1.3]),
    });
    await vi.waitFor(() => expect(next.entries).not.toBeNull());
    expect(f.cache.stats.cancellations).toBe(0);
    releases[0]();
    await vi.waitFor(() => expect(releases.length).toBe(2));
    releases[1]();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next).flatMap((e) => [...e.job.members])).toEqual([1, 2]);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    for (const release of releases) release();
    f.cache.dispose();
  }
});

it('bounds empty completed membership cache entries across many detail keys', async () => {
  const f = fixture(),
    input = { ...handoffInput('path'), sourceSelection: true, ids: new Uint32Array(0) };
  try {
    for (let detail = 0; detail < 140; detail++) {
      const r = f.frame({ ...input, filter: arcVisibilityFilter(input.arcs!, detail, null) });
      await vi.waitFor(() => expect(f.cache.complete(r)).toBe(true), {
        interval: 1,
        timeout: 1000,
      });
    }
    expect(Reflect.get(f.cache, 'selections').size).toBeLessThanOrEqual(128);
    expect(f.cache.stats.selectionCacheBytes).toBe(0);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});
