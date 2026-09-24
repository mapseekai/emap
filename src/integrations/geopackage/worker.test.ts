import { afterEach, describe, expect, it, vi } from 'vitest';
import { importGeoPackageInWorker } from './worker';

class MockWorker extends EventTarget {
  static instances: MockWorker[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor(readonly url: URL) {
    super();
    MockWorker.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  MockWorker.instances.length = 0;
});

describe('GeoPackage worker ownership', () => {
  it('rejects already cancelled work before constructing a worker', async () => {
    vi.stubGlobal('Worker', MockWorker);
    const controller = new AbortController();
    controller.abort();
    await expect(
      importGeoPackageInWorker(new Uint8Array(10), {
        workerUrl: 'https://example.test/worker.js',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(MockWorker.instances).toHaveLength(0);
  });
  it('does not detach or reuse caller input unless explicitly requested', async () => {
    vi.stubGlobal('Worker', MockWorker);
    const controller = new AbortController();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = importGeoPackageInWorker(bytes, {
      workerUrl: 'https://example.test/worker.js',
      signal: controller.signal,
    });
    const worker = MockWorker.instances[0];
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect(message.bytes).toEqual(bytes);
    expect(message.bytes.buffer).not.toBe(bytes.buffer);
    expect(transfer).toEqual([message.bytes.buffer]);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('requires exclusive input ownership when transferInput is true', async () => {
    vi.stubGlobal('Worker', MockWorker);
    const bytes = new Uint8Array(10).subarray(1);
    await expect(
      importGeoPackageInWorker(bytes, {
        workerUrl: 'https://example.test/worker.js',
        transferInput: true,
      }),
    ).rejects.toThrow('entire owned ArrayBuffer');
    expect(MockWorker.instances).toHaveLength(0);
  });
  it('terminates the worker and rejects errors without main-thread fallback', async () => {
    vi.stubGlobal('Worker', MockWorker);
    const result = importGeoPackageInWorker(new Uint8Array(10), {
      workerUrl: 'https://example.test/worker.js',
    });
    const worker = MockWorker.instances[0];
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'error', name: 'RangeError', message: 'limit exceeded' },
      }),
    );
    await expect(result).rejects.toMatchObject({ name: 'RangeError', message: 'limit exceeded' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('closes the worker when a progress callback fails', async () => {
    vi.stubGlobal('Worker', MockWorker);
    const result = importGeoPackageInWorker(new Uint8Array(10), {
      workerUrl: 'https://example.test/worker.js',
      onProgress() {
        throw new Error('progress failed');
      },
    });
    const worker = MockWorker.instances[0];
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'progress', progress: { phase: 'scan', rows: 0 } },
      }),
    );
    await expect(result).rejects.toThrow('progress failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('terminates a worker when postMessage throws before startup', async () => {
    class UncloneableWorker extends MockWorker {
      postMessage = vi.fn(() => {
        throw new DOMException('Cannot clone', 'DataCloneError');
      });
    }
    vi.stubGlobal('Worker', UncloneableWorker);
    await expect(
      importGeoPackageInWorker(new Uint8Array(10), { workerUrl: 'https://example.test/worker.js' }),
    ).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});

it('acknowledges staged data and discards it on cancellation before the final result', async () => {
  vi.stubGlobal('Worker', MockWorker);
  const controller = new AbortController();
  const result = importGeoPackageInWorker(new Uint8Array(10), {
    workerUrl: 'https://example.test/worker.js',
    signal: controller.signal,
  });
  const worker = MockWorker.instances[0];
  worker.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'header',
        sequence: 0,
        layers: [{ name: 'p', geometry_type: 'point', rows: 1 }],
        info: { geopackage: { tables: [] } },
      },
    }),
  );
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'ack', sequence: 0 });
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'result', sequence: 1 } }));
  expect(worker.terminate).toHaveBeenCalledOnce();
});
