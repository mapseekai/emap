import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MapshaperWorkerPool } from './mapshaper-worker-pool';

/**
 * MockWorker — minimal Worker shim for unit-testing the pool's
 * postMessage/onmessage protocol without spawning a real worker thread.
 *
 * Tests drive responses synchronously via `respond(...)` to avoid timing
 * flakiness; the production pool just listens on `onmessage` so this is
 * indistinguishable from the real thing as far as the pool is concerned.
 */
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: any[] = [];
  transfers: Transferable[][] = [];
  terminateCalled = false;
  static instances: MockWorker[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWorker.instances.push(this);
  }

  postMessage(msg: any, transfer?: Transferable[]): void {
    this.posted.push(msg);
    this.transfers.push(transfer ?? []);
  }

  terminate(): void {
    this.terminateCalled = true;
  }

  // Test-only — fake a worker→main message
  respond(payload: any): void {
    this.onmessage?.({ data: payload } as MessageEvent);
  }

  // Test-only — fake a worker error event
  raiseError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe('MapshaperWorkerPool', () => {
  beforeEach(() => {
    MockWorker.instances.length = 0;
  });
  afterEach(() => {
    MockWorker.instances.length = 0;
  });

  function makePool() {
    return new MapshaperWorkerPool({
      workerUrl: 'fake-worker.js',
      WorkerCtor: MockWorker as unknown as typeof Worker,
    });
  }

  it('lazy-spawns the worker on first run()', () => {
    const pool = makePool();
    expect(MockWorker.instances).toHaveLength(0);
    void pool.run('-clip', { datasets: [] });
    expect(MockWorker.instances).toHaveLength(1);
    expect(MockWorker.instances[0].url).toBe('fake-worker.js');
  });

  it('reuses the worker across multiple run() calls', () => {
    const pool = makePool();
    void pool.run('-clip', { datasets: [] });
    void pool.run('-dissolve', { datasets: [] });
    expect(MockWorker.instances).toHaveLength(1);
    expect(MockWorker.instances[0].posted).toHaveLength(2);
  });

  it('posts the right message shape', async () => {
    const pool = makePool();
    const packed = { datasets: ['a' as any] };
    const inputFiles = { 'data.csv': new Uint8Array([1, 2, 3]) };
    void pool.run('-join data.csv', packed, inputFiles);
    const msg = MockWorker.instances[0].posted[0];
    expect(msg.type).toBe('run');
    expect(msg.cmd).toBe('-join data.csv');
    expect(msg.packed).toBe(packed);
    expect(msg.inputFiles).toBe(inputFiles);
    expect(typeof msg.id).toBe('number');
  });

  it('omits inputFiles when not supplied', () => {
    const pool = makePool();
    void pool.run('-clip', { datasets: [] });
    const msg = MockWorker.instances[0].posted[0];
    expect('inputFiles' in msg).toBe(false);
  });

  it('resolves on a matching ok response', async () => {
    const pool = makePool();
    const result = pool.run('-clip', { datasets: [] });
    const msg = MockWorker.instances[0].posted[0];
    MockWorker.instances[0].respond({ id: msg.id, type: 'ok', packed: { datasets: ['result'] } });
    await expect(result).resolves.toEqual({ datasets: ['result'] });
  });

  it('rejects on a matching error response', async () => {
    const pool = makePool();
    const result = pool.run('-clip', { datasets: [] });
    const msg = MockWorker.instances[0].posted[0];
    MockWorker.instances[0].respond({
      id: msg.id,
      type: 'error',
      message: 'mapshaper bad command',
    });
    await expect(result).rejects.toThrow(/mapshaper bad command/);
  });

  it('correlates multiple in-flight responses by id (out-of-order)', async () => {
    const pool = makePool();
    const a = pool.run('-clip', { datasets: ['A'] });
    const b = pool.run('-dissolve', { datasets: ['B'] });
    const aMsg = MockWorker.instances[0].posted[0];
    const bMsg = MockWorker.instances[0].posted[1];
    expect(aMsg.id).not.toBe(bMsg.id);

    // Respond to b first — a should still be pending.
    MockWorker.instances[0].respond({ id: bMsg.id, type: 'ok', packed: { tag: 'B-result' } });
    await expect(b).resolves.toEqual({ tag: 'B-result' });

    // Now respond to a.
    MockWorker.instances[0].respond({ id: aMsg.id, type: 'ok', packed: { tag: 'A-result' } });
    await expect(a).resolves.toEqual({ tag: 'A-result' });
  });

  it('ignores responses with unknown ids', async () => {
    const pool = makePool();
    const result = pool.run('-clip', { datasets: [] });
    // Unknown id — should silently drop, not crash, leave the legitimate
    // promise still pending.
    MockWorker.instances[0].respond({ id: 99999, type: 'ok', packed: {} });

    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // microtask flush
    await Promise.resolve();
    expect(settled).toBe(false);

    // Real response settles it.
    const msg = MockWorker.instances[0].posted[0];
    MockWorker.instances[0].respond({ id: msg.id, type: 'ok', packed: 'real' });
    await expect(result).resolves.toBe('real');
  });

  it('worker error event rejects every pending request and respawns on next run', async () => {
    const pool = makePool();
    const a = pool.run('-clip', { datasets: [] });
    const b = pool.run('-dissolve', { datasets: [] });

    MockWorker.instances[0].raiseError('boom');

    await expect(a).rejects.toThrow(/boom/);
    await expect(b).rejects.toThrow(/boom/);

    // Subsequent run() spawns a fresh worker.
    void pool.run('-clip', { datasets: [] });
    expect(MockWorker.instances).toHaveLength(2);
  });

  it('destroy() terminates the worker and rejects every pending request', async () => {
    const pool = makePool();
    const a = pool.run('-clip', { datasets: [] });
    const b = pool.run('-dissolve', { datasets: [] });

    pool.destroy();

    expect(MockWorker.instances[0].terminateCalled).toBe(true);
    await expect(a).rejects.toThrow(/destroyed/);
    await expect(b).rejects.toThrow(/destroyed/);
  });

  it('run() after destroy() rejects without spawning', async () => {
    const pool = makePool();
    pool.destroy();
    await expect(pool.run('-clip', { datasets: [] })).rejects.toThrow(/destroyed/);
    // No worker was spawned (pool is destroyed before the first run).
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('destroy() is idempotent', async () => {
    const pool = makePool();
    // Track the rejection so the unhandled-rejection watchdog stays quiet.
    const pending = pool.run('-clip', { datasets: [] }).catch(() => undefined);
    expect(() => {
      pool.destroy();
      pool.destroy();
    }).not.toThrow();
    // Worker.terminate() was called exactly once (on the first destroy).
    expect(MockWorker.instances[0].terminateCalled).toBe(true);
    await pending;
  });

  it('cancelAll() terminates the worker and rejects pending requests', async () => {
    const pool = makePool();
    const a = pool.run('-clip', { datasets: [] }).catch((e) => e);
    const b = pool.run('-dissolve', { datasets: [] }).catch((e) => e);
    pool.cancelAll();
    expect(MockWorker.instances[0].terminateCalled).toBe(true);
    const errA = await a;
    const errB = await b;
    expect((errA as Error).message).toMatch(/cancelled/);
    expect((errB as Error).message).toMatch(/cancelled/);
  });

  it('cancelAll() on an unspawned pool is a no-op', () => {
    const pool = makePool();
    expect(() => pool.cancelAll()).not.toThrow();
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('run() after cancelAll() spawns a fresh worker', () => {
    const pool = makePool();
    void pool.run('-clip', { datasets: [] }).catch(() => undefined);
    pool.cancelAll();
    void pool.run('-dissolve', { datasets: [] });
    expect(MockWorker.instances).toHaveLength(2);
    // First was terminated, second should not be.
    expect(MockWorker.instances[0].terminateCalled).toBe(true);
    expect(MockWorker.instances[1].terminateCalled).toBe(false);
  });

  it('cancelAll() does not destroy the pool — subsequent run() works', async () => {
    const pool = makePool();
    void pool.run('-clip', { datasets: [] }).catch(() => undefined);
    pool.cancelAll();
    const result = pool.run('-dissolve', { datasets: [] });
    const msg = MockWorker.instances[1].posted[0];
    MockWorker.instances[1].respond({ id: msg.id, type: 'ok', packed: 'after-cancel' });
    await expect(result).resolves.toBe('after-cancel');
  });

  it('runWithId returns the correlation id synchronously', () => {
    const pool = makePool();
    const { id, promise } = pool.runWithId('-clip', { datasets: [] });
    promise.catch(() => undefined); // swallow when the test ends
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
    const msg = MockWorker.instances[0].posted[0];
    expect(msg.id).toBe(id);
  });

  it('runWithId after destroy returns a rejecting promise', async () => {
    const pool = makePool();
    pool.destroy();
    const { promise } = pool.runWithId('-clip', { datasets: [] });
    await expect(promise).rejects.toThrow(/destroyed/);
  });

  it('returns a rejecting promise when no Worker constructor is available', async () => {
    const originalWorker = (globalThis as any).Worker;
    delete (globalThis as any).Worker;
    try {
      const pool = new MapshaperWorkerPool({
        workerUrl: 'x.js',
        WorkerCtor: undefined as unknown as typeof Worker,
      });
      // Should NOT throw synchronously — pool.run is documented to return
      // a Promise, so spawn failure must surface as rejection too.
      let result: Promise<any> | undefined;
      expect(() => {
        result = pool.run('-clip', {});
      }).not.toThrow();
      await expect(result!).rejects.toThrow(/Worker constructor not available/);
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('runWithId still allocates a unique id even when spawn fails', async () => {
    const originalWorker = (globalThis as any).Worker;
    delete (globalThis as any).Worker;
    try {
      const pool = new MapshaperWorkerPool({
        workerUrl: 'x.js',
        WorkerCtor: undefined as unknown as typeof Worker,
      });
      const a = pool.runWithId('-clip', {});
      const b = pool.runWithId('-clip', {});
      expect(a.id).not.toBe(b.id);
      // Both still reject — the id is for caller-side correlation only.
      await expect(a.promise).rejects.toThrow();
      await expect(b.promise).rejects.toThrow();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('runWithId after destroy uses a fresh id, not -1', async () => {
    const pool = makePool();
    pool.destroy();
    const a = pool.runWithId('-clip', {});
    const b = pool.runWithId('-clip', {});
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
    await expect(a.promise).rejects.toThrow(/destroyed/);
    await expect(b.promise).rejects.toThrow(/destroyed/);
  });

  it('discards late messages from a terminated worker (epoch guard)', async () => {
    const pool = makePool();
    const a = pool.run('-clip', {}).catch((e) => e);
    const oldWorker = MockWorker.instances[0];
    const oldMsg = oldWorker.posted[0];
    pool.cancelAll();
    // Now spawn a fresh worker by issuing a new request.
    const b = pool.run('-dissolve', {});
    const newWorker = MockWorker.instances[1];
    expect(newWorker).toBeDefined();
    // Late message from the OLD worker — its id might collide with `b`'s id.
    // The pool must drop it (epoch mismatch).
    oldWorker.respond({ id: oldMsg.id, type: 'ok', packed: 'late-poison' });
    // `a` already rejected via cancelAll; `b` should still be pending.
    const aErr = await a;
    expect((aErr as Error).message).toMatch(/cancelled/);
    // Resolve b legitimately via the new worker.
    const bMsg = newWorker.posted[0];
    newWorker.respond({ id: bMsg.id, type: 'ok', packed: 'fresh-ok' });
    await expect(b).resolves.toBe('fresh-ok');
  });

  it('rejects and clears load accounting when postMessage throws', async () => {
    class ThrowOnceWorker extends MockWorker {
      static throwsLeft = 1;

      override postMessage(msg: any, transfer?: Transferable[]): void {
        if (ThrowOnceWorker.throwsLeft > 0) {
          ThrowOnceWorker.throwsLeft--;
          throw new Error('clone failed');
        }
        super.postMessage(msg, transfer);
      }
    }

    const pool = new MapshaperWorkerPool({
      workerUrl: 'fake-worker.js',
      WorkerCtor: ThrowOnceWorker as unknown as typeof Worker,
      poolSize: 2,
    });

    const failed = pool.run('-clip', {});
    await expect(failed).rejects.toThrow(/clone failed/);

    const second = pool.run('-dissolve', {});
    expect(MockWorker.instances).toHaveLength(1);
    const worker = MockWorker.instances[0];
    worker.respond({ id: worker.posted[0].id, type: 'ok', packed: 'ok-after-throw' });
    await expect(second).resolves.toBe('ok-after-throw');
  });
});

// ---------------------------------------------------------------------------
// Multi-worker pool (PR-22a)
// ---------------------------------------------------------------------------

describe('MapshaperWorkerPool — poolSize > 1', () => {
  beforeEach(() => {
    MockWorker.instances.length = 0;
  });
  afterEach(() => {
    MockWorker.instances.length = 0;
  });

  function makePool(poolSize: number): MapshaperWorkerPool {
    return new MapshaperWorkerPool({
      workerUrl: 'fake.js',
      WorkerCtor: MockWorker as unknown as typeof Worker,
      poolSize,
    });
  }

  it('reports configured poolSize without spawning anything', () => {
    const pool = makePool(4);
    expect(pool.poolSize).toBe(4);
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('spawns workers lazily as load grows', () => {
    const pool = makePool(3);
    pool.run('-clip', {});
    expect(MockWorker.instances).toHaveLength(1);
    pool.run('-dissolve', {});
    expect(MockWorker.instances).toHaveLength(2);
    pool.run('-buffer 5', {});
    expect(MockWorker.instances).toHaveLength(3);
    // 4th request reuses an existing worker since all 3 are equally loaded.
    pool.run('-clean', {});
    expect(MockWorker.instances).toHaveLength(3);
  });

  it('routes to the least-loaded worker', async () => {
    const pool = makePool(2);
    // First two go to workers 0 and 1 in round-robin.
    const a = pool.run('-clip', {});
    const b = pool.run('-clip', {});
    expect(MockWorker.instances).toHaveLength(2);
    // Third arrives while both have 1 pending each — round-robin picks
    // worker 0 (cursor advanced past 1 → wraps to 0).
    pool.run('-clip', {});
    // worker 0 has 2 pending, worker 1 has 1.
    // Resolve one on worker 1.
    const w1 = MockWorker.instances[1];
    w1.respond({ id: w1.posted[0].id, type: 'ok', packed: 'b-done' });
    await b;
    // Fourth dispatch: worker 1 now has 0 pending, worker 0 has 2 — pick 1.
    pool.run('-clip', {});
    const w0 = MockWorker.instances[0];
    expect(w0.posted).toHaveLength(2);
    expect(w1.posted).toHaveLength(2);
    // Cleanup.
    w0.respond({ id: w0.posted[0].id, type: 'ok', packed: 'a-done' });
    w0.respond({ id: w0.posted[1].id, type: 'ok', packed: 'c-done' });
    w1.respond({ id: w1.posted[1].id, type: 'ok', packed: 'd-done' });
    await a;
  });

  it("isolates worker errors — a single worker crash does not fail other workers' pending", async () => {
    const pool = makePool(2);
    const a = pool.run('-clip', {}); // → worker 0
    const b = pool.run('-clip', {}); // → worker 1
    const w0 = MockWorker.instances[0];
    const w1 = MockWorker.instances[1];

    // Crash worker 0.
    const aPromise = a.catch((e) => e);
    w0.raiseError('boom');
    const aErr = await aPromise;
    expect((aErr as Error).message).toMatch(/boom/);

    // Worker 1's request must still be alive and resolvable.
    w1.respond({ id: w1.posted[0].id, type: 'ok', packed: 'b-ok' });
    await expect(b).resolves.toBe('b-ok');
  });

  it('cancelAll() terminates every spawned worker; next dispatch respawns', () => {
    const pool = makePool(3);
    pool.run('-clip', {}).catch(() => {});
    pool.run('-clip', {}).catch(() => {});
    pool.run('-clip', {}).catch(() => {});
    expect(MockWorker.instances).toHaveLength(3);
    pool.cancelAll();
    for (const w of MockWorker.instances) expect(w.terminateCalled).toBe(true);
    pool.run('-clip', {});
    expect(MockWorker.instances).toHaveLength(4); // one new worker spawned
  });

  it('clamps poolSize < 1 to 1', () => {
    expect(makePool(0).poolSize).toBe(1);
    expect(makePool(-3).poolSize).toBe(1);
  });
});
