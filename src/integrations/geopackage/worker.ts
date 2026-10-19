import { iterateSizedResults, type ChunkDescriptor, type TaskHandle } from '@mapseekai/tasklane';
import {
  SessionOwner,
  taskValue,
  workerError,
  IMPORT_BYTES,
  runtimeWorkerUrl,
} from '../tasklane/runtime';
import { decodeWorkerData, type WorkerDataPacket } from '../mapshaper/binary';
import { GeoPackageStreamReceiver, type GeoPackageStreamMessage } from './stream';
import {
  assertNotAborted,
  geoPackageLimits,
  type GeoPackageDataset,
  type GeoPackageProgress,
  type GeoPackageWorkerOptions,
} from './types';

/** Pull one leased binary batch at a time; final arcs are data, not the done sentinel. */
export async function importGeoPackageInWorker(
  content: ArrayBuffer | Uint8Array,
  options: GeoPackageWorkerOptions,
): Promise<GeoPackageDataset> {
  assertNotAborted(options.signal);
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  const limits = geoPackageLimits(options);
  if (bytes.byteLength > limits.maxInputBytes)
    throw new RangeError('GeoPackage input byte limit exceeded');
  if (limits.maxDecodedBytes > IMPORT_BYTES)
    throw new RangeError('GeoPackage Worker decoded limit exceeds 2 GiB');
  const url = new URL(
    String(runtimeWorkerUrl(options.workerRuntime, 'geopackage') ?? options.workerUrl),
    typeof location === 'undefined' ? undefined : location.href,
  );
  const { workerUrl: _url, workerRuntime, transferInput, signal, onProgress, ...config } = options;
  if (
    transferInput &&
    (bytes.byteOffset !== 0 ||
      bytes.byteLength !== bytes.buffer.byteLength ||
      !(bytes.buffer instanceof ArrayBuffer))
  )
    throw new Error('transferInput requires an entire owned ArrayBuffer');
  const owner = new SessionOwner('geopackage', url, workerRuntime);
  const receiver = new GeoPackageStreamReceiver(limits);
  let progressError: unknown;
  try {
    const session = owner.session;
    const handle: TaskHandle<unknown> = session.enqueue('import', {
      // SQLite/WKB conversion and topology can exceed the runtime's two-minute
      // default for supported multi-million-feature files. Keep a finite bulk
      // deadline; AbortSignal still terminates the Worker immediately.
      executionTimeoutMs: 10 * 60_000,
      budget: {
        inputBytes: Math.min(IMPORT_BYTES, bytes.byteLength + 1024 * 1024),
        scratchBytes: IMPORT_BYTES,
        outputBytes: 1024,
      },
      signal,
      cancellation: 'terminate',
      onProgress: (value) => {
        try {
          onProgress?.(value as GeoPackageProgress);
        } catch (error) {
          progressError = error;
          handle.cancel(error);
        }
      },
      prepare: () => {
        const input = transferInput ? bytes : bytes.slice();
        return {
          payload: {
            bytes: input,
            options: {
              ...config,
              wasmUrl:
                config.wasmUrl ??
                (!workerRuntime || runtimeWorkerUrl(workerRuntime, 'geopackage')
                  ? new URL('sql-wasm.wasm', url).href
                  : undefined),
            },
          },
          transfer: [input.buffer as ArrayBuffer],
        };
      },
    });
    await taskValue(handle);
    let dataset: GeoPackageDataset | undefined;
    const chunks = iterateSizedResults({
      session,
      task: 'take',
      maxChunkBytes: IMPORT_BYTES,
      budget: { inputBytes: 1024, scratchBytes: IMPORT_BYTES },
      taskOptions: { cancellation: 'terminate' },
      signal,
      describe: (signal) =>
        session.enqueue('next', {
          budget: { inputBytes: 1024, scratchBytes: IMPORT_BYTES, outputBytes: 1024 },
          signal,
          cancellation: 'terminate',
          prepare: () => ({ payload: null }),
        }) as TaskHandle<ChunkDescriptor>,
      prepare: (chunk) => ({ payload: chunk.token }),
      close: () => owner.close(),
    });
    for await (const value of chunks) {
      assertNotAborted(signal);
      const message = await decodeWorkerData<GeoPackageStreamMessage>(value as WorkerDataPacket);
      assertNotAborted(signal);
      dataset = receiver.accept(message) ?? dataset;
    }
    await chunks.closed;
    assertNotAborted(signal);
    if (!dataset) throw new Error('Incomplete GeoPackage Worker dataset');
    return dataset;
  } catch (error) {
    throw progressError ?? workerError(error);
  } finally {
    await owner.close();
  }
}
