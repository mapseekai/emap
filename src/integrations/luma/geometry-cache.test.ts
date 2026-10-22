import { arcVisibilityFilter } from '../../domain/geo/arc-visibility';
import { describe, expect, it, vi } from 'vitest';
import { GeometryChunkCache, type GeometryEntry, type GeometryRequest } from './geometry-cache';
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
    stats: {
      messages: 0,
      batchedJobs: 0,
      maxBatchJobs: 0,
      workers: 0,
      jobs: 0,
      workerMs: 0,
      inputBytes: 0,
      peakInputBytes: 0,
    },
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
  it('evicts an unpresented intermediate layer when a newer detail replaces it', async () => {
    const f = fixture(352 * 1.05);
    const shapes = [
      Array.from({ length: 14 }, () => [1, 1]),
      Array.from({ length: 7 }, () => [6, 6]),
    ];
    const input = { ...f.input, shapes, wholeLayer: true };
    const frame = (interval: number) => {
      f.cache.begin();
      const requests = [0, 1].map((id) =>
        f.cache.request(
          { ...input, interval, ids: Uint32Array.of(id) },
          {
            id: 'layer',
            sourceId: 'source',
            revision: 0,
            content: String(id),
          },
        ),
      );
      f.cache.finish();
      return requests;
    };
    let release!: () => void;
    try {
      const first = frame(0);
      await vi.waitFor(() => expect(first.every((r) => f.cache.complete(r))).toBe(true));
      const displayed = first.flatMap((r) => f.cache.drawable(r));
      expect(f.cache.stats.bytes).toBe(352);
      f.cache.pin(displayed);
      let calls = 0;
      f.transport.build.mockImplementation(async (packet) => {
        if (++calls === 2)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return buildGeometryPacket(packet);
      });
      Reflect.set(f.cache, 'turn', 0);
      const intermediate = frame(1);
      await vi.waitFor(() => expect(typeof release).toBe('function'));
      expect(f.cache.complete(intermediate[0])).toBe(true);
      const unused = intermediate[0].entries![0];
      const latest = frame(2);
      await vi.waitFor(() => expect(latest.every((r) => r.entries !== null)).toBe(true));
      release();
      await vi.waitFor(() => expect(latest.every((r) => f.cache.complete(r))).toBe(true));
      expect(f.cache.isResident(unused)).toBe(false);
      expect(displayed.every((entry) => f.cache.isResident(entry))).toBe(true);
      expect(f.report).not.toHaveBeenCalled();
    } finally {
      release?.();
      f.cache.dispose();
    }
  });
  it('presents a whole layer only after all bounded preparation jobs are ready', async () => {
    const f = fixture();
    const input = {
      ...f.input,
      wholeLayer: true,
      shapes: Array.from({ length: 9000 }, (_, i) => [[i, i]]),
      bounds: [0, 0, 9000, 9000] as const,
    };
    let release!: () => void;
    let count = 0;
    f.transport.build.mockImplementation(async (packet) => {
      if (++count === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return buildGeometryPacket(packet);
    });
    const request = f.frame(input);
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(f.cache.complete(request)).toBe(false);
    expect(f.cache.drawable(request)).toEqual([]);
    release();
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    const previous = f.cache.drawable(request);
    f.cache.pin(previous);
    count = 0;
    const next = f.frame({ ...input, interval: 1 });
    await vi.waitFor(() => expect(count).toBe(2));
    expect(f.cache.drawable(next)).toEqual(previous);
    release();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)).toEqual(next.entries);
    expect(f.cache.drawable(next).some((entry) => previous.includes(entry))).toBe(false);
    f.cache.dispose();
  });
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

it('does not inherit a budget retry marker when the retry encounters a real Worker failure', async () => {
  const f = fixture(30),
    input = (id: number) => ({ ...f.input, ids: Uint32Array.of(id) });
  try {
    f.cache.begin();
    const first = f.cache.request(input(0), { id: 'a', sourceId: 'a', revision: 0 }),
      second = f.cache.request(input(1), { id: 'b', sourceId: 'b', revision: 0 });
    f.cache.finish();
    await vi.waitFor(() => expect(f.cache.complete(first) && f.cache.complete(second)).toBe(true));
    f.cache.begin();
    f.cache.request(input(0), { id: 'a', sourceId: 'a', revision: 0 });
    f.cache.request(input(1), { id: 'b', sourceId: 'b', revision: 0 });
    const third = f.cache.request(input(2), { id: 'c', sourceId: 'c', revision: 0 });
    f.cache.finish();
    await vi.waitFor(() => expect(f.cache.failed(third)).toBe(true));
    f.cache.finish();
    await vi.waitFor(() => expect(f.report).toHaveBeenCalledOnce());
    f.cache.clear({ sourceId: 'a' });
    f.cache.clear({ sourceId: 'b' });
    f.transport.build.mockRejectedValueOnce(new Error('Worker reconstruction failed'));
    f.cache.begin();
    const retry = f.cache.request(input(2), { id: 'c', sourceId: 'c', revision: 0 });
    f.cache.finish();
    await vi.waitFor(() => expect(f.report).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.cache.failed(retry)).toBe(true);
    expect(f.transport.build).toHaveBeenCalledTimes(4);
    expect(f.report.mock.lastCall?.[0].message).toBe('Worker reconstruction failed');
  } finally {
    f.cache.dispose();
  }
});

it.each([
  false,
  true,
])('waits for progressive presentation capacity without reporting or rebuilding temporary admission failures (pending plan: %s)', async (delayedPlan) => {
  const f = fixture(104),
    input = {
      ...f.input,
      shapes: [1, 9, 17, 25].map((n) => [
        [n, n],
        [n + 0.1, n + 0.1],
      ]),
      bounds: [0, 0, 32, 32] as const,
    };
  let interval = 0;
  let planning = false;
  let previous: ReturnType<typeof f.cache.drawable> = [];
  let request: ReturnType<typeof f.cache.request>;
  const draw = () => {
    f.cache.begin();
    request = f.cache.request({ ...input, interval }, { id: 'p', sourceId: 's', revision: 0 });
    f.cache.pin(planning ? previous : f.cache.drawable(request), planning);
    f.cache.finish();
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(208);
  };
  f.invalidate.mockImplementation(draw);
  try {
    draw();
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    draw();
    expect(f.cache.stats.bytes).toBe(160);
    previous = f.cache.drawable(request!);
    f.transport.build.mockImplementation(async (packet) => {
      const result = buildGeometryPacket(packet);
      result.geometries = result.geometries.map((g) => ({
        ...g,
        vertices: new Float32Array(4),
        count: 1,
      }));
      return result;
    });
    interval = 1;
    planning = delayedPlan;
    draw();
    if (delayedPlan) {
      await vi.waitFor(() => expect(f.transport.build).toHaveBeenCalledTimes(6));
      for (let i = 0; i < 3; i++) draw();
      expect(f.report).not.toHaveBeenCalled();
      expect(f.transport.build).toHaveBeenCalledTimes(6);
      planning = false;
      draw();
    }
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    draw();
    expect(f.transport.build).toHaveBeenCalledTimes(8);
    expect(f.cache.stats.bytes).toBe(96);
    expect(f.cache.stats.failedEntries).toBe(0);
    expect(f.report).not.toHaveBeenCalled();
    expect(f.cache.stats.errors).toBe(0);
  } finally {
    f.cache.dispose();
  }
});

