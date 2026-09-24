import { GeoPackageStreamReceiver, type GeoPackageStreamMessage } from './stream';
import {
  assertNotAborted,
  geoPackageLimits,
  type GeoPackageDataset,
  type GeoPackageProgress,
  type GeoPackageWorkerOptions,
} from './types';

/** Run SQLite, WKB decode, CRS normalization and topology building off the UI thread. */
export function importGeoPackageInWorker(
  content: ArrayBuffer | Uint8Array,
  options: GeoPackageWorkerOptions,
): Promise<GeoPackageDataset> {
  return new Promise((resolve, reject) => {
    assertNotAborted(options.signal);
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    if (bytes.byteLength > geoPackageLimits(options).maxInputBytes)
      throw new RangeError('GeoPackage input byte limit exceeded');
    if (typeof Worker === 'undefined')
      throw new Error('Web Workers are unavailable; use importGeoPackage explicitly');
    const url = new URL(
      String(options.workerUrl),
      typeof location === 'undefined' ? undefined : location.href,
    );
    const { workerUrl: _url, transferInput, signal, onProgress, ...importOptions } = options;
    if (
      transferInput &&
      (bytes.byteOffset !== 0 ||
        bytes.byteLength !== bytes.buffer.byteLength ||
        !(bytes.buffer instanceof ArrayBuffer))
    )
      throw new Error('transferInput requires an entire owned ArrayBuffer');
    // Never detach caller-owned bytes implicitly.
    const input = transferInput ? bytes : bytes.slice();
    const worker = new Worker(url, { name: 'emap-geopackage' });
    let finished = false;
    let receiver: GeoPackageStreamReceiver | undefined = new GeoPackageStreamReceiver(
      geoPackageLimits(options),
    );
    const cleanup = () => {
      worker.terminate();
      receiver = undefined;
      signal?.removeEventListener('abort', abort);
      worker.removeEventListener('message', message);
      worker.removeEventListener('error', error);
      worker.removeEventListener('messageerror', messageError);
    };
    const fail = (reason: unknown) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(reason);
      }
    };
    const abort = () =>
      fail(signal?.reason ?? new DOMException('GeoPackage import cancelled', 'AbortError'));
    const error = (event: ErrorEvent) =>
      fail(new Error(event.message || 'GeoPackage Worker failed'));
    const messageError = () => fail(new Error('GeoPackage Worker response could not be decoded'));
    const message = (
      event: MessageEvent<
        | GeoPackageStreamMessage
        | {
            type: 'progress';
            progress: GeoPackageProgress;
          }
        | { type: 'error'; message?: string; name?: string }
      >,
    ) => {
      if (finished) return;
      try {
        if (event.data.type === 'progress') {
          onProgress?.(event.data.progress!);
          return;
        }
        if (event.data.type === 'error') {
          const problem = new Error(event.data.message ?? 'GeoPackage Worker import failed');
          problem.name = event.data.name ?? 'Error';
          fail(problem);
          return;
        }
        assertNotAborted(signal);
        const dataset = receiver!.accept(event.data);
        assertNotAborted(signal);
        if (dataset) {
          finished = true;
          cleanup();
          resolve(dataset);
        } else worker.postMessage({ type: 'ack', sequence: event.data.sequence });
      } catch (problem) {
        fail(problem);
      }
    };
    worker.addEventListener('message', message);
    worker.addEventListener('error', error);
    worker.addEventListener('messageerror', messageError);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage(
        {
          type: 'import',
          bytes: input,
          options: {
            ...importOptions,
            wasmUrl: options.wasmUrl ?? new URL('sql-wasm.wasm', url).href,
          },
        },
        [input.buffer],
      );
    } catch (problem) {
      fail(problem);
    }
  });
}
