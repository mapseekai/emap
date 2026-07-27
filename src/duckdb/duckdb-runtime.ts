import type { Table } from 'apache-arrow';

export interface DuckDbConnection {
  insertArrowTable(table: Table, opts: { name: string }): Promise<void>;
  query(sql: string): Promise<Table>;
  close?(): Promise<void>;
}

export interface DuckDbRuntime {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  dropFile?(name: string): Promise<void>;
  close?(): Promise<void>;
}

export type DuckDbWasmModule = typeof import('@duckdb/duckdb-wasm');

export interface CreateDuckDbRuntimeOptions {
  duckdb?: DuckDbWasmModule;
  customExtensionRepository?: string;
  workerFactory?: (url: string) => Worker | Promise<Worker>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

type DuckDbWasmConnectionLike = {
  insertArrowTable(table: Table, opts: { name: string; create?: boolean }): Promise<void>;
  query(sql: string): Promise<Table>;
  close(): Promise<void>;
};

type DuckDbWasmDatabaseLike = {
  connect(): Promise<unknown>;
  dropFile?(name: string): Promise<unknown>;
  instantiate(mainModule: string, pthreadWorker?: string): Promise<unknown>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  terminate(): Promise<unknown>;
};

let injectedRuntime: DuckDbRuntime | null = null;

export function setDuckDbRuntime(runtime: DuckDbRuntime | null): void {
  injectedRuntime = runtime;
}

/** Return the injected DuckDB runtime, or `null` when none has been configured. */
export function getDuckDbRuntime(): DuckDbRuntime | null {
  return injectedRuntime;
}

export async function closeDuckDbRuntime(
  runtime: DuckDbRuntime | null = injectedRuntime,
): Promise<void> {
  if (!runtime) return;
  if (injectedRuntime === runtime) injectedRuntime = null;
  await runtime.close?.();
}

async function loadDuckDbWasm(): Promise<DuckDbWasmModule> {
  return import('@duckdb/duckdb-wasm');
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function createJsDelivrWorkerUrl(
  workerScriptUrl: string,
  createObjectURL: (blob: Blob) => string,
): string {
  return createObjectURL(
    new Blob([`importScripts(${JSON.stringify(workerScriptUrl)});`], { type: 'text/javascript' }),
  );
}

async function createDuckDbWorker(
  workerScriptUrl: string,
  opts: CreateDuckDbRuntimeOptions,
): Promise<Worker> {
  if (opts.workerFactory) {
    const createObjectURL = opts.createObjectURL ?? URL.createObjectURL.bind(URL);
    const revokeObjectURL = opts.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
    const workerUrl = createJsDelivrWorkerUrl(workerScriptUrl, createObjectURL);
    try {
      return await opts.workerFactory(workerUrl);
    } finally {
      revokeObjectURL(workerUrl);
    }
  }

  if (typeof Worker !== 'undefined') {
    const workerUrl = createJsDelivrWorkerUrl(workerScriptUrl, URL.createObjectURL.bind(URL));
    try {
      return new Worker(workerUrl);
    } finally {
      URL.revokeObjectURL(workerUrl);
    }
  }

  throw new Error(
    `DuckDB-Wasm jsDelivr runtime requires a browser Worker or a workerFactory option for ${workerScriptUrl}`,
  );
}

function terminateWorker(worker: Worker): void {
  worker.terminate();
}

async function terminateDuckDbAfterFailure(
  db: DuckDbWasmDatabaseLike,
  worker: Worker,
): Promise<void> {
  try {
    await db.terminate();
  } catch {
    terminateWorker(worker);
  }
}

async function terminateDuckDbRuntime(db: DuckDbWasmDatabaseLike, worker: Worker): Promise<void> {
  try {
    await db.terminate();
  } catch (err) {
    terminateWorker(worker);
    throw err;
  }
}

export async function createDuckDbRuntimeFromJsDelivr(
  opts: CreateDuckDbRuntimeOptions = {},
): Promise<DuckDbRuntime> {
  const duckdb = opts.duckdb ?? (await loadDuckDbWasm());
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  if (!bundle.mainWorker) {
    throw new Error('Selected DuckDB-Wasm bundle does not include a worker script');
  }
  const worker = await createDuckDbWorker(bundle.mainWorker, opts);
  let db: DuckDbWasmDatabaseLike;
  try {
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  } catch (err) {
    terminateWorker(worker);
    throw err;
  }

  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? undefined);
  } catch (err) {
    await terminateDuckDbAfterFailure(db, worker);
    throw err;
  }

  let spatialReady: Promise<void> | null = null;
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error('DuckDB-Wasm runtime is closed');
  }

  function createSpatialReadyPromise(): Promise<void> {
    const ready = (async () => {
      const conn = (await db.connect()) as unknown as DuckDbWasmConnectionLike;
      try {
        if (opts.customExtensionRepository) {
          await conn.query(
            `SET custom_extension_repository = ${quoteSqlString(opts.customExtensionRepository)};`,
          );
        }
        await conn.query('INSTALL spatial; LOAD spatial;');
      } finally {
        await conn.close();
      }
    })();
    ready.catch(() => {
      if (spatialReady === ready) spatialReady = null;
    });
    return ready;
  }

  async function ensureSpatial(): Promise<void> {
    assertOpen();
    spatialReady ??= createSpatialReadyPromise();
    return spatialReady;
  }

  return {
    async connect(): Promise<DuckDbConnection> {
      assertOpen();
      const conn = (await db.connect()) as unknown as DuckDbWasmConnectionLike;
      return {
        insertArrowTable(table, insertOpts) {
          return conn.insertArrowTable(table, { name: insertOpts.name, create: true });
        },
        query(sql) {
          return conn.query(sql);
        },
        close() {
          return conn.close();
        },
      };
    },
    ensureSpatial,
    async registerFileBuffer(name, buffer) {
      assertOpen();
      if (typeof db.registerFileBuffer !== 'function') {
        throw new Error('DuckDB-Wasm runtime does not support registerFileBuffer');
      }
      await db.registerFileBuffer(name, buffer);
    },
    async dropFile(name) {
      assertOpen();
      await db.dropFile?.(name);
    },
    async close() {
      if (closed) return;
      closed = true;
      spatialReady = null;
      await terminateDuckDbRuntime(db, worker);
    },
  };
}