it.each([
  'success',
  'same-text worker failure',
] as const)('defers payload admission after an early presentation wake while another owner can retire memory (%s)', async (outcome) => {
  const f = fixture(164),
    input = {
      ...f.input,
      shapes: [1, 9, 17, 25].map((n) => [
        [n, n],
        [n + 0.1, n + 0.1],
      ]),
      bounds: [0, 0, 32, 32] as const,
    },
    holderInput = {
      ...f.input,
      wholeLayer: true,
      ordered: true,
      shapes: [[6, 6.1, 6.2, 6.3].map((n) => [n, n])],
    };
  let interval = 0,
    finishing = false,
    wakeups = 0;
  let previous: GeometryEntry[] = [];
  let request: GeometryRequest, holder: GeometryRequest;
  let release: (() => void) | undefined;
  const draw = () => {
    f.cache.begin();
    request = f.cache.request({ ...input, interval }, { id: 'p', sourceId: 's', revision: 0 });
    holder = f.cache.request(
      { ...holderInput, interval },
      { id: 'holder', sourceId: 's', revision: 0 },
    );
    const waiting = interval && !f.cache.complete(holder);
    if (waiting) wakeups++;
    f.cache.pin([...(waiting ? previous : f.cache.drawable(request)), ...f.cache.drawable(holder)]);
    finishing = true;
    f.cache.finish();
    finishing = false;
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(328);
  };
  f.invalidate.mockImplementation(draw);
  f.report.mockImplementation(() => expect(finishing).toBe(false));
  try {
    draw();
    await vi.waitFor(() =>
      expect(f.cache.complete(request) && f.cache.complete(holder)).toBe(true),
    );
    draw();
    expect(f.cache.stats.bytes).toBe(232);
    previous = f.cache.drawable(request!);
    f.transport.build.mockImplementation(async (packet) => {
      if (packet.coordinates[0] !== 6) return buildGeometryPacket(packet);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (outcome === 'same-text worker failure')
        throw new RangeError(
          'Visible GPU geometry exceeds the bounded working-set limit; zoom in or hide layers. Source data was not simplified or truncated.',
        );
      return {
        ...buildGeometryPacket(packet),
        geometries: [{ kind: 'point', vertices: new Float32Array(4), count: 1 }],
      };
    });
    interval = 1;
    draw();
    await vi.waitFor(() => {
      expect(release).toBeTypeOf('function');
      expect(request.entries?.filter((entry) => entry.requiredBytes !== undefined)).toHaveLength(3);
    });
    expect(wakeups).toBeGreaterThan(1);
    expect(f.report).not.toHaveBeenCalled();
    const builds = f.transport.build.mock.calls.length;
    for (let i = 0; i < 3; i++) draw();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.transport.build).toHaveBeenCalledTimes(builds);
    expect(f.report).not.toHaveBeenCalled();
    release!();
    if (outcome === 'success') {
      await vi.waitFor(() =>
        expect(f.cache.complete(request) && f.cache.complete(holder)).toBe(true),
      );
      draw();
      expect(f.report).not.toHaveBeenCalled();
      expect(f.cache.stats.errors).toBe(0);
      expect(f.cache.stats.bytes).toBe(184);
      expect(f.transport.build).toHaveBeenCalledTimes(builds + 3);
    } else {
      await vi.waitFor(() => expect(f.report).toHaveBeenCalledTimes(4));
      for (let i = 0; i < 3; i++) draw();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(f.report).toHaveBeenCalledTimes(4);
      expect(f.transport.build).toHaveBeenCalledTimes(builds);
    }
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('schedules a cold known-cost owner whose capacity requires unpublished foreign payload rollback', async () => {
  const f = fixture(50),
    owner = (id: string) => ({ id, sourceId: 's', revision: 0 }),
    entry = (
      id: string,
      layer: string,
      chunk: number,
      bytes: number,
      requiredBytes?: number,
    ): GeometryEntry => ({
      id,
      family: id,
      partition: 'p',
      owner: owner(layer),
      job: { chunk, members: Int32Array.of(chunk) },
      state: requiredBytes === undefined ? 'ready' : 'error',
      meshes: [],
      ranges: [],
      fillRanges: [],
      screenSpace: false,
      bytes,
      used: 0,
      ...(requiredBytes === undefined ? {} : { requiredBytes, error: new RangeError('capacity') }),
    }),
    old = entry('old-a', 'a', 0, 60),
    prefix = entry('prefix-a', 'a', 0, 24),
    blocked = entry('blocked-a', 'a', 1, 4, 20),
    cold = entry('cold-c', 'c', 0, 4, 16),
    request = (
      id: string,
      entries: GeometryEntry[],
      fallback?: GeometryEntry[],
    ): GeometryRequest => ({
      owner: owner(id),
      input: {
        ...f.input,
        wholeLayer: true,
        shapes: id === 'a' ? [[[1, 1]], [[2, 2]]] : [[[3, 3]]],
      },
      plan: {
        key: 'p',
        ready: true,
        count: 2,
        boundsBytes: 0,
        sourceId: 's',
        revision: 0,
        used: 0,
        controller: new AbortController(),
        promise: Promise.resolve({ chunks: 2, membership: Uint32Array.of(0, 1) }),
      },
      key: id,
      frame: 0,
      cursor: 0,
      controller: new AbortController(),
      entries,
      fallback,
    }),
    atomic = request('a', [prefix, blocked], [old]),
    next = request('c', [cold]);
  Reflect.set(f.cache, 'entries', new Map([old, prefix, blocked, cold].map((e) => [e.id, e])));
  Reflect.set(
    f.cache,
    'requests',
    new Map([
      ['a', atomic],
      ['c', next],
    ]),
  );
  Reflect.set(f.cache, 'bytes', 92);
  const draw = () => {
    f.cache.pin([old, ...f.cache.drawable(next)]);
    f.cache.finish();
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(100);
  };
  f.invalidate.mockImplementation(draw);
  try {
    draw();
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.transport.build.mock.calls[0][0].coordinates[0]).toBe(3);
    expect(f.cache.isResident(cold)).toBe(true);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(100);
  } finally {
    f.cache.dispose();
  }
});

it('trims an unpresented intermediate before admitting a replacement selection without evicting its prefix', async () => {
  const f = fixture(),
    input = {
      ...f.input,
      wholeLayer: true,
      ordered: true,
      shapes: Array.from({ length: 8193 }, () => [[1, 1]]),
      ids: Uint32Array.of(0, 4096, 8192),
    };
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const displayed = f.cache.drawable(first);
    f.cache.pin(displayed);
    const intermediate = f.frame({ ...input, interval: 1 });
    await vi.waitFor(() => expect(f.cache.complete(intermediate)).toBe(true));
    Reflect.set(f.cache, 'limit', 77);
    f.cache.begin();
    const latest = f.cache.request(
      { ...input, interval: 2 },
      { id: 'p', sourceId: 's', revision: 0 },
    );
    await vi.waitFor(() => expect(f.cache.complete(latest)).toBe(true));
    f.cache.finish();
    expect(displayed.every((entry) => f.cache.isResident(entry))).toBe(true);
    expect(intermediate.entries?.some((entry) => f.cache.isResident(entry))).toBe(false);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(154);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it.each([
  'clear',
  'dispose',
] as const)('wakes a pending presentation admission on %s without restoring retired geometry', async (action) => {
  const f = fixture(104),
    input = {
      ...f.input,
      shapes: [1, 9, 17, 25].map((n) => [
        [n, n],
        [n + 0.1, n + 0.1],
      ]),
      bounds: [0, 0, 32, 32] as const,
    };
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    f.cache.pin(f.cache.drawable(first));
    f.transport.build.mockImplementation(async (packet) => ({
      ...buildGeometryPacket(packet),
      geometries: [{ kind: 'point', vertices: new Float32Array(4), count: 1 }],
    }));
    const next = f.frame({ ...input, interval: 1 });
    await vi.waitFor(() => {
      expect(f.transport.build).toHaveBeenCalledTimes(6);
      expect(next.entries?.filter((entry) => f.cache.isResident(entry))).toHaveLength(1);
      expect(f.cache.failed(next)).toBe(false);
    });
    if (action === 'clear') f.cache.clear({ sourceId: 's' });
    else f.cache.dispose();
    await vi.waitFor(() => {
      expect(Reflect.get(f.cache, 'running')).toBe(false);
      expect(f.cache.stats.entries).toBe(0);
      expect(f.cache.stats.bytes).toBe(0);
      expect(f.cache.stats.pending).toBe(0);
    });
    expect(f.report).not.toHaveBeenCalled();
    expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(5);
  } finally {
    f.cache.dispose();
  }
});

it('reports an atomic replacement that cannot fit instead of leaving known-cost failures pending', async () => {
  const f = fixture(84),
    input = {
      ...f.input,
      wholeLayer: true,
      ordered: true,
      shapes: Array.from({ length: 8193 }, () => [
        [1, 1],
        [1.1, 1.1],
      ]),
      ids: Uint32Array.of(0, 4096, 8192),
    };
  let interval = 0;
  let request: ReturnType<typeof f.cache.request>;
  const draw = () => {
    f.cache.begin();
    request = f.cache.request({ ...input, interval }, { id: 'p', sourceId: 's', revision: 0 });
    f.cache.pin(f.cache.drawable(request));
    f.cache.finish();
  };
  f.invalidate.mockImplementation(draw);
  try {
    draw();
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    draw();
    const previous = f.cache.drawable(request!);
    f.transport.build.mockImplementation(async (packet) => ({
      ...buildGeometryPacket(packet),
      geometries: [{ kind: 'point', vertices: new Float32Array(4), count: 1 }],
    }));
    interval = 1;
    draw();
    await vi.waitFor(() => expect(f.cache.stats.failedEntries).toBe(2));
    expect(f.cache.drawable(request!)).toEqual(previous);
    expect(f.cache.complete(request!)).toBe(false);
    expect(f.cache.failed(request!)).toBe(true);
    const builds = f.transport.build.mock.calls.length;
    for (let i = 0; i < 3; i++) draw();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.transport.build).toHaveBeenCalledTimes(builds);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(168);
    expect(f.report).toHaveBeenCalledTimes(2);
  } finally {
    f.cache.dispose();
  }
});

it('reserves known retry costs across one Worker batch and does not rebuild losing admissions', async () => {
  const f = fixture(104),
    input = {
      ...f.input,
      shapes: [1, 9, 17, 25].map((n) => [[n, n]]),
      bounds: [0, 0, 32, 32] as const,
    };
  let interval = 0,
    external = 0;
  let request: ReturnType<typeof f.cache.request>;
  const draw = () => {
    f.cache.begin(external);
    request = f.cache.request({ ...input, interval }, { id: 'p', sourceId: 's', revision: 0 });
    f.cache.pin(f.cache.drawable(request));
    f.cache.finish();
  };
  f.invalidate.mockImplementation(draw);
  const result = () => ({
    geometries: [{ kind: 'point' as const, vertices: new Float32Array(8), count: 2 }],
    screenSpace: false,
  });
  try {
    draw();
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    draw();
    f.transport.build.mockImplementation(async () => result());
    interval = 1;
    external = 64;
    draw();
    await vi.waitFor(() => expect(f.cache.stats.failedEntries).toBe(4));
    expect(f.report).toHaveBeenCalledTimes(4);
    f.transport.build.mockClear();
    const buildBatch = vi.fn(async (packets: Parameters<typeof buildGeometryPacket>[0][]) => {
      expect(f.cache.stats.bytes + external + packets.length * 32).toBeLessThanOrEqual(208);
      return packets.map(() => ({ result: result() }));
    });
    Object.assign(f.transport, { buildBatch });
    external = 0;
    draw();
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    const jobs =
      f.transport.build.mock.calls.length +
      buildBatch.mock.calls.reduce((n, [packets]) => n + packets.length, 0);
    expect(jobs).toBe(4);
    expect(f.report).toHaveBeenCalledTimes(4);
    expect(f.cache.stats.failedEntries).toBe(0);
  } finally {
    f.cache.dispose();
  }
});

it.each([
  'success',
  'worker failure',
] as const)('defers a metadata admission report while another owner can retire memory (%s)', async (outcome) => {
  const f = fixture(),
    selectedInput = {
      ...f.input,
      wholeLayer: true,
      ordered: true,
      shapes: Array.from({ length: 8193 }, () => [[1, 1]]),
      ids: Uint32Array.of(0, 4096, 8192),
    },
    holderInput = {
      ...f.input,
      wholeLayer: true,
      ordered: true,
      shapes: [
        [
          [6, 6],
          [6.1, 6.1],
          [6.2, 6.2],
          [6.3, 6.3],
        ],
      ],
    };
  let interval = 0,
    holderInterval = 0;
  let selected: GeometryRequest, holder: GeometryRequest;
  let release: (() => void) | undefined;
  const draw = () => {
    f.cache.begin();
    selected = f.cache.request(
      { ...selectedInput, interval },
      { id: 'p', sourceId: 's', revision: 0 },
    );
    holder = f.cache.request(
      { ...holderInput, interval: holderInterval },
      { id: 'holder', sourceId: 's', revision: 0 },
    );
    f.cache.pin([selected, holder].flatMap((r) => f.cache.drawable(r)));
    f.cache.finish();
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(170);
  };
  f.invalidate.mockImplementation(draw);
  try {
    draw();
    await vi.waitFor(() =>
      expect(f.cache.complete(selected) && f.cache.complete(holder)).toBe(true),
    );
    draw();
    expect(f.cache.stats.bytes).toBe(144);
    Reflect.set(f.cache, 'limit', 85);
    f.transport.build.mockImplementation(async (packet) => {
      if (packet.coordinates[0] === 6) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (outcome === 'worker failure') throw new Error('Holder Worker reconstruction failed');
        return {
          ...buildGeometryPacket(packet),
          geometries: [{ kind: 'point', vertices: new Float32Array(4), count: 1 }],
        };
      }
      return buildGeometryPacket(packet);
    });
    holderInterval = 1;
    draw();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    interval = 1;
    draw();
    await vi.waitFor(() => expect(selected.requiredMetadataBytes).toBeDefined());
    await vi.waitFor(() => expect(f.cache.stats.bytes).toBe(152));
    expect(f.cache.drawable(selected!)).toHaveLength(3);
    expect(f.report).not.toHaveBeenCalled();
    expect(f.cache.stats.errors).toBe(0);
    release!();
    if (outcome === 'success') {
      await vi.waitFor(() =>
        expect(f.cache.complete(selected) && f.cache.complete(holder)).toBe(true),
      );
      expect(f.report).not.toHaveBeenCalled();
      expect(f.cache.stats.errors).toBe(0);
    } else {
      await vi.waitFor(() => expect(f.report).toHaveBeenCalledTimes(2));
      expect(f.cache.failed(selected!)).toBe(true);
      expect(f.cache.failed(holder!)).toBe(true);
      const builds = f.transport.build.mock.calls.length;
      for (let i = 0; i < 3; i++) draw();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(f.report).toHaveBeenCalledTimes(2);
      expect(f.transport.build).toHaveBeenCalledTimes(builds);
    }
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it.each([
  false,
  true,
])('reports quiescent metadata admission once and recovers after frame retirement (self-dependent presentation plan: %s)', async (selfDependentPlan) => {
  const f = fixture(),
    input = {
      ...f.input,
      wholeLayer: true,
      ordered: true,
      shapes: Array.from({ length: 8193 }, () => [[1, 1]]),
      ids: Uint32Array.of(0, 4096, 8192),
    },
    holderInput = selfDependentPlan
      ? { ...input, wholeLayer: false, ordered: false, shapes: input.shapes.slice() }
      : input;
  let interval = 0,
    holderVisible = true;
  let selected: ReturnType<typeof f.cache.request>;
  let holder: ReturnType<typeof f.cache.request>;
  const draw = () => {
    f.cache.begin();
    selected = f.cache.request({ ...input, interval }, { id: 'p', sourceId: 's', revision: 0 });
    const requests = [selected];
    if (holderVisible) {
      holder = f.cache.request(holderInput, {
        id: selfDependentPlan ? 'p' : 'holder',
        sourceId: 's',
        revision: 0,
        ...(selfDependentPlan ? { content: 'fill' } : {}),
      });
      requests.push(holder);
    }
    const shown = requests
      .filter((request) => !(selfDependentPlan && interval && request === holder))
      .flatMap((request) => f.cache.drawable(request));
    if (interval) expect(f.cache.drawable(selected)).toHaveLength(3);
    f.cache.pin(shown, !!interval && selfDependentPlan);
    f.cache.finish();
  };
  f.invalidate.mockImplementation(draw);
  try {
    draw();
    await vi.waitFor(() =>
      expect(f.cache.complete(selected) && f.cache.complete(holder)).toBe(true),
    );
    draw();
    const initialBytes = f.cache.stats.bytes;
    const builds = f.transport.build.mock.calls.length;
    Reflect.set(f.cache, 'limit', initialBytes * 0.55);
    interval = 1;
    draw();
    await vi.waitFor(() => expect(f.cache.failed(selected)).toBe(true));
    const blocked = selected!;
    for (let i = 0; i < 5; i++) draw();
    expect(selected!).toBe(blocked);
    expect(f.cache.stats.bytes).toBe(initialBytes);
    expect(f.cache.stats.errors).toBe(1);
    expect(f.transport.build).toHaveBeenCalledTimes(builds);
    holderVisible = false;
    draw();
    // The retiring holder is dropped by finish(), after request() saw the old capacity.
    await vi.waitFor(() => expect(f.cache.complete(selected)).toBe(true));
    expect(selected!).not.toBe(blocked);
    expect(f.cache.stats.failedRequests).toBe(0);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(f.cache.stats.budgetBytes * 2);
    expect(f.cache.stats.errors).toBe(1);
    expect(f.transport.build).toHaveBeenCalledTimes(builds + 3);
    expect(f.report).toHaveBeenCalledOnce();
  } finally {
    f.cache.dispose();
  }
});

it('defers metadata admission while another owner has a fitting known-cost retry after orphan cleanup', async () => {
  const f = fixture(86),
    input = { ...f.input, ids: Uint32Array.of(0) };
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const old = first.entries![0];
    old.bytes = 146;
    Reflect.set(f.cache, 'bytes', 146);
    f.cache.pin([old]);
    Reflect.set(f.cache, 'running', true);
    const retry = f.frame({ ...input, interval: 1 });
    await vi.waitFor(() => expect(retry.entries).not.toBeNull());
    const entry = retry.entries![0];
    entry.state = 'error';
    entry.requiredBytes = 16;
    entry.error = new RangeError('capacity');
    Reflect.set(f.cache, 'running', false);
    const waiting = f.cache.request(f.input, { id: 'a', sourceId: 's', revision: 0 });
    await vi.waitFor(() => expect(waiting.requiredMetadataBytes).toBeDefined());
    f.cache.finish();
    expect(f.cache.stats.bytes).toBe(154);
    expect(f.report).not.toHaveBeenCalled();
    expect(Reflect.get(f.cache, 'nextQueued').call(f.cache).request).toBe(retry);
  } finally {
    Reflect.set(f.cache, 'running', false);
    f.cache.dispose();
  }
});

it.each([
  'report',
  'clear',
  'dispose',
  'capacity',
] as const)('delivers quiescent metadata failure after finish and rechecks %s before notification', async (action) => {
  const f = fixture(86),
    input = { ...f.input, ids: Uint32Array.of(0) };
  let finishing = false;
  f.report.mockImplementation(() => expect(finishing).toBe(false));
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const old = first.entries![0];
    old.bytes = 154;
    Reflect.set(f.cache, 'bytes', 154);
    f.cache.pin([old]);
    Reflect.set(f.cache, 'running', true);
    f.cache.begin();
    f.cache.request(input, { id: 'p', sourceId: 's', revision: 0 });
    const waiting = f.cache.request(f.input, { id: 'a', sourceId: 's', revision: 0 });
    await vi.waitFor(() => expect(waiting.requiredMetadataBytes).toBeDefined());
    expect(f.report).not.toHaveBeenCalled();
    Reflect.set(f.cache, 'running', false);
    finishing = true;
    f.cache.finish();
    finishing = false;
    expect(f.report).not.toHaveBeenCalled();
    if (action === 'clear') f.cache.clear({ layerId: 'a' });
    else if (action === 'dispose') f.cache.dispose();
    else if (action === 'capacity') Reflect.set(f.cache, 'limit', 100);
    if (action === 'report') await vi.waitFor(() => expect(f.report).toHaveBeenCalledOnce());
    else {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(f.report).not.toHaveBeenCalled();
      expect(f.cache.stats.errors).toBe(0);
    }
  } finally {
    Reflect.set(f.cache, 'running', false);
    f.cache.dispose();
  }
});

it.each([
  'validation',
  'worker',
] as const)('does not retry a real %s error when capacity changes', async (failure) => {
  const f = fixture(),
    input = screenPathInput();
  if (failure === 'validation') input.screen.width = 0;
  else
    f.transport.build.mockRejectedValueOnce(
      new RangeError('Geometry selection cache exceeds its bounded working set.'),
    );
  const draw = (externalBytes: number) => {
    f.cache.begin(externalBytes);
    const request = f.cache.request(input, { id: 'p', sourceId: 's', revision: 0 });
    f.cache.finish();
    return request;
  };
  try {
    const failed = draw(128);
    await vi.waitFor(() => expect(f.cache.failed(failed)).toBe(true));
    for (const bytes of [0, 128, 0]) expect(draw(bytes)).toBe(failed);
    expect(f.transport.build).toHaveBeenCalledOnce();
    expect(f.report).toHaveBeenCalledOnce();
  } finally {
    f.cache.dispose();
  }
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

function screenPathInput(): GeometryInput & { screen: NonNullable<GeometryInput['screen']> } {
  const input = handoffInput('path'),
    arcs = input.arcs!;
  return {
    ...input,
    // Reuse fixtures keep one segment per arc, independently of the screen resolution.
    arcs: {
      size: () => arcs.size(),
      getArcIter(id: number) {
        const iter = arcs.getArcIter(id);
        let n = 0;
        return {
          get x() {
            return iter.x;
          },
          get y() {
            return iter.y;
          },
          hasNext: () => n++ < 2 && iter.hasNext(),
        };
      },
    } as GeometryInput['arcs'],
    sourceSelection: true,
    wholeLayer: true,
    screen: {
      view: [16, -16, -128, 128],
      width: 100,
      height: 100,
      pixelRatio: 2,
      initialScale: 0,
      smallArcs: false,
      halfPixel: true,
      cull: false,
      padding: 8,
      revision: 0,
    },
  };
}

it('reuses owned source packets after transfer while rebuilding paths for the current view', async () => {
  const f = fixture(),
    input = screenPathInput();
  const read = vi.spyOn(input.arcs!, 'getArcIter');
  const packets: Parameters<typeof buildGeometryPacket>[0][] = [];
  f.transport.build.mockImplementation(async (packet) => {
    const received = structuredClone(packet, {
      transfer: [packet.coordinates.buffer, packet.offsets.buffer, packet.features.buffer],
    });
    packets.push(received);
    return buildGeometryPacket(received);
  });
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const count = packets.length,
      builds = f.cache.stats.builds;
    read.mockClear();
    const screen: NonNullable<GeometryInput['screen']> = {
      ...input.screen,
      view: [40, -40, -320, 320],
    };
    const next = f.frame({ ...input, screen, compactStroke: true });
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.stats.builds).toBe(builds + count);
    expect(read).not.toHaveBeenCalled();
    expect(f.cache.stats.packedHits).toBe(count);
    expect(f.cache.stats.packedCacheBytes).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      expect(packets[count + i].coordinates).toEqual(packets[i].coordinates);
      expect(packets[count + i].offsets).toEqual(packets[i].offsets);
      expect(packets[count + i].features).toEqual(packets[i].features);
      expect(packets[count + i].screen).toEqual(screen);
      expect(packets[count + i].compactStroke).toBe(true);
    }
    f.cache.clear({ layerId: 'p' });
    expect(f.cache.stats.packedCacheBytes).toBe(0);
  } finally {
    f.cache.dispose();
  }
  expect(f.cache.stats.packedCacheBytes).toBe(0);
});

