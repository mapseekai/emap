import type { ChunkDescriptor } from '@mapseekai/tasklane';
import type { SizedResultSource, TaskHandlers } from '@mapseekai/tasklane/host';
import { decodeWorkerData, type WorkerDataPacket } from '../mapshaper/binary';
import { SessionOwner, taskValue } from '../tasklane/runtime';
import { TasklaneTestWorker, flushTasks } from '../../../test/utils/tasklane-worker';
import type { ImportGeoPackageOptions } from './types';
import { describe, it, expect, vi } from 'vitest';
import {
  geoPackageChunks,
  GeoPackageStreamReceiver,
  GEOPACKAGE_TRANSFER_ROWS,
  type GeoPackageStreamMessage,
} from './stream';
import { DEFAULT_GEOPACKAGE_LIMITS, type GeoPackageDataset } from './types';
import { getDefaultMapshaperAdapter } from '../mapshaper/adapter';

async function streamGeoPackageDataset(
  dataset: GeoPackageDataset,
  send: (message: GeoPackageStreamMessage, transfers: Transferable[]) => Promise<void>,
): Promise<void> {
  for await (const part of geoPackageChunks(dataset)) await send(part.message, part.transfers);
}

function fixture(count = GEOPACKAGE_TRANSFER_ROWS + 2): GeoPackageDataset {
  const adapter = getDefaultMapshaperAdapter();
  const blob = new Uint8Array([1, 255]);
  return {
    layers: [
      {
        name: 'p',
        geometry_type: 'polygon',
        shapes: Array.from({ length: count }, (_, i) => (i % 3 ? [[0, ~1], [], [2]] : null)),
        data: adapter.createDataTable(
          Array.from({ length: count }, (_, i) => ({
            i,
            blob,
            ...JSON.parse('{"__proto__":"safe"}'),
          })),
        ),
      },
      { name: 'empty', geometry_type: 'polyline', shapes: [], data: adapter.createDataTable([]) },
    ],
    arcs: adapter.createArcCollection([
      { xx: Float64Array.of(0, 1), yy: Float64Array.of(0, 1) },
      { xx: Float64Array.of(1, 2), yy: Float64Array.of(1, 1) },
      { xx: Float64Array.of(2, 0), yy: Float64Array.of(1, 0) },
    ]),
    info: {
      geopackage: {
        tables: [],
        dimensions: 'xy',
        integerEncoding: 'safe-number-or-decimal-string',
      },
    },
  };
}
describe('bounded GeoPackage transfer', () => {
  it('preserves all native paths, signed arc IDs, nulls, records and blobs across acknowledged chunks', async () => {
    const data = fixture(),
      expected = structuredClone(data.layers[0].shapes);
    const receiver = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    let result: GeoPackageDataset | undefined,
      batches = 0;
    await streamGeoPackageDataset(data, async (message, transfer) => {
      const copy = structuredClone(message, { transfer });
      if (copy.type === 'batch') {
        batches++;
        expect(copy.value.records.length).toBeLessThanOrEqual(GEOPACKAGE_TRANSFER_ROWS);
        expect(copy.value.shapes).toBeNull();
        expect(copy.value.arcIds).toBeInstanceOf(Int32Array);
      }
      result = receiver.accept(copy);
      if (copy.type !== 'result') expect(result).toBeUndefined();
    });
    expect(batches).toBe(2);
    expect(result!.layers[0].shapes).toEqual(expected);
    expect(result!.layers[0].data!.getRecords!().at(-1)).toMatchObject({
      i: GEOPACKAGE_TRANSFER_ROWS + 1,
      blob: new Uint8Array([1, 255]),
      ['__proto__']: 'safe',
    });
    expect(result!.layers[1].shapes).toEqual([]);
    expect(result!.arcs!.size()).toBe(3);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it('rejects missing or duplicated chunks without publishing a partial dataset', async () => {
    const messages: GeoPackageStreamMessage[] = [];
    await streamGeoPackageDataset(fixture(2), async (message) => {
      messages.push(structuredClone(message));
    });
    const receiver = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    expect(receiver.accept(messages[0])).toBeUndefined();
    expect(() => receiver.accept(messages[0])).toThrow('Out-of-order');
    const incomplete = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    incomplete.accept(messages[0]);
    expect(() => incomplete.accept({ ...messages.at(-1)!, sequence: 1 })).toThrow('Incomplete');
  });
});

type GeoPackageTasks = {
  import: { input: { bytes: Uint8Array; options: ImportGeoPackageOptions }; output: null };
  next: { input: null; output: ChunkDescriptor };
  take: { input: string; output: WorkerDataPacket };
};

it('retains one planned native chunk until the real worker take acknowledges it', async () => {
  const dataset = fixture();
  const expectedShapes = structuredClone(dataset.layers[0].shapes);
  if (!dataset.layers[0].shapes) throw new Error('Expected fixture paths');
  const slices = vi.spyOn(dataset.layers[0].shapes, 'slice');
  const host = await vi.importActual<typeof import('@mapseekai/tasklane/host')>(
    '@mapseekai/tasklane/host',
  );
  const captureServe = vi.fn<typeof host.serve>(() => () => {});
  let owner: SessionOwner | undefined;

  TasklaneTestWorker.instances = [];
  TasklaneTestWorker.handlers = {};
  TasklaneTestWorker.cloneMessages = true;
  vi.stubGlobal('Worker', TasklaneTestWorker);
  vi.stubGlobal('self', {
    location: { href: 'https://example.test/emap-geopackage-worker.js' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
  });

  try {
    // Capture only registration. Keep output/createSizedResultSource completely real.
    // The statically imported TasklaneTestWorker still uses the original serve().
    vi.resetModules();
    vi.doMock('@mapseekai/tasklane/host', () => ({ ...host, serve: captureServe }));
    vi.doMock('./import', () => ({
      importGeoPackage: vi.fn(async () => dataset),
    }));
    await import('./worker-entry');
    expect(captureServe).toHaveBeenCalledOnce();
    const registered = captureServe.mock.calls[0]?.[1];
    if (!registered) throw new Error('Expected the production GeoPackage handlers');
    TasklaneTestWorker.handlers = registered as TaskHandlers<GeoPackageTasks>;

    owner = new SessionOwner(
      'geopackage',
      new URL('https://example.test/emap-geopackage-worker.js'),
    );
    const session = owner.session;
    const next = () =>
      taskValue<ChunkDescriptor>(
        session.enqueue('next', {
          budget: { inputBytes: 1024, scratchBytes: 1024, outputBytes: 1024 },
          prepare: () => ({ payload: null }),
        }),
      );
    const take = (descriptor: ChunkDescriptor) => {
      if (descriptor.done) throw new Error('Expected a chunk descriptor');
      return taskValue<GeoPackageStreamMessage>(
        session.enqueue('take', {
          budget: { inputBytes: 1024, scratchBytes: 1024, outputBytes: descriptor.outputBytes },
          prepare: () => ({ payload: descriptor.token }),
        }),
        (value: WorkerDataPacket) => decodeWorkerData<GeoPackageStreamMessage>(value),
      );
    };
    const receiver = new GeoPackageStreamReceiver(DEFAULT_GEOPACKAGE_LIMITS);
    await taskValue(
      session.enqueue('import', {
        budget: { inputBytes: 1024, scratchBytes: 1024, outputBytes: 1024 },
        prepare: () => ({ payload: { bytes: new Uint8Array([1]), options: {} } }),
      }),
    );

    const worker = TasklaneTestWorker.instances[0];
    const resource =
      worker.requests[0].context.cache.get<SizedResultSource<WorkerDataPacket>>('chunks');
    if (!resource) throw new Error('Expected the native session cache resource');
    const close = vi.spyOn(resource, 'close');

    const header = await next();
    expect(header.done).toBe(false);
    expect(await next()).toEqual(header);
    expect(slices).not.toHaveBeenCalled();
    const headerMessage = await take(header);
    expect(headerMessage.type).toBe('header');
    expect(receiver.accept(headerMessage)).toBeUndefined();

    const firstBatch = await next();
    expect(firstBatch.done).toBe(false);
    expect(slices).toHaveBeenCalledTimes(1);
    expect(await next()).toEqual(firstBatch);
    expect(slices).toHaveBeenCalledTimes(1);
    const firstMessage = await take(firstBatch);
    expect(firstMessage).toMatchObject({ type: 'batch', offset: 0 });
    expect(receiver.accept(firstMessage)).toBeUndefined();

    const secondBatch = await next();
    expect(slices).toHaveBeenCalledTimes(2);
    const secondMessage = await take(secondBatch);
    expect(secondMessage).toMatchObject({ type: 'batch', offset: GEOPACKAGE_TRANSFER_ROWS });
    expect(receiver.accept(secondMessage)).toBeUndefined();

    const resultMessage = await take(await next());
    expect(resultMessage.type).toBe('result');
    const result = receiver.accept(resultMessage);
    expect(await next()).toEqual({ done: true });
    expect(result?.layers[0].shapes).toEqual(expectedShapes);
    expect(result?.layers[0].data?.getRecords?.().at(-1)).toMatchObject({
      i: GEOPACKAGE_TRANSFER_ROWS + 1,
    });
    expect(result?.layers[1].shapes).toEqual([]);
    expect(result?.arcs?.size()).toBe(3);

    await owner.close();
    owner = undefined;
    expect(close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally {
    await owner?.close();
    for (const worker of TasklaneTestWorker.instances) {
      if (worker.terminate.mock.calls.length === 0) worker.terminate();
    }
    await flushTasks();
    TasklaneTestWorker.handlers = {};
    vi.doUnmock('@mapseekai/tasklane/host');
    vi.doUnmock('./import');
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
