import type { Table } from 'apache-arrow';

export interface DuckDbConnection {
  insertArrowTable(table: Table, opts: { name: string }): Promise<void>;
  query(sql: string): Promise<Table>;
  close?(): Promise<void>;
}

export interface DuckDbRuntime {
  connect(): Promise<DuckDbConnection>;
  ensureSpatial(): Promise<void>;
  close?(): Promise<void>;
}

export type DuckDbWasmModule = typeof import('@duckdb/duckdb-wasm');

export interface CreateDuckDbRuntimeOptions {
  duckdb?: DuckDbWasmModule;
  workerFactory?: (url: string) => Worker | Promise<Worker>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

type DuckDbWasmConnectionLike = {
  insertArrowTable(table: Table, opts: { name: string; create?: boolean }): Promise<void>;
  query(sql: string): Promise<Table>;
  close(): Promise<void>;
};

let injectedRuntime: DuckDbRuntime | null = null;

export function setDuckDbRuntime(runtime: DuckDbRuntime | null): void {
  injectedRuntime = runtime;
}

export function getDuckDbRuntime(): DuckDbRuntime | null {
  return injectedRuntime;
}

async function loadDuckDbWasm(): Promise<DuckDbWasmModule> {
  return import('@duckdb/duckdb-wasm');
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

export async function createDuckDbRuntimeFromJsDelivr(
  opts: CreateDuckDbRuntimeOptions = {},
): Promise<DuckDbRuntime> {
  const duckdb = opts.duckdb ?? (await loadDuckDbWasm());
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  if (!bundle.mainWorker) {
    throw new Error('Selected DuckDB-Wasm bundle does not include a worker script');
  }
  const worker = await createDuckDbWorker(bundle.mainWorker, opts);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);

  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? undefined);
  } catch (err) {
    await db.terminate().catch(() => undefined);
    throw err;
  }

  let spatialReady: Promise<void> | null = null;

  function createSpatialReadyPromise(): Promise<void> {
    const ready = (async () => {
      const conn = (await db.connect()) as unknown as DuckDbWasmConnectionLike;
      try {
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
    spatialReady ??= createSpatialReadyPromise();
    return spatialReady;
  }

  return {
    async connect(): Promise<DuckDbConnection> {
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
    close() {
      return db.terminate();
    },
  };
}