it.each([
  'interval',
  'revision',
  'arcs',
  'membership',
] as const)('rebuilds cached source packets after changing %s', async (change) => {
  const f = fixture(),
    input = screenPathInput();
  const read = vi.spyOn(input.arcs!, 'getArcIter');
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    read.mockClear();
    const nextInput: GeometryInput = {
      ...input,
      screen: { ...input.screen, view: [40, -40, -320, 320] },
      ...(change === 'interval' ? { interval: 1 } : {}),
      ...(change === 'membership' ? { ids: Uint32Array.of(0, 1) } : {}),
      ...(change === 'arcs' ? { arcs: { ...input.arcs! } } : {}),
    };
    const next = f.frame(nextInput, change === 'revision' ? 1 : 0);
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(read).toHaveBeenCalled();
    expect(f.cache.stats.packedHits).toBe(0);
    f.cache.clear({ sourceId: 's' });
    expect(f.cache.stats.packedCacheBytes).toBe(0);
  } finally {
    f.cache.dispose();
  }
});

it('keeps source packet copies inside the existing partition and selection budget', async () => {
  const f = fixture(1024 ** 2, 160),
    input = screenPathInput();
  const read = vi.spyOn(input.arcs!, 'getArcIter');
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    read.mockClear();
    const next = f.frame({ ...input, screen: { ...input.screen, view: [40, -40, -320, 320] } });
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(read).toHaveBeenCalled();
    expect(f.cache.stats.packedHits).toBe(0);
    expect(
      f.cache.stats.packedCacheBytes +
        f.cache.stats.partitionBytes +
        f.cache.stats.selectionCacheBytes,
    ).toBeLessThanOrEqual(160);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('trims warm source packets before preparing a new source with more index metadata', async () => {
  const f = fixture(1024 ** 2, 1000),
    input = screenPathInput();
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const previous = f.cache.stats.packedCacheBytes;
    expect(previous).toBeGreaterThan(0);
    f.cache.begin();
    const path = f.cache.request(input, { id: 'p', sourceId: 's', revision: 0 });
    const points = f.cache.request(
      {
        ...f.input,
        wholeLayer: true,
        bounds: [0, 0, 200, 200],
        shapes: Array.from({ length: 200 }, (_, i) => [[i, i]]),
      },
      { id: 'q', sourceId: 'other', revision: 0 },
    );
    f.cache.finish();
    await vi.waitFor(() => expect(f.cache.complete(path) && f.cache.complete(points)).toBe(true));
    const stats = f.cache.stats;
    expect(
      stats.packedCacheBytes + stats.partitionBytes + stats.selectionCacheBytes,
    ).toBeLessThanOrEqual(1000);
    expect(stats.packedCacheBytes).toBeLessThan(previous);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('does not retain a source packet larger than the existing 2 MiB batch bound', async () => {
  const f = fixture(),
    input = screenPathInput();
  input.arcs = {
    size: () => 1,
    getArcIter() {
      let at = 0;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (at > 131072) return false;
          this.x = at++ / 131072;
          return true;
        },
      };
    },
  } as GeometryInput['arcs'];
  try {
    const request = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    expect(f.transport.build.mock.calls[0][0].coordinates.byteLength).toBeGreaterThan(
      2 * 1024 ** 2,
    );
    expect(f.cache.stats.packedCacheBytes).toBe(0);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('does not retain a packet when its source is cleared during packing', async () => {
  const f = fixture(),
    input = screenPathInput();
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const iter = input.arcs!.getArcIter.bind(input.arcs);
    let cleared = false;
    vi.spyOn(input.arcs!, 'getArcIter').mockImplementationOnce((id) => {
      cleared = true;
      f.cache.clear({ sourceId: 's' });
      return iter(id);
    });
    f.frame({ ...input, interval: 1 });
    await vi.waitFor(() => expect(cleared).toBe(true));
    expect(f.cache.stats.visibleChunks).toBe(0);
    expect(f.cache.stats.packedCacheBytes).toBe(0);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('reuses whole-layer source membership without rescanning arcs on camera changes', async () => {
  const f = fixture(),
    input = screenPathInput(),
    small = vi.fn(() => false);
  Object.assign(input.arcs!, { arcIsSmaller: small });
  input.filter = arcVisibilityFilter(input.arcs!, 0.1, null);
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    expect(f.cache.stats.selectionBuilds).toBe(1);
    small.mockClear();
    for (const scale of [15, 12, 8]) {
      const next = f.frame({
        ...input,
        screen: { ...input.screen, view: [scale, -scale, -8 * scale, 8 * scale] },
      });
      await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    }
    expect(small).not.toHaveBeenCalled();
    expect(f.cache.stats.selectionBuilds).toBe(1);
    expect(f.cache.stats.selectionHits).toBe(3);
    expect(f.transport.build).toHaveBeenCalledOnce();
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it.each([
  0, 5000,
])('rebuilds a coarse path rather than retaining 10,000 fine segments beside %i empty arcs', async (emptyArcs) => {
  const f = fixture(),
    input = screenPathInput();
  input.arcs = {
    size: () => emptyArcs + 1,
    getArcIter(id: number) {
      let at = 0;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (id || at > 10_000) return false;
          this.x = at++ % 2 ? 0.04 : 0.02;
          return true;
        },
      };
    },
  } as GeometryInput['arcs'];
  input.screen = { ...input.screen, view: [16, -16, 0, 0], pixelRatio: 1 };
  try {
    const fine = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(fine)).toBe(true));
    expect(f.cache.drawable(fine)[0].screenStats?.outputSegments).toBe(10_000);
    const coarse = f.frame({ ...input, screen: { ...input.screen, view: [8, -8, 0, 0] } });
    await vi.waitFor(() => expect(f.cache.complete(coarse)).toBe(true));
    expect(f.cache.drawable(coarse)[0].screenStats?.outputSegments).toBe(1);
    expect(f.cache.stats.builds).toBe(2);
    expect(f.transport.build).toHaveBeenCalledTimes(2);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('rebuilds coarser geometry when the worker omits screen work statistics', async () => {
  const f = fixture(),
    input = screenPathInput();
  f.transport.build.mockImplementationOnce(async (packet) => ({
    ...buildGeometryPacket(packet),
    screenStats: undefined,
  }));
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const next = f.frame({ ...input, screen: { ...input.screen, view: [8, -8, -64, 64] } });
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)).not.toEqual(first.entries);
    expect(f.transport.build).toHaveBeenCalledTimes(2);
  } finally {
    f.cache.dispose();
  }
});

it('keeps spatial raw ordering distinct from source-order requests and their fallback', async () => {
  const f = fixture(),
    input = { ...handoffInput('path'), wholeLayer: true, sourceSelection: true };
  try {
    const original = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(original)).toBe(true));
    const ordered = f.frame({ ...input, spatialOrder: true });
    expect(ordered).not.toBe(original);
    expect(ordered.fallback).toBeUndefined();
    await vi.waitFor(() => expect(f.cache.complete(ordered)).toBe(true));
    expect([...f.cache.drawable(ordered)[0].job.members]).toEqual([3, 0, 1, 2]);
    const restored = f.frame(input);
    expect(restored).not.toBe(ordered);
    expect(restored.fallback).toBeUndefined();
    await vi.waitFor(() => expect(f.cache.complete(restored)).toBe(true));
    expect([...f.cache.drawable(restored)[0].job.members]).toEqual([0, 1, 2, 3]);
  } finally {
    f.cache.dispose();
  }
});

it('reuses finer whole-layer screen paths across coarser resolutions without rebuilding or uploading', async () => {
  const f = fixture(4 * 1024 ** 2),
    input = screenPathInput(),
    arcs = input.arcs!;
  input.arcs = {
    size: () => 9000,
    getArcIter: (id: number) => arcs.getArcIter(id % arcs.size()),
  } as GeometryInput['arcs'];
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const resident = f.cache.drawable(first),
      builds = f.cache.stats.builds,
      bytes = f.cache.stats.bytes,
      uploads = f.gpu.createMesh.mock.calls.length;
    expect(resident).toHaveLength(2);
    expect(resident.reduce((n, entry) => n + entry.job.members.length, 0)).toBe(9000);
    expect(resident.every((entry) => entry.screenSpace)).toBe(true);
    for (const scale of [15, 14, 12, 10, 8, 12, 16]) {
      const next = f.frame({
        ...input,
        screen: { ...input.screen, view: [scale, -scale, -8 * scale, 8 * scale] },
      });
      await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
      expect(f.cache.drawable(next)).toEqual(resident);
      expect(f.cache.stats.builds).toBe(builds);
      expect(f.transport.build).toHaveBeenCalledTimes(builds);
      expect(f.gpu.createMesh).toHaveBeenCalledTimes(uploads);
      expect(f.cache.stats.bytes).toBe(bytes);
    }
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('reuses finer screen paths after the coarser mesh is evicted under the unchanged byte budget', async () => {
  const f = fixture(1024),
    input = screenPathInput(),
    coarse = {
      ...input,
      screen: { ...input.screen, view: [8, -8, -64, 64] as [number, number, number, number] },
    };
  try {
    const first = f.frame(coarse);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const old = f.cache.drawable(first);
    f.cache.pin(old);
    const finer = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(finer)).toBe(true));
    const retained = f.cache.drawable(finer),
      builds = f.cache.stats.builds,
      uploads = f.gpu.createMesh.mock.calls.length;
    f.cache.pin(retained);
    f.frame(input);
    expect(old.every((entry) => !f.cache.isResident(entry))).toBe(true);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(1024);
    const revisit = f.frame(coarse);
    await vi.waitFor(() => expect(f.cache.complete(revisit)).toBe(true));
    expect(f.cache.drawable(revisit)).toEqual(retained);
    expect(f.cache.stats.builds).toBe(builds);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(uploads);
    expect(f.cache.stats.budgetBytes).toBe(1024);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(2048);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('keeps the final coarse screen frame when an obsolete zoom-in finishes later', async () => {
  const f = fixture(1024),
    input = screenPathInput();
  let release: (() => void) | undefined;
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const displayed = f.cache.drawable(first);
    f.cache.pin(displayed);
    f.transport.build.mockImplementationOnce(async (packet) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return buildGeometryPacket(packet);
    });
    const intermediate = f.frame({
      ...input,
      screen: { ...input.screen, view: [32, -32, -256, 256] },
    });
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(f.cache.complete(intermediate)).toBe(false);
    expect(f.cache.drawable(intermediate)).toEqual(displayed);
    const latest = f.frame({ ...input, screen: { ...input.screen, view: [8, -8, -64, 64] } });
    await vi.waitFor(() => expect(f.cache.complete(latest)).toBe(true));
    expect(f.cache.drawable(latest)).toEqual(displayed);
    release!();
    await vi.waitFor(() => expect(f.cache.stats.builds).toBe(2));
    expect(f.cache.drawable(latest)).toEqual(displayed);
    expect(f.transport.build).toHaveBeenCalledTimes(2);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
    f.frame(latest.input);
    expect(f.cache.isResident(intermediate.entries![0])).toBe(false);
    expect(displayed.every((entry) => f.cache.isResident(entry))).toBe(true);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(1024);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(2048);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('halves descending-octave screen rebuilds while preferring exact resident resolutions', async () => {
  const f = fixture(),
    input = screenPathInput();
  try {
    for (const [scale, builds, frameScale] of [
      [16, 1, 16],
      [8, 1, 16],
      [4, 2, 4],
      [2, 2, 4],
      [1, 3, 1],
      [16, 3, 16],
      [4, 3, 4],
      [32, 4, 32],
      [16, 4, 16],
    ]) {
      const next = f.frame({
        ...input,
        screen: { ...input.screen, view: [scale, -scale, -8 * scale, 8 * scale] },
      });
      await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
      expect(f.cache.drawable(next)[0].screenView?.[0]).toBe(frameScale);
      expect(f.cache.stats.builds).toBe(builds);
      expect(f.gpu.createMesh).toHaveBeenCalledTimes(builds);
    }
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it.each<[string, Partial<NonNullable<GeometryInput['screen']>>]>([
  ['higher scale', { view: [32, -32, -256, 256] }],
  ['higher physical resolution', { pixelRatio: 4 }],
  ['more than one octave of extra detail', { view: [4, -4, -32, 32] }],
  ['different screen revision', { revision: 1 }],
  ['culling', { cull: true }],
  ['small-arc filtering', { smallArcs: true }],
  ['perspective projection', { perspective: { pitch: 30, bearing: 45 } }],
  ['unfiltered vertices', { halfPixel: false }],
  ['nonuniform projection', { view: [8, -4, -64, 32] }],
  ['reflected projection', { view: [-8, -8, 64, 64] }],
])('does not reuse screen paths across %s', async (_, screen) => {
  const f = fixture(),
    input = screenPathInput();
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const next = f.frame({
      ...input,
      screen: { ...input.screen, ...screen, view: [...(screen.view ?? input.screen.view)] },
    });
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)).not.toEqual(first.entries);
    expect(f.cache.stats.builds).toBe(2);
    expect(f.transport.build).toHaveBeenCalledTimes(2);
  } finally {
    f.cache.dispose();
  }
});

it('validates new screen requests before reusing compatible resident geometry', async () => {
  const f = fixture(),
    input = screenPathInput();
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const invalid = f.frame({
      ...input,
      screen: { ...input.screen, width: 0, view: [8, -8, -64, 64] },
    });
    await vi.waitFor(() => expect(f.cache.failed(invalid)).toBe(true));
    expect(f.report).toHaveBeenCalledOnce();
    expect(f.transport.build).toHaveBeenCalledOnce();
    expect(f.cache.complete(invalid)).toBe(false);
  } finally {
    f.cache.dispose();
  }
});

it('keeps source detail, membership and raw overflow fallback distinct from reusable screen detail', async () => {
  const f = fixture(),
    input = screenPathInput();
  try {
    const first = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const detail = f.frame({
      ...input,
      interval: 1,
      screen: { ...input.screen, view: [8, -8, -64, 64] },
    });
    await vi.waitFor(() => expect(f.cache.complete(detail)).toBe(true));
    expect(f.cache.stats.builds).toBe(2);
    const selected = f.frame({
      ...input,
      ids: Uint32Array.of(0),
      screen: { ...input.screen, view: [8, -8, -64, 64] },
    });
    await vi.waitFor(() => expect(f.cache.complete(selected)).toBe(true));
    expect(f.cache.stats.builds).toBe(3);
    expect(f.cache.drawable(selected)[0].job.members).toEqual(Int32Array.of(0));
    const overflow = f.frame({
      ...input,
      screen: { ...input.screen, view: [1e12, -1e12, -8e12, 8e12] },
    });
    await vi.waitFor(() => expect(f.cache.complete(overflow)).toBe(true));
    expect(f.cache.drawable(overflow)[0].screenSpace).toBe(false);
    expect(f.cache.drawable(overflow)[0].screenStats?.rawFallbackChunks).toBe(1);
    const next = f.frame({ ...input, screen: { ...input.screen, view: [2, -2, -16, 16] } });
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.drawable(next)[0].screenSpace).toBe(true);
    expect(f.cache.stats.builds).toBe(5);
    const raw = f.frame({ ...input, screen: undefined });
    await vi.waitFor(() => expect(f.cache.complete(raw)).toBe(true));
    expect(f.cache.drawable(raw)[0].screenSpace).toBe(false);
    expect(f.cache.drawable(raw)[0].screenStats).toBeUndefined();
    expect(f.cache.stats.builds).toBe(6);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

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

it('reuses source arc membership while selecting visible chunks during navigation', async () => {
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

it('reuses a resident boundary path chunk when panning changes its visible arcs', async () => {
  const f = fixture(),
    input = { ...handoffInput('path'), sourceSelection: true };
  const xs = [1.1, 1.2, 1.3, 0.1];
  Object.assign(input.arcs!, {
    arcIntersectsBBox: (id: number, b: number[]) => xs[id] + 0.02 >= b[0] && xs[id] <= b[2],
  });
  try {
    const first = f.frame({
      ...input,
      viewBounds: [1, 1, 1.25, 1.3],
      filter: arcVisibilityFilter(input.arcs!, 0, [1, 1, 1.25, 1.3]),
    });
    await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
    const displayed = f.cache.drawable(first);
    const builds = f.cache.stats.builds;
    const next = f.frame({
      ...input,
      viewBounds: [1.15, 1, 1.4, 1.3],
      filter: arcVisibilityFilter(input.arcs!, 0, [1.15, 1, 1.4, 1.3]),
    });
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(f.cache.stats.builds).toBe(builds);
    expect(f.cache.drawable(next)).toEqual(displayed);
    expect(f.cache.drawable(next).flatMap((entry) => [...entry.job.members])).toEqual([0, 1, 2]);
    expect(f.report).not.toHaveBeenCalled();
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

it('reuses an in-flight boundary chunk while panning instead of restarting its Worker', async () => {
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
    await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
    expect(releases).toHaveLength(1);
    expect(f.cache.drawable(next).flatMap((e) => [...e.job.members])).toEqual([0, 1, 2]);
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

it.each([
  'interrupted',
  'unchanged',
  'paint buckets',
  'metadata reserve',
  'oversized progressive',
] as const)('recovers a mixed-owner handoff (%s) by rolling back only an unpresented atomic prefix', async (mode) => {
  const f = fixture(75);
  const owner = (id: string) => ({ id, sourceId: 's', revision: 0 });
  const entry = (
    id: string,
    layer: string,
    chunk: number,
    members: number[],
    bytes: number,
    requiredBytes?: number,
  ): GeometryEntry => ({
    id,
    family: `${layer}:${chunk}`,
    partition: 'p',
    owner: owner(layer),
    job: { chunk, members: Int32Array.from(members) },
    state: requiredBytes === undefined ? 'ready' : 'error',
    meshes: (requiredBytes === undefined
      ? [{ kind: 'point', count: 1, bytes: bytes - members.length * 4 }]
      : []) as GeometryEntry['meshes'],
    ranges: [],
    fillRanges: [],
    screenSpace: false,
    bytes,
    used: 0,
    ...(requiredBytes === undefined ? {} : { requiredBytes, error: new RangeError('capacity') }),
  });
  const oldA = entry('old-a', 'a', 0, [0, 1], 60),
    oldB = [entry('old-b0', 'b', 0, [0], 20), entry('old-b1', 'b', 1, [1], 20)],
    prefix = entry('prefix-a', 'a', 0, [0], mode === 'oversized progressive' ? 20 : 24),
    nextA = [prefix, entry('next-a1', 'a', 1, [1], 4, mode === 'oversized progressive' ? 16 : 20)],
    nextB = [
      entry('next-b0', 'b', 0, [0], 4, mode === 'oversized progressive' ? 100 : 16),
      entry('next-b1', 'b', 1, [1], 4, mode === 'oversized progressive' ? 100 : 16),
    ];
  nextB.forEach((e, i) => {
    e.fallback = oldB[i];
  });
  const request = (
    id: string,
    wholeLayer: boolean,
    entries: GeometryEntry[],
    fallback: GeometryEntry[],
  ): GeometryRequest => ({
    input: {
      ...f.input,
      wholeLayer,
      shapes: id === 'a' ? [[[1, 1]], [[2, 2]]] : [[[3, 3]], [[4, 4]]],
      interval: 1,
    },
    owner: owner(id),
    plan: {
      key: 'p',
      ready: true,
      count: 2,
      boundsBytes: 0,
      sourceId: 's',
      revision: 0,
      used: 0,
      controller: new AbortController(),
      promise: Promise.resolve({ chunks: 2, membership: Uint32Array.of(0, 1) }),
    },
    controller: new AbortController(),
    key: 'current',
    entries,
    fallback,
    frame: 0,
    cursor: 0,
  });
  const atomic =
      mode === 'paint buckets'
        ? [request('a', true, [prefix], [oldA]), request('a', true, [nextA[1]], [oldA])]
        : [request('a', true, nextA, [oldA])],
    progressive = request('b', false, nextB, oldB),
    requests = [...atomic, progressive],
    all = [oldA, ...oldB, ...nextA, ...nextB];
  Reflect.set(f.cache, 'entries', new Map(all.map((e) => [e.id, e])));
  Reflect.set(f.cache, 'requests', new Map(requests.map((r, i) => [r.owner.id + i, r])));
  Reflect.set(f.cache, 'bytes', mode === 'oversized progressive' ? 132 : 136);
  Reflect.set(f.cache, 'handoffOwner', atomic[0].owner);
  Reflect.set(
    f.cache,
    'handoffRequests',
    mode === 'interrupted' ? atomic.map((r) => ({ ...r, key: 'interrupted' })) : atomic,
  );
  f.cache.pin([oldA, ...oldB]);
  const draw = () => {
    const ready = atomic.every((r) => f.cache.complete(r));
    const shown = [
      ...(ready ? atomic.flatMap((r) => f.cache.drawable(r)) : [oldA]),
      ...f.cache.drawable(progressive),
    ];
    if (!ready) expect(f.cache.isResident(oldA)).toBe(true);
    f.cache.pin(shown);
    f.cache.finish();
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(150);
  };
  f.invalidate.mockImplementation(draw);
  f.transport.build.mockImplementation(async (packet) => ({
    geometries: [
      {
        kind: 'point',
        vertices: new Float32Array(
          packet.coordinates[0] < 3 && mode !== 'oversized progressive' ? 5 : 4,
        ),
        count: 1,
      },
    ],
    screenSpace: false,
  }));
  try {
    if (mode === 'metadata reserve') {
      prefix.screenSpace = true;
      prefix.screenView = [1, 1, 0, 0];
      prefix.screenStats = { outputVertices: 2, outputSegments: 1 } as GeometryEntry['screenStats'];
      Reflect.get(f.cache, 'trim').call(f.cache, 38, progressive);
      expect(prefix.bytes).toBe(4);
      expect(prefix.state).toBe('queued');
      expect(prefix.requiredBytes).toBeUndefined();
      expect(prefix.screenStats).toBeUndefined();
      expect(prefix.screenView).toBeUndefined();
      expect(f.cache.stats.bytes).toBe(116);
      expect(() => f.cache.admitExternal(34)).not.toThrow();
      expect(() => f.cache.admitExternal(38)).toThrow(RangeError);
    }
    draw();
    if (mode === 'oversized progressive') {
      await vi.waitFor(() => expect(atomic.every((r) => f.cache.complete(r))).toBe(true));
      draw();
      expect(f.cache.failed(progressive)).toBe(true);
      expect(f.cache.stats.pending).toBe(0);
      expect(f.transport.build).toHaveBeenCalledTimes(1);
      expect(f.report).not.toHaveBeenCalled();
      return;
    }
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true));
    draw();
    expect(f.cache.stats.bytes).toBe(88);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(150);
    expect(f.cache.stats.failedRequests).toBe(0);
    expect(f.transport.build).toHaveBeenCalledTimes(4);
    expect(f.report).not.toHaveBeenCalled();
  } finally {
    f.cache.dispose();
  }
});

it('prepares retiring owners before presentation while all replacements fit the hard budget', async () => {
  const f = fixture();
  const input = { ...f.input, ordered: true };
  const frame = (interval: number) => {
    f.cache.begin();
    const requests = ['a', 'b', 'c'].map((id) =>
      f.cache.request({ ...input, interval }, { id, sourceId: 's', revision: 0 }),
    );
    f.cache.finish();
    return requests;
  };
  try {
    const first = frame(0);
    await vi.waitFor(() => expect(first.every((r) => f.cache.complete(r))).toBe(true));
    const displayed = first.flatMap((r) => f.cache.drawable(r));
    f.cache.pin(displayed);
    const initial = f.cache.stats.bytes;
    Reflect.set(f.cache, 'limit', initial * 1.1);
    const next = frame(1);
    // No presentation callback runs: preparation can use the existing hard-limit headroom.
    await vi.waitFor(() => expect(next.every((r) => f.cache.complete(r))).toBe(true));
    expect(displayed.every((entry) => f.cache.isResident(entry))).toBe(true);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(initial * 2.2);
    expect(f.report).not.toHaveBeenCalled();
    f.cache.pin(next.flatMap((r) => f.cache.drawable(r)));
    f.cache.finish();
    expect(displayed.some((entry) => f.cache.isResident(entry))).toBe(false);
  } finally {
    f.cache.dispose();
  }
});

it('hands off one complete owner before allocating other replacements under memory pressure', async () => {
  const f = fixture();
  const input = {
    ...f.input,
    ordered: true,
    shapes: Array.from({ length: 8193 }, () => [[1, 1]]),
    ids: Uint32Array.of(0, 4096, 8192),
  };
  let interval = 0;
  let requests: ReturnType<typeof f.cache.request>[] = [];
  const draw = () => {
    f.cache.begin();
    requests = ['a', 'b', 'c'].map((id) =>
      f.cache.request({ ...input, interval }, { id, sourceId: 's', revision: 0 }),
    );
    for (const request of requests) {
      const shown = f.cache.drawable(request);
      // Each translucent ordered run remains whole; no old/new double drawing.
      if (interval)
        expect(shown.flatMap((entry) => [...entry.job.members])).toEqual([0, 4096, 8192]);
    }
    f.cache.pin(requests.flatMap((request) => f.cache.drawable(request)));
    f.cache.finish();
  };
  try {
    draw();
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true));
    draw();
    const initial = f.cache.stats.bytes;
    // Enough for the final view plus one owner's replacement, not two full views.
    (f.cache as unknown as { limit: number }).limit = initial * 0.875;
    f.invalidate.mockImplementation(draw);
    interval = 0.5;
    draw();
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true), {
      timeout: 3000,
    });
    expect(f.report).not.toHaveBeenCalled();
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(initial * 1.75);
    expect(f.cache.stats.evictions).toBeGreaterThan(0);
  } finally {
    f.cache.dispose();
  }
});

it('waits for the largest retiring owner to finish planning before spending its headroom elsewhere', async () => {
  const f = fixture();
  const input = { ...f.input, ordered: true, shapes: Array.from({ length: 50 }, () => [[1, 1]]) };
  let interval = 0;
  let requests: ReturnType<typeof f.cache.request>[] = [];
  let release: (() => void) | undefined;
  const draw = () => {
    f.cache.begin();
    requests = ['a', 'b'].map((id) =>
      f.cache.request(
        {
          ...input,
          interval,
          ids: Uint32Array.from(
            { length: id === 'a' ? (interval ? 5 : 30) : interval ? 50 : 15 },
            (_, i) => i,
          ),
        },
        { id, sourceId: 's', revision: 0 },
      ),
    );
    f.cache.pin(requests.flatMap((r) => f.cache.drawable(r)));
    f.cache.finish();
  };
  try {
    draw();
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true));
    draw();
    const initial = f.cache.stats.bytes;
    (f.cache as unknown as { limit: number }).limit = (initial * 5) / 6;
    const select = Reflect.get(f.cache, 'selectJobs').bind(f.cache);
    Reflect.set(
      f.cache,
      'selectJobs',
      async (request: ReturnType<typeof f.cache.request>, partition: unknown) => {
        if (request.owner.id === 'a')
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return select(request, partition);
      },
    );
    f.invalidate.mockImplementation(draw);
    interval = 0.5;
    draw();
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Uploading the earlier-planned, growing owner first would exhaust capacity.
    expect(f.report).not.toHaveBeenCalled();
    expect(f.transport.build).toHaveBeenCalledTimes(2);
    release!();
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true));
    expect(f.report).not.toHaveBeenCalled();
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual((initial * 5) / 3);
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('reprioritizes retirement when navigation replaces an unfinished handoff', async () => {
  const f = fixture();
  const input = { ...f.input, ordered: true, shapes: Array.from({ length: 50 }, () => [[1, 1]]) };
  let step = 0;
  let release: (() => void) | undefined;
  let requests: ReturnType<typeof f.cache.request>[] = [];
  const draw = () => {
    f.cache.begin();
    requests = ['a', 'b'].map((id) =>
      f.cache.request(
        {
          ...input,
          interval: id === 'a' && step < 2 ? 0 : step,
          ids: Uint32Array.from(
            { length: id === 'a' ? (step < 2 ? 30 : 5) : step === 2 ? 50 : step === 1 ? 5 : 15 },
            (_, i) => i,
          ),
        },
        { id, sourceId: 's', revision: 0 },
      ),
    );
    f.cache.pin(requests.flatMap((r) => f.cache.drawable(r)));
    f.cache.finish();
  };
  try {
    draw();
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true));
    draw();
    const initial = f.cache.stats.bytes;
    Reflect.set(f.cache, 'limit', (initial * 5) / 6);
    f.invalidate.mockImplementation(draw);
    let started = false;
    f.transport.build.mockImplementationOnce(async (packet, signal?: AbortSignal) => {
      started = true;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return buildGeometryPacket(packet);
    });
    // Only b changes first, so its replacement owns the available headroom.
    step = 1;
    draw();
    await vi.waitFor(() => expect(started).toBe(true));
    // The next camera position also shrinks a. Retiring a first makes the
    // final view fit; continuing b's old priority would exceed the hard cap.
    step = 2;
    draw();
    await vi.waitFor(() => expect(requests.every((r) => r.entries !== null)).toBe(true));
    release!();
    await vi.waitFor(() => expect(requests.every((r) => f.cache.complete(r))).toBe(true));
    expect(f.report).not.toHaveBeenCalled();
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual((initial * 5) / 3);
  } finally {
    release?.();
    f.cache.dispose();
  }
});

it('retains expensive geometry across cheap navigation results without raising the byte budget', async () => {
  const f = fixture(48);
  f.transport.build.mockImplementation(async (packet) => ({
    ...buildGeometryPacket(packet),
    preparationMs: packet.coordinates[0] === 1 ? 100 : 1,
  }));
  const first = f.frame({ ...f.input, ids: Uint32Array.from([0, 1]) });
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  const nextInput = { ...f.input, ids: Uint32Array.from([2]) };
  const next = f.frame(nextInput);
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  f.frame(nextInput); // Retire the previous presentation before applying the soft budget.
  expect(f.cache.stats.bytes).toBeLessThanOrEqual(48);
  const calls = f.transport.build.mock.calls.length;
  const revisit = f.frame({ ...f.input, ids: Uint32Array.from([0]) });
  await vi.waitFor(() => expect(f.cache.complete(revisit)).toBe(true));
  expect(f.transport.build).toHaveBeenCalledTimes(calls);
  f.cache.dispose();
  expect(f.cache.stats.bytes).toBe(0);
});

it.each([
  undefined,
  -1,
  NaN,
  Infinity,
])('keeps invalid/absent preparation timing out of retention scores (%s)', async (preparationMs) => {
  const f = fixture(48);
  f.transport.build.mockImplementation(async (packet) => ({
    ...buildGeometryPacket(packet),
    preparationMs,
  }));
  const first = f.frame();
  await vi.waitFor(() => expect(f.cache.complete(first)).toBe(true));
  expect(f.cache.stats.preparationMs).toBe(0);
  const one = { ...f.input, ids: Uint32Array.from([2]) };
  const next = f.frame(one);
  await vi.waitFor(() => expect(f.cache.complete(next)).toBe(true));
  f.frame(one);
  expect(f.cache.stats.bytes).toBeLessThanOrEqual(48);
  expect(Number.isFinite(f.cache.stats.evictedPreparationMs)).toBe(true);
  f.cache.dispose();
});

it('ages expensive unused geometry out under sustained pressure and preserves revision invalidation', async () => {
  const f = fixture(48);
  f.input.shapes = Array.from({ length: 12 }, (_, i) => [[i, i]]);
  f.transport.build.mockImplementation(async (packet) => ({
    ...buildGeometryPacket(packet),
    preparationMs: packet.coordinates[0] === 0 ? 2 : 1,
  }));
  const initial = f.frame({ ...f.input, ids: Uint32Array.from([0, 1]) });
  await vi.waitFor(() => expect(f.cache.complete(initial)).toBe(true));
  for (let i = 2; i < 9; i++) {
    const input = { ...f.input, ids: Uint32Array.from([i]) };
    const request = f.frame(input);
    await vi.waitFor(() => expect(f.cache.complete(request)).toBe(true));
    f.frame(input);
    expect(f.cache.stats.bytes).toBeLessThanOrEqual(48);
  }
  const calls = f.transport.build.mock.calls.length;
  const revisit = f.frame({ ...f.input, ids: Uint32Array.from([0]) });
  await vi.waitFor(() => expect(f.cache.complete(revisit)).toBe(true));
  expect(f.transport.build).toHaveBeenCalledTimes(calls + 1);
  const edited = f.frame({ ...f.input, ids: Uint32Array.from([0]) }, 1);
  await vi.waitFor(() => expect(f.cache.complete(edited)).toBe(true));
  expect(f.transport.build).toHaveBeenCalledTimes(calls + 2);
  f.cache.dispose();
});
