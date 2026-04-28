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
  terminateCalled = false;
  static instances: MockWorker[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWorker.instances.push(this);
  }

  postMessage(msg: any): void {
    this.posted.push(msg);
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
    expect(pool.isWorkerSpawned()).toBe(false);
    void pool.run('-clip', { datasets: [] });
    expect(pool.isWorkerSpawned()).toBe(true);
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
    MockWorker.instances[0].respond({ id: msg.id, type: 'error', message: 'mapshaper bad command' });
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
    void result.then(() => { settled = true; }, () => { settled = true; });
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

  it('throws when no Worker constructor is available', () => {
    const pool = new MapshaperWorkerPool({
      workerUrl: 'x.js',
      WorkerCtor: undefined as unknown as typeof Worker,
    });
    // Stub global Worker too.
    const originalWorker = (globalThis as any).Worker;
    delete (globalThis as any).Worker;
    try {
      expect(() => pool.run('-clip', {})).toThrow(/Worker constructor not available/);
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });
});
