import { DuckDbRuntimeScope } from './runtime-scope';
import { tableFromArrays, tableFromIPC, type Table } from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeDuckDbRuntime,
  createDuckDbRuntimeFromJsDelivr,
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
  readonly droppedFiles: string[] = [];
  readonly instantiateCalls: Array<{ mainModule: string; pthreadWorker?: string }> = [];
  readonly registeredFiles: Array<{ name: string; buffer: Uint8Array }> = [];
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

  async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
    this.registeredFiles.push({ name, buffer });
  }

  async dropFile(name: string): Promise<void> {
    this.droppedFiles.push(name);
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

function fakeDuckDbModuleWithMainModule(mainModule: string): DuckDbWasmModule {
  const duckdb = fakeDuckDbModule();
  const platform = /duckdb-(eh|mvp)\.wasm/.exec(mainModule)?.[1] as 'eh' | 'mvp';
  vi.mocked(duckdb.getJsDelivrBundles).mockReturnValue({
    mvp: {
      mainModule: platform === 'mvp' ? mainModule : 'https://cdn.test/duckdb-mvp.wasm',
      mainWorker: 'mvp.worker.js',
    },
    eh: {
      mainModule: platform === 'eh' ? mainModule : 'https://cdn.test/duckdb-eh.wasm',
      mainWorker: 'eh.worker.js',
    },
  });
  vi.mocked(duckdb.selectBundle).mockResolvedValue({
    mainModule,
    mainWorker: 'selected.worker.js',
  });
  return duckdb;
}

function fakeDuckDbModuleWithSelectedBundle(
  bundleKey: 'mvp' | 'eh' | 'coi',
  mainModule: string,
): DuckDbWasmModule {
  const duckdb = fakeDuckDbModule();
  const bundles = {
    mvp: { mainModule: 'https://cdn.test/default-mvp.wasm', mainWorker: 'mvp.worker.js' },
    eh: { mainModule: 'https://cdn.test/default-eh.wasm', mainWorker: 'eh.worker.js' },
    coi: {
      mainModule: 'https://cdn.test/default-coi.wasm',
      mainWorker: 'coi.worker.js',
      pthreadWorker: 'coi.pthread.worker.js',
    },
  };
  bundles[bundleKey].mainModule = mainModule;
  vi.mocked(duckdb.getJsDelivrBundles).mockReturnValue(
    bundles as unknown as ReturnType<DuckDbWasmModule['getJsDelivrBundles']>,
  );
  vi.mocked(duckdb.selectBundle).mockResolvedValue({
    ...bundles[bundleKey],
    pthreadWorker: bundles[bundleKey].pthreadWorker ?? null,
  });
  return duckdb;
}

function fakeDuckDbModuleWithoutDropFile(mainModule: string): DuckDbWasmModule {
  class FakeAsyncDuckDBWithoutDropFile extends FakeAsyncDuckDB {
    constructor(logger: unknown, worker: Worker) {
      super(logger, worker);
      Object.assign(this, { dropFile: undefined });
    }
  }

  return {
    ...fakeDuckDbModuleWithMainModule(mainModule),
    AsyncDuckDB: FakeAsyncDuckDBWithoutDropFile,
  } as unknown as DuckDbWasmModule;
}

function fakeWorker(): Worker {
  return { terminate: vi.fn() } as unknown as Worker;
}

describe('DuckDB runtime ownership', () => {
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

    const scope = new DuckDbRuntimeScope({ runtime });
    expect(await scope.get()).toBe(runtime);
    await scope.dispose();
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

    const scope = new DuckDbRuntimeScope({ runtime, owned: true });
    await scope.dispose();

    expect(close).toHaveBeenCalledTimes(1);
    expect(scope.peek()).toBeUndefined();
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

    const current = new DuckDbRuntimeScope({ runtime: currentRuntime });
    await closeDuckDbRuntime(oldRuntime);

    expect(oldRuntime.close).toHaveBeenCalledTimes(1);
    expect(await current.get()).toBe(currentRuntime);
    await current.dispose();
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

  describe('bundled spatial extension', () => {
    const extensionUrl = 'https://assets.test/duckdb-eh/spatial.duckdb_extension.wasm';
    const extensionBytes = new Uint8Array([1, 2, 3, 4]);
    const virtualExtensionFile = 'spatial.duckdb_extension.wasm';

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubExtensionFetch(impl?: () => Promise<Response>) {
      const fetchMock = vi.fn(impl ?? (async () => new Response(extensionBytes)));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function makeBundledRuntime(
      duckdb: DuckDbWasmModule,
      spatialExtensionUrls: { coi?: string; eh?: string; mvp?: string },
    ): Promise<DuckDbRuntime> {
      return createDuckDbRuntimeFromJsDelivr({
        duckdb,
        spatialExtensionUrls,
        workerFactory: (url) => ({ url }) as unknown as Worker,
        createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
        revokeObjectURL: vi.fn(),
      });
    }

    it('fetches the bundled URL but loads the extension from a fixed virtual file', async () => {
      const fetchMock = stubExtensionFetch();
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { eh: extensionUrl },
      );

      await runtime.ensureSpatial();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(extensionUrl);
      const db = FakeAsyncDuckDB.instances[0]!;
      expect(db.registeredFiles).toEqual([{ name: virtualExtensionFile, buffer: extensionBytes }]);
      expect(db.connections).toHaveLength(1);
      expect(db.connections[0]?.queries).toEqual([`LOAD '${virtualExtensionFile}';`]);
      expect(db.connections[0]?.closed).toBe(true);
    });

    it('selects the extension URL matching the detected bundle platform', async () => {
      const fetchMock = stubExtensionFetch();
      const mvpUrl = 'https://assets.test/duckdb-mvp/spatial.duckdb_extension.wasm';
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-mvp.wasm'),
        { eh: extensionUrl, mvp: mvpUrl },
      );

      await runtime.ensureSpatial();

      expect(fetchMock).toHaveBeenCalledWith(mvpUrl);
      expect(FakeAsyncDuckDB.instances[0]?.connections[0]?.queries).toEqual([
        `LOAD '${virtualExtensionFile}';`,
      ]);
    });

    it('uses the selected bundle key instead of parsing the WASM URL', async () => {
      const fetchMock = stubExtensionFetch();
      const mvpUrl = 'https://assets.test/duckdb-mvp/spatial.duckdb_extension.wasm';
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithSelectedBundle('eh', 'https://cdn.test/custom-runtime.wasm'),
        { eh: extensionUrl, mvp: mvpUrl },
      );

      await runtime.ensureSpatial();

      expect(fetchMock).toHaveBeenCalledWith(extensionUrl);
    });

    it('uses an explicit COI extension URL when DuckDB selects a COI bundle', async () => {
      const fetchMock = stubExtensionFetch();
      const coiUrl = 'https://assets.test/duckdb-coi/spatial.duckdb_extension.wasm';
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithSelectedBundle('coi', 'https://cdn.test/duckdb-coi.wasm'),
        { coi: coiUrl, eh: extensionUrl },
      );

      await runtime.ensureSpatial();

      expect(fetchMock).toHaveBeenCalledWith(coiUrl);
    });

    it('rejects when the detected bundle platform has no configured URL', async () => {
      const fetchMock = stubExtensionFetch();
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { mvp: extensionUrl },
      );

      await expect(runtime.ensureSpatial()).rejects.toThrow(
        "spatial extension URL for the 'eh' bundle is not configured",
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(FakeAsyncDuckDB.instances[0]?.connections).toHaveLength(0);
    });

    it('rejects when the selected bundle cannot be identified in the bundle table', async () => {
      const fetchMock = stubExtensionFetch();
      const runtime = await makeBundledRuntime(fakeDuckDbModule(), {
        eh: extensionUrl,
        mvp: 'https://assets.test/duckdb-mvp/spatial.duckdb_extension.wasm',
      });

      await expect(runtime.ensureSpatial()).rejects.toThrow('could not be identified');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when the selected bundle is not in the DuckDB bundle table', async () => {
      const fetchMock = stubExtensionFetch();
      const runtime = await makeBundledRuntime(fakeDuckDbModule(), { mvp: extensionUrl });

      await expect(runtime.ensureSpatial()).rejects.toThrow('could not be identified');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches and registers the bundled extension only once', async () => {
      const fetchMock = stubExtensionFetch();
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { eh: extensionUrl },
      );

      await runtime.ensureSpatial();
      await runtime.ensureSpatial();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const db = FakeAsyncDuckDB.instances[0]!;
      expect(db.registeredFiles).toHaveLength(1);
      expect(db.connections).toHaveLength(1);
    });

    it('retries the bundled load after a failed fetch', async () => {
      const fetchMock = vi
        .fn(async () => new Response(extensionBytes))
        .mockRejectedValueOnce(new Error('network down'));
      vi.stubGlobal('fetch', fetchMock);
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { eh: extensionUrl },
      );

      await expect(runtime.ensureSpatial()).rejects.toThrow('network down');
      await runtime.ensureSpatial();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(FakeAsyncDuckDB.instances[0]?.connections).toHaveLength(1);
    });

    it('rejects when the extension fetch returns an HTTP error', async () => {
      stubExtensionFetch(async () => new Response('missing', { status: 404 }));
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { eh: extensionUrl },
      );

      await expect(runtime.ensureSpatial()).rejects.toThrow('HTTP 404');

      const db = FakeAsyncDuckDB.instances[0]!;
      expect(db.registeredFiles).toHaveLength(0);
      expect(db.connections).toHaveLength(0);
    });

    it('requires dropFile support before fetching a bundled extension', async () => {
      const fetchMock = stubExtensionFetch();
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithoutDropFile('https://cdn.test/duckdb-eh.wasm'),
        { eh: extensionUrl },
      );

      await expect(runtime.ensureSpatial()).rejects.toThrow('does not support dropFile');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cleans up the virtual extension file before retrying a failed load', async () => {
      stubExtensionFetch();
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { eh: extensionUrl },
      );
      const db = FakeAsyncDuckDB.instances[0]!;
      db.queryErrors.push(new Error('extension load failed'));

      await expect(runtime.ensureSpatial()).rejects.toThrow('extension load failed');
      await runtime.ensureSpatial();

      expect(db.droppedFiles).toEqual([virtualExtensionFile]);
      expect(db.connections).toHaveLength(2);
    });

    it('does not place the extension download URL into SQL', async () => {
      stubExtensionFetch();
      const quotedUrl = "https://assets.test/duck's/spatial.duckdb_extension.wasm";
      const runtime = await makeBundledRuntime(
        fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
        { eh: quotedUrl },
      );

      await runtime.ensureSpatial();

      expect(FakeAsyncDuckDB.instances[0]?.connections[0]?.queries).toEqual([
        `LOAD '${virtualExtensionFile}';`,
      ]);
    });

    it('rejects conflicting spatial extension sources during runtime creation', async () => {
      await expect(
        createDuckDbRuntimeFromJsDelivr({
          customExtensionRepository: 'https://extensions.test',
          duckdb: fakeDuckDbModuleWithMainModule('https://cdn.test/duckdb-eh.wasm'),
          spatialExtensionUrls: { eh: extensionUrl },
          workerFactory: (url) => ({ url }) as unknown as Worker,
          createObjectURL: vi.fn(() => 'blob:duckdb-worker'),
          revokeObjectURL: vi.fn(),
        }),
      ).rejects.toThrow('cannot be used together');
    });
  });
});
