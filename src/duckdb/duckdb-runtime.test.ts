import { tableFromArrays, tableFromIPC, type Table } from 'apache-arrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeDuckDbRuntime,
  createDuckDbRuntimeFromJsDelivr,
  getDuckDbRuntime,
  setDuckDbRuntime,
  type DuckDbRuntime,
  type DuckDbWasmModule,
} from './index';

class FakeDuckDbConnection {
  readonly insertCalls: Array<{ buffer: Uint8Array; opts: { name: string; create?: boolean } }> =
    [];
  readonly queries: string[] = [];
  closed = false;

  constructor(
    private readonly resultTable: Table,
    private readonly queryError?: unknown,
  ) {}

  async insertArrowFromIPCStream(
    buffer: Uint8Array,
    opts: { name: string; create?: boolean },
  ): Promise<void> {
    this.insertCalls.push({ buffer, opts });
  }

  async query(sql: string): Promise<Table> {
    this.queries.push(sql);
    if (this.queryError) throw this.queryError;
    return this.resultTable;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeAsyncDuckDB {
  static instances: FakeAsyncDuckDB[] = [];

  readonly connections: FakeDuckDbConnection[] = [];
  readonly instantiateCalls: Array<{ mainModule: string; pthreadWorker?: string }> = [];
  readonly queryErrors: unknown[] = [];
  terminateError: unknown;
  terminateCalls = 0;
  terminated = false;

  constructor(
    readonly logger: unknown,
    readonly worker: Worker,
    private readonly resultTable: Table = {} as Table,
  ) {
    FakeAsyncDuckDB.instances.push(this);
  }

  async instantiate(mainModule: string, pthreadWorker?: string): Promise<void> {
    this.instantiateCalls.push({ mainModule, pthreadWorker });
  }

  async connect(): Promise<FakeDuckDbConnection> {
    const conn = new FakeDuckDbConnection(this.resultTable, this.queryErrors.shift());
    this.connections.push(conn);
    return conn;
  }

  async terminate(): Promise<void> {
    this.terminateCalls += 1;
    if (this.terminateError) throw this.terminateError;
    this.terminated = true;
  }
}

function fakeDuckDbModule(mainWorker = 'selected.worker.js'): DuckDbWasmModule {
  FakeAsyncDuckDB.instances = [];
  return {
    getJsDelivrBundles: vi.fn(() => ({
      mvp: { mainModule: 'mvp.wasm', mainWorker: 'mvp.worker.js' },
    })),
    selectBundle: vi.fn(async () => ({
      mainModule: 'selected.wasm',
      mainWorker,
      pthreadWorker: 'selected.pthread.worker.js',
    })),
    ConsoleLogger: class FakeConsoleLogger {},
    AsyncDuckDB: FakeAsyncDuckDB,
  } as unknown as DuckDbWasmModule;
}

async function makeRuntime(duckdb = fakeDuckDbModule()): Promise<DuckDbRuntime> {
  return createDuckDbRuntimeFromJsDelivr({
    duckdb,
    workerFactory: (url) => ({ url }) as unknown as Worker,
    createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
    revokeObjectURL: vi.fn(),
  });
}

function fakeWorker(): Worker {
  return { terminate: vi.fn() } as unknown as Worker;
}

describe('DuckDB runtime injection', () => {
  beforeEach(() => {
    setDuckDbRuntime(null);
  });

  it('stores injected runtime', async () => {
    const runtime: DuckDbRuntime = {
      connect: async () => ({
        insertArrowTable: async () => undefined,
        query: async () => {
          throw new Error('not implemented');
        },
      }),
      ensureSpatial: async () => undefined,
    };

    setDuckDbRuntime(runtime);

    expect(getDuckDbRuntime()).toBe(runtime);
  });

  it('closes and clears the injected runtime', async () => {
    const close = vi.fn(async () => undefined);
    const runtime: DuckDbRuntime = {
      connect: async () => ({
        insertArrowTable: async () => undefined,
        query: async () => {
          throw new Error('not implemented');
        },
      }),
      ensureSpatial: async () => undefined,
      close,
    };

    setDuckDbRuntime(runtime);
    await closeDuckDbRuntime();

    expect(close).toHaveBeenCalledTimes(1);
    expect(getDuckDbRuntime()).toBeNull();
  });

  it('does not clear a newer injected runtime while closing an older one', async () => {
    const oldRuntime: DuckDbRuntime = {
      connect: async () => ({
        insertArrowTable: async () => undefined,
        query: async () => {
          throw new Error('not implemented');
        },
      }),
      ensureSpatial: async () => undefined,
      close: vi.fn(async () => undefined),
    };
    const currentRuntime: DuckDbRuntime = {
      connect: async () => ({
        insertArrowTable: async () => undefined,
        query: async () => {
          throw new Error('not implemented');
        },
      }),
      ensureSpatial: async () => undefined,
    };

    setDuckDbRuntime(currentRuntime);
    await closeDuckDbRuntime(oldRuntime);

    expect(oldRuntime.close).toHaveBeenCalledTimes(1);
    expect(getDuckDbRuntime()).toBe(currentRuntime);
  });
});

describe('createDuckDbRuntimeFromJsDelivr', () => {
  it('creates a runtime with connect and ensureSpatial methods', async () => {
    const duckdb = fakeDuckDbModule();
    const revokeObjectURL = vi.fn();

    const runtime = await createDuckDbRuntimeFromJsDelivr({
      duckdb,
      workerFactory: (url) => ({ url }) as unknown as Worker,
      createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
      revokeObjectURL,
    });

    expect(runtime.connect).toEqual(expect.any(Function));
    expect(runtime.ensureSpatial).toEqual(expect.any(Function));
    expect(runtime.close).toEqual(expect.any(Function));
    expect(duckdb.getJsDelivrBundles).toHaveBeenCalledTimes(1);
    expect(duckdb.selectBundle).toHaveBeenCalledTimes(1);
    expect(FakeAsyncDuckDB.instances[0]?.instantiateCalls).toEqual([
      { mainModule: 'selected.wasm', pthreadWorker: 'selected.pthread.worker.js' },
    ]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:duckdb-worker');
  });

  it('runs INSTALL spatial and LOAD spatial only once', async () => {
    const runtime = await makeRuntime();

    await runtime.ensureSpatial();
    await runtime.ensureSpatial();

    const db = FakeAsyncDuckDB.instances[0]!;
    expect(db.connections).toHaveLength(1);
    expect(db.connections[0]?.queries).toEqual(['INSTALL spatial; LOAD spatial;']);
    expect(db.connections[0]?.closed).toBe(true);
  });

  it('sets a custom extension repository before loading spatial', async () => {
    const duckdb = fakeDuckDbModule();
    const runtime = await createDuckDbRuntimeFromJsDelivr({
      duckdb,
      customExtensionRepository: "https://cdn.example.test/duckdb's/extensions",
      workerFactory: (url) => ({ url }) as unknown as Worker,
      createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
      revokeObjectURL: vi.fn(),
    });

    await runtime.ensureSpatial();

    const db = FakeAsyncDuckDB.instances[0]!;
    expect(db.connections[0]?.queries).toEqual([
      "SET custom_extension_repository = 'https://cdn.example.test/duckdb''s/extensions';",
      'INSTALL spatial; LOAD spatial;',
    ]);
  });

  it('retries spatial setup after a failed install or load', async () => {
    const runtime = await makeRuntime();
    const db = FakeAsyncDuckDB.instances[0]!;
    db.queryErrors.push(new Error('spatial install failed'));

    await expect(runtime.ensureSpatial()).rejects.toThrow('spatial install failed');
    await runtime.ensureSpatial();

    expect(db.connections).toHaveLength(2);
    expect(db.connections[0]?.queries).toEqual(['INSTALL spatial; LOAD spatial;']);
    expect(db.connections[0]?.closed).toBe(true);
    expect(db.connections[1]?.queries).toEqual(['INSTALL spatial; LOAD spatial;']);
    expect(db.connections[1]?.closed).toBe(true);
  });

  it('escapes the selected worker script URL in the blob wrapper', async () => {
    const workerScriptUrl = 'https://cdn.example.test/duck"db\\worker.js';
    let workerBlob: Blob | undefined;

    await createDuckDbRuntimeFromJsDelivr({
      duckdb: fakeDuckDbModule(workerScriptUrl),
      workerFactory: (url) => ({ url }) as unknown as Worker,
      createObjectURL: vi.fn((blob: Blob) => {
        workerBlob = blob;
        return 'blob:duckdb-worker';
      }),
      revokeObjectURL: vi.fn(),
    });

    await expect(workerBlob?.text()).resolves.toBe(
      `importScripts(${JSON.stringify(workerScriptUrl)});`,
    );
  });

  it('terminates the worker if AsyncDuckDB construction fails', async () => {
    const worker = fakeWorker();
    const duckdb = {
      ...fakeDuckDbModule(),
      AsyncDuckDB: class FailingAsyncDuckDB {
        constructor() {
          throw new Error('constructor failed');
        }
      },
    } as unknown as DuckDbWasmModule;

    await expect(
      createDuckDbRuntimeFromJsDelivr({
        duckdb,
        workerFactory: () => worker,
        createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
        revokeObjectURL: vi.fn(),
      }),
    ).rejects.toThrow('constructor failed');

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker if runtime close cannot terminate DuckDB cleanly', async () => {
    const worker = fakeWorker();
    const runtime = await createDuckDbRuntimeFromJsDelivr({
      duckdb: fakeDuckDbModule(),
      workerFactory: () => worker,
      createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
      revokeObjectURL: vi.fn(),
    });
    FakeAsyncDuckDB.instances[0]!.terminateError = new Error('terminate failed');

    await expect(runtime.close?.()).rejects.toThrow('terminate failed');

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('closes runtime instances idempotently', async () => {
    const runtime = await makeRuntime();
    const db = FakeAsyncDuckDB.instances[0]!;

    await runtime.close?.();
    await runtime.close?.();

    expect(db.terminateCalls).toBe(1);
    expect(db.terminated).toBe(true);
  });

  it('rejects runtime operations after close', async () => {
    const runtime = await makeRuntime();

    await runtime.close?.();

    await expect(runtime.connect()).rejects.toThrow('DuckDB-Wasm runtime is closed');
    await expect(runtime.ensureSpatial()).rejects.toThrow('DuckDB-Wasm runtime is closed');
    await expect(runtime.registerFileBuffer?.('x.parquet', new Uint8Array([1]))).rejects.toThrow(
      'DuckDB-Wasm runtime is closed',
    );
  });

  it('serializes Arrow tables before delegating inserts to a DuckDB connection', async () => {
    const runtime = await makeRuntime();
    const conn = await runtime.connect();
    const table = tableFromArrays({ id: [1, 2] });

    await conn.insertArrowTable(table, { name: 'input' });
    const result = await conn.query('select * from input');
    await conn.close?.();

    const duckdbConn = FakeAsyncDuckDB.instances[0]?.connections[0];
    expect(duckdbConn?.insertCalls[0]?.opts).toEqual({ name: 'input', create: true });
    expect(tableFromIPC(duckdbConn!.insertCalls[0]!.buffer).numRows).toBe(2);
    expect(duckdbConn?.queries).toEqual(['select * from input']);
    expect(duckdbConn?.closed).toBe(true);
    expect(result).toBe(duckdbConn?.['resultTable']);
  });
});
